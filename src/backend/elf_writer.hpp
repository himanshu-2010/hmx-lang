// Static ELF64 executable writer (ADR 0004, phase 5a).
//
// Produces a minimal, valid ET_EXEC x86-64 Linux binary:
//   [ELF header][2 program headers][image]
// with one PT_LOAD (R+X) covering the whole file from vaddr 0x400000 and a
// PT_GNU_STACK (RW) so the loader does not mark the stack executable. The
// image is byte-for-byte flat: every code reference inside it is relative
// (the encoder emits rel32 calls/branches and RIP-relative addressing only),
// so the whole file needs no relocation stage and zero toolchain.
//
// Layout is laid out up front: headers occupy 64 + 2*56 = 176 bytes, so the
// entry stub sits at vaddr 0x400000 + 176.
#ifndef HMX_BACKEND_ELF_WRITER_HPP
#define HMX_BACKEND_ELF_WRITER_HPP

#include <cstdint>
#include <cstddef>
#include <vector>
#include <string>

namespace backend {

// Everything before the image: fixed, kept in one place so the entry offset
// is computed once.
constexpr size_t kElfHeaders = 64 + 2 * 56;   // ehdr + PT_LOAD + PT_GNU_STACK
constexpr uint64_t kElfBase = 0x400000;

class ElfWriter {
public:
    // Appends an image (generated code + runtime blob) and produces the full
    // executable bytes. entry_offset is the image-relative entry address.
    std::vector<uint8_t> build(const std::vector<uint8_t>& image,
                               size_t entry_offset) const;
};

}  // namespace backend

#endif  // HMX_BACKEND_ELF_WRITER_HPP
