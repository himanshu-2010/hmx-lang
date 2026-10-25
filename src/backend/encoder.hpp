// x86-64 machine-code encoder (ADR 0004, phase 5a).
//
// A tiny, explicit instruction emitter for the exact instruction forms the
// ELF backend uses. Nothing here is a general-purpose assembler: every emit
// function encodes one fixed operand shape, which keeps correctness
// reviewable and the ELF path free of any text-parsing stage.
//
// Registers use the x86-64 register order (rax=0 .. r15=15); the REX bits
// are derived automatically from the register numbers.
//
// Condition codes follow the x86 numbering (shared by setcc 0F 90+cc and
// jcc 0F 80+cc): O=0 NE=5 E=4 L=12 GE=13 LE=14 G=15 S=8 B=2 BE=6 AE=3 A=7.
#ifndef HMX_BACKEND_ENCODER_HPP
#define HMX_BACKEND_ENCODER_HPP

#include <cstdint>
#include <cstddef>
#include <map>
#include <string>
#include <vector>

namespace backend {

enum Reg {
    RAX = 0, RCX, RDX, RBX, RSP, RBP, RSI, RDI,
    R8, R9, R10, R11, R12, R13, R14, R15,
};

// condition-code constants
enum CC : uint8_t {
    CC_O = 0, CC_B = 2, CC_AE = 3, CC_E = 4, CC_NE = 5, CC_BE = 6, CC_A = 7,
    CC_S = 8, CC_NS = 9, CC_L = 12, CC_GE = 13, CC_LE = 14, CC_G = 15,
};

// ALU op index (same indexing everywhere): 0=add 1=or 2=and 3=sub 4=xor 5=cmp
enum AluOp : int { ALU_ADD = 0, ALU_OR = 1, ALU_AND = 2, ALU_SUB = 3, ALU_XOR = 4, ALU_CMP = 5 };

class Encoder {
public:
    explicit Encoder(std::vector<uint8_t>& code) : code_(&code) {}

    // ── labels ────────────────────────────────────────────────────────────
    // Labels are branch/call targets identified by id; a label is bound at
    // its byte offset, any number of rel32 fixups may point at it. Unbound
    // labels fail loudly at finish() so a broken backend cannot emit bytes.
    int new_label() { return next_label_++; }
    void bind(int id);                       // bind at the current position
    void bind_at(int id, size_t at);         // bind at an absolute image offset
    void jmp(int label);
    void jcc(int cc, int label);
    void call(int label);
    bool finish(std::string* err);  // false if unbound labels remain

    // ── moves ─────────────────────────────────────────────────────────────
    void mov_r_imm(int r, int64_t imm);                // imm32 sign-ext or movabs
    void mov_r_r(int dst, int src);                    // dst <- src
    void mov_r_mem(int dst, int base, int32_t disp);   // dst <- [base+disp]
    void mov_mem_r(int base, int32_t disp, int src);   // [base+disp] <- src
    void movzx_q_b(int dst, int src);                  // movzbq: dst <- (u8)src (48 0F B6)
    void movsx_q_b(int dst, int src);                  // movsbq: dst <- (s8)src (48 0F BE)

    // ── ALU (both directions + imm forms) ─────────────────────────────────
    void alu_rr(int op, int rm, int reg);              // rm <op>= reg     (01/r)
    void alu_mr(int op, int base, int32_t disp, int reg);   // [..] <op>= reg (01/r)
    void alu_rm(int op, int reg, int base, int32_t disp);   // reg <op>= [..] (03/r)
    void alu_ri(int op, int rm, int32_t imm);               // rm <op>= imm
    void alu_mi(int op, int base, int32_t disp, int32_t imm);//[..] <op>= imm
    void imul_rr(int dst, int src);                    // dst *= src (0F AF /r)
    void cqo();                                        // rdx:rax sign(rax)
    void idiv_r(int src);                              // rdx:rax /= src (F7 /7)
    void neg_r(int r);                                 // F7 /3
    void xor_rr(int dst, int src) { alu_rr(ALU_XOR, dst, src); }

    // ── flags / sets ──────────────────────────────────────────────────────
    void test_rr(int rm, int reg);                     // test rm, reg (85/r)
    void setcc_al(int cc);                             // setcc %al (0F 90+cc C0)

    // ── stack / flow / syscalls ───────────────────────────────────────────
    void push_r(int r);
    void pop_r(int r);
    void ret();
    void leave();
    void syscall();
    void mov_edi_imm(int32_t v);                       // mov edi, imm32 (BF)
    void mov_eax_imm(int32_t v);                       // mov eax, imm32 (B8)
    void mov_rsi_r(int r);                             // alias of mov_r_r(RSI, r)
    void mov_rdi_r(int r);

    size_t size() const { return code_->size(); }

private:
    void emit8(uint8_t b) { code_->push_back(b); }
    void emit_rex(bool w, int reg, int index, int base);
    void emit_rex_w(bool w, int reg, int rm_reg);
    void emit_modrm(int mod, int reg, int rm);
    void emit_mem(int reg, int base, int32_t disp);
    void emit_disp32(int32_t d);
    void fixup(int label);
    void write_rel(int label);
    void patch_fixups_for(int id, size_t target);

    std::vector<uint8_t>* code_;
    int next_label_ = 0;
    std::map<int, size_t> labels_;
    struct Fix { size_t at; };
    std::map<int, std::vector<Fix>> fixups_;
};

}  // namespace backend

#endif // HMX_BACKEND_ENCODER_HPP
