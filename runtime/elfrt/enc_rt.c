// HMX ELF-runtime helpers (ADR 0004, phase 5a/5b).
//
// Freestanding x86-64 Linux helper library embedded into compiler-produced
// static executables. Compiled at COMPILER build time (-ffreestanding, no
// libc) and linked into a flat image whose bytes are copied verbatim into
// every -b elf binary, so nothing here may depend on libc, dynamic linking,
// or an arbitrary placement: all references are resolved by the build-time
// link and stay valid because the image layout is copied exactly.
//
// v0 covered the word-only backend surface: print of int/bool/char, the
// chr panic and process exit. v1 (P5b) adds the word/decimal/text surface:
//
//   - a minimal allocator: ONE anonymous mmap per allocation, the mapping
//     length stashed at the block base. No reuse, so a use-after-free
//     cannot corrupt live data and the differential gate stays honest.
//     Fixture workloads make a few thousand allocations, well within
//     page-mapping budget.
//   - the refcounted text ABI ported 1:1 from runtime/hxrt.c: sd_str
//     layout refs@0, owner@8, len@16, data@24 (the generated code
//     dereferences len/data at +16/+24). make/retain/release/concat/
//     equals/cmp/view/check_index share hxrt's exact semantics, including
//     the silent exit(1) of an out-of-bounds substring and the panic text
//     of an out-of-bounds index.
//   - byte-exact formatters: "%f" (6 fractional digits, round-half-even
//     on the EXACT binary value — a small bignum does the rounding so the
//     output matches glibc for every finite double, including subnormals)
//     and "%.*s" (stops at a NUL byte like printf's precision does).
//
// No file-scope mutable state: objcopy's -O binary dump skips .bss, so a
// global variable would not be zeroed after the verbatim copy. All working
// memory lives in stack frames, constants (.rodata is progbits and DOES
// survive the dump), or mmap blocks.
//
// Byte-exactness contracts vs the C path (glibc printf):
//   %d    → "-digits" then a newline is emitted separately by the backend
//   %c    → exactly one byte, c & 0xFF (glibc converts the int to unsigned char)
//   %f    → glibc's 6-fraction-digit form (sign, "0."-padded int part)
//   %.*s  → at most len bytes, truncated at the first NUL byte
//   chr/index panic → same text on stderr and exit code 1 as hxrt

typedef unsigned long u64;
typedef unsigned int u32;
typedef long i64;

// ── raw syscalls ──────────────────────────────────────────────────────────────

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

// SYS_mmap (9): anonymous private RW mapping of `len` bytes, or a negative
// errno on failure. Argument four rides r10 (bind-once register locals).
static long rt_mmap_anon(u64 len) {
    long ret;
    register long r10 __asm__("r10") = 0x22L;   // MAP_PRIVATE | MAP_ANONYMOUS
    register long r8  __asm__("r8")  = -1L;     // fd (ignored for anon)
    register long r9  __asm__("r9")  = 0L;      // offset
    __asm__ volatile("syscall"
                     : "=a"(ret)
                     : "a"(9L), "D"(0L), "S"((long)len), "d"(3L),
                       "r"(r10), "r"(r8), "r"(r9)
                     : "rcx", "r11", "memory");
    return ret;
}

// SYS_munmap (11).
static void rt_munmap(void* base, u64 len) {
    __asm__ volatile("syscall"
                     :: "a"(11L), "D"((long)base), "S"((long)len)
                     : "rcx", "r11", "memory");
}

static void rt_exit(long code) {
    __asm__ volatile("syscall" :: "a"(231L), "D"(code) : "rcx", "r11", "memory");
    for (;;) {}  // noreturn
}

// ── digit formatting ──────────────────────────────────────────────────────────

// Formats v into buf (which must hold 21 bytes: '-' + 20 digits). Returns
// the number of characters written.
static long rt_fmt_i64(char* buf, i64 v) {
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
    return m;
}

