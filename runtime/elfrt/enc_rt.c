// HMX ELF-runtime helpers (ADR 0004, phase 5a).
//
// Freestanding x86-64 Linux helper library embedded into compiler-produced
// static executables. Compiled at COMPILER build time (-ffreestanding, no
// libc) and linked into a flat image whose bytes are copied verbatim into
// every -b elf binary, so nothing here may depend on libc, dynamic linking,
// or an arbitrary placement: all references are resolved by the build-time
// link and stay valid because the image layout is copied exactly.
//
// v0 covers the word-only backend surface: print of int/bool (decimal
// digits + \n), print of char (one byte), a panic used by `chr` out-of-range,
// and process exit. syscalls only — no stdio, no allocator.
//
// Byte-exactness contracts vs the C path (glibc printf):
//   %d  → "-digits" then a newline is emitted separately by the backend
//   %c  → exactly one byte, c & 0xFF (glibc converts the int to unsigned char)
//   chr panic → same text on stderr and exit code 1 as hxrt's _sd_panicf

typedef unsigned long u64;
typedef long i64;

static i64 rt_syscall_write(long fd, const void* buf, u64 n) {
    i64 ret;
    __asm__ volatile("syscall"
                     : "=a"(ret)
                     : "a"(1L), "D"(fd), "S"(buf), "d"(n)
                     : "rcx", "r11", "memory");
    return ret;
}

i64 _hmx_write(long fd, const void* buf, u64 n) {
    return rt_syscall_write(fd, buf, n);
}

// Formats v into buf (which must hold 21 bytes: '-' + 20 digits) and writes
// it to fd. Returns the number of bytes written.
long _hmx_w_i64_to(long fd, i64 v, char* buf) {
    char tmp[20];
    u64 mag = v < 0 ? 0UL - (u64)v : (u64)v;
    long n = 0;
    do {
        tmp[n++] = (char)('0' + (mag % 10));
        mag /= 10;
    } while (mag != 0);
    long m = 0;
    if (v < 0) buf[m++] = '-';
    while (n > 0) buf[m++] = tmp[--n];
    rt_syscall_write(fd, buf, (u64)m);
    return m;
}

// print of an int/bool: decimal digits (glibc %d shape; no newline here —
// the backend emits the separator/newline bytes so multi-arg prints toggle).
void _hmx_w_i64(i64 v) {
    char buf[24];
    _hmx_w_i64_to(1, v, buf);
}

// print of a char: exactly one byte, matching printf("%c", (unsigned)c).
void _hmx_w_char(long c) {
    char ch = (char)((unsigned long)c & 0xFFUL);
    rt_syscall_write(1, &ch, 1);
}

// One decimal digit + newline pair is not needed today; the generic write is
// used by the backend for separator/newline bytes via _hmx_w_char.

static void rt_exit(long code) {
    __asm__ volatile("syscall" :: "a"(231L), "D"(code) : "rcx", "r11", "memory");
    for (;;) {}  // noreturn
}

// chr out-of-range panic: mirrors hxrt's _sd_panicf behaviour for the message
// the backend prints ("...got %d\n"): text to stderr then exit(1).
void _hmx_panic_chr(i64 v) {
    static const char msg1[] = "Error: chr expects a character code between 0 and 255, got ";
    char buf[24];
    rt_syscall_write(2, msg1, sizeof(msg1) - 1);
    char tmp[24];
    u64 mag = v < 0 ? 0UL - (u64)v : (u64)v;
    long n = 0;
    do {
        tmp[n++] = (char)('0' + (mag % 10));
        mag /= 10;
    } while (mag != 0);
    long m = 0;
    if (v < 0) buf[m++] = '-';
    while (n > 0) buf[m++] = tmp[--n];
    buf[m++] = '\n';
    rt_syscall_write(2, buf, (u64)m);
    rt_exit(1);
}
