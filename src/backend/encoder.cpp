// x86-64 machine-code encoder (ADR 0004, phase 5a) — see encoder.hpp
// for the API contract and the opcode-shape documentation.
#include "encoder.hpp"

#include <cstdint>
#include <string>

namespace backend {

// ALU family: base opcode per op index. With REX.W the +1 form is the 64-bit
// "r/m <- reg" operation and +3 is "reg <- r/m". The imm32/imm8 group (81/83)
// encodes the sub-operation in the reg field: /0=add /1=or /4=and /5=sub
// /6=xor /7=cmp — the same sub-operation order as the family layout minus
// adc/sbb, hence {0,1,4,5,6,7}.
static const uint8_t kAluBase[6] = {0x00, 0x08, 0x20, 0x28, 0x30, 0x38};
static const int kAluImmReg[6] = {0, 1, 4, 5, 6, 7};

    static bool fits_imm8(int32_t v) { return v >= -128 && v <= 127; }
static bool fits_imm32(int64_t v) { return v >= -2147483648LL && v <= 2147483647LL; }

void Encoder::emit_rex(bool w, int reg, int index, int base) {
    int bits = (w ? 8 : 0) | (reg >= 8 ? 4 : 0) |
               (index >= 8 ? 2 : 0) | (base >= 8 ? 1 : 0);
    if (bits) emit8(uint8_t(0x40 | bits));
}

void Encoder::emit_rex_w(bool w, int reg, int rm_reg) {
    emit_rex(w, reg, -1, rm_reg);
}

void Encoder::emit_modrm(int mod, int reg, int rm) {
    emit8(uint8_t((mod << 6) | ((reg & 7) << 3) | (rm & 7)));
}

// Memory operand with a base register and disp32. rm encodes the base; only
// rm=4 (rsp) needs a SIB byte (base=rsp, no index, scale=1 → 0x24).
void Encoder::emit_mem(int reg, int base, int32_t disp) {
    if (base == RSP) {
        emit_modrm(2, reg, 4);
        emit8(0x24);
        emit_disp32(disp);
        return;
    }
    emit_modrm(2, reg, base);
    emit_disp32(disp);
}

void Encoder::emit_disp32(int32_t d) {
    for (int i = 0; i < 4; i++) emit8(uint8_t(d >> (8 * i)));
}

// ── labels ──────────────────────────────────────────────────────────────────
void Encoder::fixup(int label) {
    fixups_[label].push_back({code_->size()});
    emit8(0); emit8(0); emit8(0); emit8(0);
}

void Encoder::bind(int id) {
    labels_[id] = code_->size();
    patch_fixups_for(id, labels_[id]);
}

// Binds a label to an absolute image position (used for the appended runtime
// blob, whose symbols sit past the generated code). Existing fixups patch
// against the absolute offset, not the current emit position.
void Encoder::bind_at(int id, size_t at) {
    labels_[id] = at;
    patch_fixups_for(id, at);
}

void Encoder::patch_fixups_for(int id, size_t target) {
    auto it = fixups_.find(id);
    if (it == fixups_.end()) return;
    for (const Fix& f : it->second) {
        int64_t rel = static_cast<int64_t>(target) -
                      static_cast<int64_t>(f.at) - 4;
        int32_t d = static_cast<int32_t>(rel);
        for (int i = 0; i < 4; i++) code_->at(f.at + i) = uint8_t(d >> (8 * i));
    }
    fixups_.erase(it);
}

bool Encoder::finish(std::string* err) {
    if (fixups_.empty()) return true;
    if (err) {
        *err = "backend internal: unresolved branch target";
        for (const auto& [id, fs] : fixups_) {
            *err += " (label " + std::to_string(id) + " from " +
                    std::to_string(fs.size()) + " site(s))";
        }
    }
    return false;
}

void Encoder::jmp(int label) {
    emit8(0xE9);
    write_rel(label);
}

// jcc shares the setcc condition table (0F 80+cc).
void Encoder::jcc(int cc, int label) {
    emit8(0x0F);
    emit8(uint8_t(0x80 + cc));
    write_rel(label);
}

void Encoder::call(int label) {
    emit8(0xE8);
    write_rel(label);
}

// Writes a rel32 displacement branch to an already-bound target directly;
// otherwise queues a fixup to be patched at bind time.
void Encoder::write_rel(int label) {
    auto it = labels_.find(label);
    if (it == labels_.end()) {
        fixup(label);
        return;
    }
    int64_t rel = static_cast<int64_t>(it->second) -
                  static_cast<int64_t>(code_->size()) - 4;
    int32_t d = static_cast<int32_t>(rel);
    for (int i = 0; i < 4; i++) emit8(uint8_t(d >> (8 * i)));
}

// ── moves ───────────────────────────────────────────────────────────────────
void Encoder::mov_r_imm(int r, int64_t imm) {
    if (fits_imm32(imm)) {
        // REX.W C7 /0 imm32 (C7 /0 sign-extends the immediate to 64 bits)
        emit_rex_w(true, 0, r);
        emit8(0xC7);
        emit_modrm(3, 0, r);
        emit_disp32(int32_t(imm));
        return;
    }
    // movabs: REX.WB B8+r imm64
    emit_rex(true, 0, -1, r);
    emit8(uint8_t(0xB8 + (r & 7)));
    for (int i = 0; i < 8; i++) emit8(uint8_t(uint64_t(imm) >> (8 * i)));
}

void Encoder::mov_r_r(int dst, int src) {
    emit_rex_w(true, src, dst);
    emit8(0x89);                    // MOV r/m64, r64
    emit_modrm(3, src, dst);
}

// lea dst, [rip+disp32]: mod=00 rm=101 → RIP-relative; rel32 patched to the
// label (write_rel computes rel = target - (stored position + 4), which is
// exactly the RIP-relative displacement since RIP = stored position + 4).
void Encoder::lea_rip(int dst, int label) {
    emit_rex(true, dst, -1, -1);    // REX.W + REX.R when dst >= 8
    emit8(0x8D);
    emit_modrm(0, dst, 5);
    write_rel(label);
}

// RIP-relative MOVSD load: mod=00 rm=101 → [rip+disp32]; rel32 patched to
// the pool label (same displacement accounting as lea_rip).
void Encoder::movsd_rip_xmm(int xmm, int label) {
    emit_rex(false, xmm, -1, -1);   // REX.R when xmm >= 8
    emit8(0xF2);
    emit8(0x0F);
    emit8(0x10);
    emit_modrm(0, xmm, 5);
    write_rel(label);
}
void Encoder::mov_r_mem(int dst, int base, int32_t disp) {
    emit_rex_w(true, dst, base);
    emit8(0x8B);                    // MOV r64, r/m64
    emit_mem(dst, base, disp);
}

void Encoder::mov_mem_r(int base, int32_t disp, int src) {
    emit_rex_w(true, src, base);
    emit8(0x89);                    // MOV r/m64, r64
    emit_mem(src, base, disp);
}

void Encoder::movzx_q_b(int dst, int src) {
    emit_rex_w(true, dst, src);
    emit8(0x0F); emit8(0xB6);       // MOVZX r64, r/m8
    emit_modrm(3, dst, src);
}

void Encoder::movsx_q_b(int dst, int src) {
    emit_rex_w(true, dst, src);
    emit8(0x0F); emit8(0xBE);       // MOVSX r64, r/m8
    emit_modrm(3, dst, src);
}

// movsbq dst, [base + index*1] — the SIB form the s[i] payload load uses.
// mod=10 (disp32=0) so the SIB byte can encode base+index; scale = 1.
void Encoder::movsx_q_memidx(int dst, int base, int index) {
    emit_rex(true, dst, index, base);
    emit8(0x0F); emit8(0xBE);
    emit_modrm(2, dst, 4);                 // rm=101x → SIB byte follows
    emit8(uint8_t(((index & 7) << 3) | (base & 7)));
    emit_disp32(0);
}

// ── ALU ─────────────────────────────────────────────────────────────────────
void Encoder::alu_rr(int op, int rm, int reg) {
    emit_rex_w(true, reg, rm);
    emit8(uint8_t(kAluBase[op] + 1));   // 01/r: r/m64 <- op reg
    emit_modrm(3, reg, rm);
}

void Encoder::alu_mr(int op, int base, int32_t disp, int reg) {
    emit_rex_w(true, reg, base);
    emit8(uint8_t(kAluBase[op] + 1));   // 01/r: [mem] <- op reg
    emit_mem(reg, base, disp);
}

void Encoder::alu_rm(int op, int reg, int base, int32_t disp) {
    emit_rex_w(true, reg, base);
    emit8(uint8_t(kAluBase[op] + 3));   // 03/r: reg <- op [mem]
    emit_mem(reg, base, disp);
}

void Encoder::alu_ri(int op, int rm, int32_t imm) {
    if (fits_imm8(imm)) {
        emit_rex_w(true, 0, rm);
        emit8(0x83);
        emit_modrm(3, kAluImmReg[op], rm);
        emit8(uint8_t(imm));
        return;
    }
    emit_rex_w(true, 0, rm);
    emit8(0x81);
    emit_modrm(3, kAluImmReg[op], rm);
    emit_disp32(imm);
}

void Encoder::alu_mi(int op, int base, int32_t disp, int32_t imm) {
    if (fits_imm8(imm)) {
        emit_rex_w(true, 0, base);
        emit8(0x83);
        emit_mem(kAluImmReg[op], base, disp);
        emit8(uint8_t(imm));
        return;
    }
    emit_rex_w(true, 0, base);
    emit8(0x81);
    emit_mem(kAluImmReg[op], base, disp);
    emit_disp32(imm);
}

void Encoder::imul_rr(int dst, int src) {
    emit_rex_w(true, dst, src);
    emit8(0x0F); emit8(0xAF);       // IMUL r64, r/m64
    emit_modrm(3, dst, src);
}

void Encoder::cqo() {
    emit_rex_w(true, 0, 0);
    emit8(0x99);                    // CQO: rdx:rax = sign(rax)
}

void Encoder::idiv_r(int src) {
    emit_rex_w(true, 7, src);
    emit8(0xF7);
    emit_modrm(3, 7, src);          // F7 /7: IDIV r/m64
}

void Encoder::neg_r(int r) {
    emit_rex_w(true, 3, r);
    emit8(0xF7);
    emit_modrm(3, 3, r);            // F7 /3: NEG r/m64
}

// ── flags / sets ────────────────────────────────────────────────────────────
void Encoder::test_rr(int rm, int reg) {
    emit_rex_w(true, reg, rm);
    emit8(0x85);                    // TEST r/m64, r64
    emit_modrm(3, reg, rm);
}

void Encoder::setcc_al(int cc) {
    emit8(0x0F);
    emit8(uint8_t(0x90 + cc));      // SETcc r/m8
    emit_modrm(3, 0, 0);            // C0 → %al; caller movzx's to 64-bit
}

// ── stack / flow / syscalls ─────────────────────────────────────────────────
void Encoder::push_r(int r) {
    if (r >= 8) emit8(0x41);
    emit8(uint8_t(0x50 + (r & 7)));
}

void Encoder::pop_r(int r) {
    if (r >= 8) emit8(0x41);
    emit8(uint8_t(0x58 + (r & 7)));
}

void Encoder::ret() { emit8(0xC3); }

void Encoder::leave() { emit8(0xC9); }

void Encoder::syscall() { emit8(0x0F); emit8(0x05); }

void Encoder::mov_edi_imm(int32_t v) {
    emit8(0xBF);                    // MOV edi, imm32
    emit_disp32(v);
}

void Encoder::mov_eax_imm(int32_t v) {
    emit8(0xB8);                    // MOV eax, imm32
    emit_disp32(v);
}

void Encoder::mov_rsi_r(int r) { mov_r_r(RSI, r); }
void Encoder::mov_rdi_r(int r) { mov_r_r(RDI, r); }

// ── SSE2 (single-precision-shape prefixes; one fixed operand shape each) ─────
// Memory operand = [base + disp32]; register operand = mod=11.

void Encoder::movsd_xmm_mem(int xmm, int base, int32_t disp) {
    emit_rex(false, xmm, -1, base); // REX.R for xmm >= 8, REX.B for base >= 8
    emit8(0xF2); emit8(0x0F); emit8(0x10);   // MOVSD xmm, r/m64
    emit_mem(xmm, base, disp);
}

void Encoder::movsd_mem_xmm(int base, int32_t disp, int xmm) {
    emit_rex(false, xmm, -1, base);
    emit8(0xF2); emit8(0x0F); emit8(0x11);   // MOVSD r/m64, xmm
    emit_mem(xmm, base, disp);
}

// MOVSD xmm2 ← xmm1 with reg = dst (F2 0F 10 on mod=11 loads reg from rm).
void Encoder::movsd_xmm_xmm(int dst, int src) {
    emit_rex(false, dst, -1, src);
    emit8(0xF2); emit8(0x0F); emit8(0x10);
    emit_modrm(3, dst, src);
}

// dst = dst <op> src, reg field = dst (ADDSD/SUBSD/MULSD/DIVSD F2 0F 58/5C/59/5E).
void Encoder::addsd_rr(int dst, int src) {
    emit_rex(false, dst, -1, src);
    emit8(0xF2); emit8(0x0F); emit8(0x58);
    emit_modrm(3, dst, src);
}

void Encoder::subsd_rr(int dst, int src) {
    emit_rex(false, dst, -1, src);
    emit8(0xF2); emit8(0x0F); emit8(0x5C);
    emit_modrm(3, dst, src);
}

void Encoder::mulsd_rr(int dst, int src) {
    emit_rex(false, dst, -1, src);
    emit8(0xF2); emit8(0x0F); emit8(0x59);
    emit_modrm(3, dst, src);
}

void Encoder::divsd_rr(int dst, int src) {
    emit_rex(false, dst, -1, src);
    emit8(0xF2); emit8(0x0F); emit8(0x5E);
    emit_modrm(3, dst, src);
}

// XORPD: bitwise xor (used for the -0.0 sign flip in unary minus).
void Encoder::xorpd_rr(int dst, int src) {
    emit_rex(false, dst, -1, src);
    emit8(0x66); emit8(0x0F); emit8(0x57);
    emit_modrm(3, dst, src);
}

// UCOMISD: compares dst against src, ZF/PF/CF as for an unordered-capable
// compare. dst is the left operand of the comparison.
void Encoder::ucomisd_rr(int dst, int src) {
    emit_rex(false, dst, -1, src);
    emit8(0x66); emit8(0x0F); emit8(0x2E);
    emit_modrm(3, dst, src);
}


}  // namespace backend