// print of an int/bool: decimal digits (glibc %d shape; no newline here —
// the backend emits the separator/newline bytes so multi-arg prints toggle).
void _hmx_w_i64(i64 v) {
    char buf[24];
    long m = rt_fmt_i64(buf, v);
    rt_syscall_write(1, buf, (u64)m);
}

// print of a char: exactly one byte, matching printf("%c", (unsigned)c).
void _hmx_w_char(long c) {
    char ch = (char)((unsigned long)c & 0xFFUL);
    rt_syscall_write(1, &ch, 1);
}

// print of text: printf("%.*s", len, data) shape — at most `len` bytes,
// truncated at the first NUL (glibc stops there too).
void _hmx_w_text(long len, const char* data) {
    if (!data) return;
    u64 n = 0;
    while (n < (u64)len && data[n] != '\0') n++;
    rt_syscall_write(1, data, n);
}

// chr out-of-range panic: mirrors hxrt's _sd_panicf behaviour for the message
// the backend prints ("...got %d\n"): text to stderr then exit(1).
void _hmx_panic_chr(i64 v) {
    static const char msg1[] = "Error: chr expects a character code between 0 and 255, got ";
    char buf[24];
    rt_syscall_write(2, msg1, sizeof(msg1) - 1);
    long m = rt_fmt_i64(buf, v);
    buf[m++] = '\n';
    rt_syscall_write(2, buf, (u64)m);
    rt_exit(1);
}

// text index panic: same message text as hxrt's sd_check_index (whose
// _sd_panicf formats "Error: array index out of bounds (index %d, length %d)\n").
static void rt_panic_index(i64 index, i64 length) {
    static const char msg1[] = "Error: array index out of bounds (index ";
    static const char msg2[] = ", length ";
    char buf[24];
    rt_syscall_write(2, msg1, sizeof(msg1) - 1);
    long m = rt_fmt_i64(buf, index);
    rt_syscall_write(2, buf, (u64)m);
    rt_syscall_write(2, msg2, sizeof(msg2) - 1);
    m = rt_fmt_i64(buf, length);
    buf[m++] = ')';
    buf[m++] = '\n';
    rt_syscall_write(2, buf, (u64)m);
    rt_exit(1);
}

// ── libc-shaped memory primitives ────────────────────────────────────────────
// gcc may emit calls to these for copies it does not inline; the free
// runtime must provide them because libc never links in on this path.

void* memcpy(void* dst, const void* src, u64 n) {
    unsigned char* d = (unsigned char*)dst;
    const unsigned char* s = (const unsigned char*)src;
    while (n--) *d++ = *s++;
    return dst;
}

void* memset(void* dst, int c, u64 n) {
    unsigned char* d = (unsigned char*)dst;
    while (n--) *d++ = (unsigned char)c;
    return dst;
}

void* memmove(void* dst, const void* src, u64 n) {
    unsigned char* d = (unsigned char*)dst;
    const unsigned char* s = (const unsigned char*)src;
    if (d < s) {
        while (n--) *d++ = *s++;
    } else if (d > s) {
        d += n;
        s += n;
        while (n--) *--d = *--s;
    }
    return dst;
}

// ── allocator: one anonymous mmap per allocation ─────────────────────────────
// Layout: [page][u64 mapping length][16 pad][user block ...]. The user
// pointer is base + 16 (16-byte aligned because the base is page-aligned);
// rt_free recovers the length from base and unmaps the whole block.

void* rt_alloc(u64 n) {
    u64 len = n + 32;
    len = (len + 4095UL) & ~4095UL;
    long base = rt_mmap_anon(len);
    if (base < 0) rt_exit(1);
    *(u64*)base = len;
    return (void*)(base + 16);
}

void rt_free(void* p) {
    if (!p) return;
    u64 len = *(u64*)((char*)p - 16);
    rt_munmap((char*)p - 16, len);
}

