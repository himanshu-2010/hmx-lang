// Static ELF64 executable writer (ADR 0004, phase 5a) — see elf_writer.hpp.
#include "elf_writer.hpp"

namespace backend {

namespace {

// All fields little-endian; helpers write fixed-width fields at offsets.
void put16(std::vector<uint8_t>& v, size_t at, uint16_t x) {
    v[at] = uint8_t(x);
    v[at + 1] = uint8_t(x >> 8);
}
void put32(std::vector<uint8_t>& v, size_t at, uint32_t x) {
    for (int i = 0; i < 4; i++) v[at + i] = uint8_t(x >> (8 * i));
}
void put64(std::vector<uint8_t>& v, size_t at, uint64_t x) {
    for (int i = 0; i < 8; i++) v[at + i] = uint8_t(x >> (8 * i));
}

}  // namespace

std::vector<uint8_t> ElfWriter::build(const std::vector<uint8_t>& image,
                                      size_t entry_offset) const {
    std::vector<uint8_t> out;
    out.resize(kElfHeaders, 0);

    // ── ELF header ──
    const uint8_t magic[4] = {0x7F, 'E', 'L', 'F'};
    for (int i = 0; i < 4; i++) out[i] = magic[i];
    out[4] = 2;      // EI_CLASS: ELFCLASS64
    out[5] = 1;      // EI_DATA: little-endian
    out[6] = 1;      // EI_VERSION: EV_CURRENT
    out[7] = 0;      // EI_OSABI: SYSV
    put16(out, 16, 2);          // e_type: ET_EXEC
    put16(out, 18, 0x3E);       // e_machine: EM_X86_64
    put32(out, 20, 1);          // e_version
    put64(out, 24, kElfBase + kElfHeaders + entry_offset);  // e_entry
    put64(out, 32, 64);         // e_phoff
    put64(out, 40, 0);          // e_shoff: no section headers
    put32(out, 48, 0);          // e_flags
    put16(out, 52, 64);         // e_ehsize
    put16(out, 54, 56);         // e_phentsize
    put16(out, 56, 2);          // e_phnum
    put16(out, 58, 0);          // e_shentsize
    put16(out, 60, 0);          // e_shnum
    put16(out, 62, 0);          // e_shstrndx

    // ── PT_LOAD: the whole file, R+X ──
    size_t ph = 64;
    put32(out, ph + 0, 1);                          // p_type: PT_LOAD
    put32(out, ph + 4, 5);                          // p_flags: R | X
    put64(out, ph + 8, 0);                          // p_offset
    put64(out, ph + 16, kElfBase);                  // p_vaddr
    put64(out, ph + 24, kElfBase);                  // p_paddr
    uint64_t filesz = kElfHeaders + image.size();
    put64(out, ph + 32, filesz);                    // p_filesz
    put64(out, ph + 40, filesz);                    // p_memsz (no bss in 5a)
    put64(out, ph + 48, 0x1000);                    // p_align

    // ── PT_GNU_STACK: RW stack, not executable ──
    ph = 64 + 56;
    put32(out, ph + 0, 0x6474E551);                 // p_type: PT_GNU_STACK
    put32(out, ph + 4, 6);                          // p_flags: R | W
    put64(out, ph + 8, 0);                          // p_offset
    put64(out, ph + 16, 0);                         // p_vaddr
    put64(out, ph + 24, 0);                         // p_paddr
    put64(out, ph + 32, 0);                         // p_filesz
    put64(out, ph + 40, 0);                         // p_memsz
    put64(out, ph + 48, 0x10);                      // p_align

    out.insert(out.end(), image.begin(), image.end());
    return out;
}

}  // namespace backend