// ── refcounted text (ABI port of runtime/hxrt.c) ─────────────────────────────
// Layout is the hxrt layout: refs@0, owner@8, len@16, data@24 — the backend
// dereferences len/data at those offsets. The payload lives in the same
// allocation as the header (data = header + 1); views point into the
// base's payload and pin it through owner + refcount exactly as hxrt does.

typedef struct sd_str {
    i64 refs;
    struct sd_str* owner;
    u64 len;
    char* data;
} sd_str;

sd_str* sd_make_str(const char* s, u64 len) {
    sd_str* r = (sd_str*)rt_alloc(sizeof(sd_str) + len + 1);
    r->refs = 1;
    r->owner = (sd_str*)0;
    r->len = len;
    r->data = (char*)(r + 1);
    if (s && len) memcpy(r->data, s, len);
    r->data[len] = '\0';
    return r;
}

sd_str* sd_retain_str(sd_str* s) { if (s) s->refs++; return s; }

void sd_release_str(sd_str* s) {
    if (!s) return;
    if (--s->refs == 0) {
        if (s->owner) sd_release_str(s->owner);
        rt_free(s);   // the payload rides inside the header allocation
    }
}

sd_str* sd_concat(sd_str* a, sd_str* b) {
    // length overflow check as in hxrt (unreachable for real programs)
    if (a->len + b->len < a->len) {
        static const char msg1[] = "Error: string length overflow\n";
        rt_syscall_write(2, msg1, sizeof(msg1) - 1);
        rt_exit(1);
    }
    u64 n = a->len + b->len;
    sd_str* r = (sd_str*)rt_alloc(sizeof(sd_str) + n + 1);
    r->refs = 1;
    r->owner = (sd_str*)0;
    r->len = n;
    r->data = (char*)(r + 1);
    if (a->len) memcpy(r->data, a->data, a->len);
    if (b->len) memcpy(r->data + a->len, b->data, b->len);
    r->data[n] = '\0';
    return r;
}

// A substring is a VIEW into the base string: O(1), shares the payload
// buffer, and pins the base with a refcount while the view is alive.
// Out-of-bounds fails SILENTLY with exit code 1 (parity with hxrt, which
// keeps the web VM's silentExit behaviour).
sd_str* sd_str_view(sd_str* s, u64 start, u64 len) {
    if (start > s->len || len > s->len - start) rt_exit(1);
    sd_str* base = s->owner ? s->owner : s;
    base->refs++;
    sd_str* r = (sd_str*)rt_alloc(sizeof(sd_str));
    r->refs = 1;
    r->owner = base;
    r->len = len;
    r->data = s->data + start;
    return r;
}

// Views are NOT NUL-terminated, so text comparisons must be length-aware.
int sd_str_equals(sd_str* a, sd_str* b) {
    if (a->len != b->len) return 0;
    const unsigned char* x = (const unsigned char*)a->data;
    const unsigned char* y = (const unsigned char*)b->data;
    for (u64 i = 0; i < a->len; i++)
        if (x[i] != y[i]) return 0;
    return 1;
}

int sd_str_cmp(sd_str* a, sd_str* b) {
    u64 n = a->len < b->len ? a->len : b->len;
    const unsigned char* x = (const unsigned char*)a->data;
    const unsigned char* y = (const unsigned char*)b->data;
    for (u64 i = 0; i < n; i++) {
        if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return (a->len > b->len) - (a->len < b->len);
}

// Bounds guard used by the generated code for s[i]; panics with the hxrt
// message when out of range.
i64 sd_check_index(i64 length, i64 index) {
    if (index < 0 || index >= length) rt_panic_index(index, length);
    return index;
}

// ── the byte-exact "%f" formatter ────────────────────────────────────────────
// printf("%f", v) prints 6 fractional digits rounded HALF-EVEN on v's exact
// binary value. For v = (-1)^s * M * 2^e (M an integer), the scaled value
// M * 10^6 * 2^e is an exact rational with a power-of-two denominator, so
// the rounding is pure integer arithmetic: multiply by 10^6, then shift by
// e with half-to-even rounding on the dropped bits. Largest magnitude needs
// ~1044 bits (+ the rounding carry); the bignum has 1536 bits of headroom.
//
// Output shapes match glibc: "inf"/"-inf"/"nan"/"-nan" for special values,
// a zero-padded integer part, and exactly 6 fractional digits.

#define BN_LIMBS 24   // 1536 bits

typedef struct {
    u64 l[BN_LIMBS];
    int n;          // used limbs (little-endian); leading zeros allowed
} BN;

static void bn_trim(BN* x) {
    while (x->n > 1 && x->l[x->n - 1] == 0) x->n--;
}

static void bn_from_u64(BN* x, u64 v) {
    x->l[0] = v;
    x->n = 1;
    bn_trim(x);
}

// x *= m (m small, <= 2^20 here).
static void bn_mul_small(BN* x, u64 m) {
    u64 carry = 0;
    for (int i = 0; i < x->n; i++) {
        unsigned __int128 p = (unsigned __int128)x->l[i] * m + carry;
        x->l[i] = (u64)p;
        carry = (u64)(p >> 64);
    }
    // carry < m <= 2^20 here, so exactly one extra limb suffices
    if (carry) {
        if (x->n >= BN_LIMBS) rt_exit(1);
        x->l[x->n++] = (u64)carry;
    }
    bn_trim(x);
}

// x <<= b (b >= 0).
static void bn_shl(BN* x, int b) {
    if (!b) return;
    int words = b >> 6, bit = b & 63;
    int old_n = x->n;
    int new_n = old_n + words + (bit ? 1 : 0);
    if (new_n > BN_LIMBS) rt_exit(1);
    for (int i = new_n - 1; i >= 0; i--) {
        int src = i - words;
        u64 v = 0;
        if (src >= 0 && src < old_n) {
            v = x->l[src] << bit;
        }
        // the high bits of limb src-1 flow into dst even when src points
        // past the payload (top limb of the shifted result)
        if (bit && src - 1 >= 0 && src - 1 < old_n) {
            v |= x->l[src - 1] >> (64 - bit);
        }
        x->l[i] = v;
    }
    x->n = new_n;
    bn_trim(x);
}

// x >>= b, rounding half-to-even on the dropped bits (the exact semantics
// of rounding a binary-exact rational whose denominator is 2^b).
static void bn_shr_rhe(BN* x, int b) {
    if (!b) return;
    int words = b >> 6, bit = b & 63;
    // b = 64*words + bit; bit b-1 lives in limb `words` at position bit-1
    // (or limb words-1 at position 63 when bit == 0).
    int last_limb = bit ? words : words - 1;
    int last_bit = bit ? bit - 1 : 63;
    u64 r_last = 0, sticky = 0;
    for (int i = 0; i <= last_limb && i < x->n; i++) {
        u64 li = x->l[i];
        if (i < last_limb) {
            sticky |= li;                          // fully below the tie bit
        } else {
            r_last = (li >> last_bit) & 1UL;
            sticky |= li & ((1UL << last_bit) - 1UL);
        }
    }
    sticky = sticky ? 1UL : 0UL;

    // whole-limb drop, then the partial shift (Q = x >> b)
    if (words >= x->n) {
        x->l[0] = 0;   // every limb was dropped (sticky already captured)
        x->n = 1;
    } else {
        int new_n = x->n - words;
        for (int i = 0; i < new_n; i++) x->l[i] = x->l[i + words];
        for (int i = new_n; i < x->n; i++) x->l[i] = 0;
        x->n = new_n;
        if (bit) {
            for (int i = 0; i < x->n; i++) {
                u64 v = x->l[i] >> bit;
                if (i + 1 < x->n) v |= x->l[i + 1] << (64 - bit);
                x->l[i] = v;
            }
        }
        bn_trim(x);
    }

    // round-half-even: a tie (r_last set, no sticky) goes to even
    if (r_last && (sticky || (x->l[0] & 1UL))) {
        int i = 0;
        for (;;) {
            if (++x->l[i] != 0) break;
            if (i == x->n - 1) {
                if (i + 1 >= BN_LIMBS) rt_exit(1);
                x->l[i + 1] = 1;
                x->n = i + 2;
                break;
            }
            i++;
        }
    }
}

// print of a decimal: the "%f" digit stream (no newline — separators and
// the terminator are emitted by the backend like for every other type).
void _hmx_w_f64(double v) {
    char buf[420];
    union { double d; u64 bits; } u;
    u.d = v;
    int sign = (int)(u.bits >> 63);
    int rawexp = (int)((u.bits >> 52) & 0x7FF);
    u64 mant = u.bits & 0xFFFFFFFFFFFFFULL;
    long m = 0;

    if (rawexp == 0x7FF) {
        // inf / nan in the glibc spelling (the sign bit shows on nan too)
        if (sign) buf[m++] = '-';
        if ((u.bits & 0x000FFFFFFFFFFFFFULL) == 0) {
            buf[m++] = 'i'; buf[m++] = 'n'; buf[m++] = 'f';
        } else {
            buf[m++] = 'n'; buf[m++] = 'a'; buf[m++] = 'n';
        }
        rt_syscall_write(1, buf, (u64)m);
        return;
    }
    if ((u.bits & 0x7FFFFFFFFFFFFFFFULL) == 0) {
        if (sign) buf[m++] = '-';
        buf[m++] = '0'; buf[m++] = '.';
        for (int i = 0; i < 6; i++) buf[m++] = '0';
        rt_syscall_write(1, buf, (u64)m);
        return;
    }

    u64 Md;
    int e;
    if (rawexp == 0) { Md = mant; e = -1074; }   // subnormal
    else             { Md = mant | (1ULL << 52); e = rawexp - 1075; }

    BN x;
    bn_from_u64(&x, Md);
    bn_mul_small(&x, 1000000UL);
    if (e >= 0) bn_shl(&x, e);
    else        bn_shr_rhe(&x, -e);

    // N = round-half-even(|v| * 10^6); printed digits are N with a decimal
    // point 6 digits from the right.
    u32 chunks[40];
    int cn = 0;
    while (x.l[0] != 0 || x.n > 1) {
        u64 rem = 0;
        for (int i = x.n - 1; i >= 0; i--) {
            u64 hi = (rem << 32) | (x.l[i] >> 32);
            u64 q1 = hi / 1000000000ULL;
            rem = hi - q1 * 1000000000ULL;
            u64 lo = (rem << 32) | (x.l[i] & 0xFFFFFFFFULL);
            u64 q2 = lo / 1000000000ULL;
            rem = lo - q2 * 1000000000ULL;
            x.l[i] = (q1 << 32) | q2;
        }
        bn_trim(&x);
        chunks[cn++] = (u32)rem;
    }

    char digits[40 * 9];
    int dn = 0;
    for (int i = cn - 1; i >= 0; i--) {
        u32 c = chunks[i];
        if (i == cn - 1) {
            // most significant chunk: no zero padding
            char t[10];
            int tn = 0;
            do {
                t[tn++] = (char)('0' + (c % 10));
                c /= 10;
            } while (c);
            while (tn) digits[dn++] = t[--tn];
        } else {
            for (int p = 8; p >= 0; p--) {
                digits[dn + p] = (char)('0' + (c % 10));
                c /= 10;
            }
            dn += 9;
        }
    }
    if (dn == 0) digits[dn++] = '0';

    if (sign) buf[m++] = '-';
    if (dn <= 6) {
        buf[m++] = '0';
        buf[m++] = '.';
        for (int z = dn; z < 6; z++) buf[m++] = '0';
        for (int i = 0; i < dn; i++) buf[m++] = digits[i];
    } else {
        for (int i = 0; i < dn - 6; i++) buf[m++] = digits[i];
        buf[m++] = '.';
        for (int i = dn - 6; i < dn; i++) buf[m++] = digits[i];
    }
    rt_syscall_write(1, buf, (u64)m);
}
