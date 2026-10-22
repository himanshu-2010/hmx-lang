#pragma once
// ── HMX shared runtime (P2, ADR 0004) ──────────────────────────────────────
// Reference-counted value types, text/array/closure operations, the
// catchable-fault machinery (M18.2), and the conversion/parsing helpers.
// Generated programs include this header and link against libhmxrt.a, which
// the compiler's own build produces once (instead of emitting these helpers
// inline into every build_temp.c).

#include <setjmp.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── M18.2: catchable runtime faults ───────────────────────────────────── */
extern char sd_errbuf[2048];

typedef struct sd_try_frame { jmp_buf env; struct sd_try_frame* prev; } sd_try_frame;
extern sd_try_frame* _sd_try_top;

void _sd_panicf(const char* fmt, ...);

/* ── M15 reference-counted runtime: text ───────────────────────────────── */
typedef struct sd_str {
    volatile int refs;       /* live references to this header */
    struct sd_str* owner;     /* non-NULL => view into owner->data */
    size_t len;               /* payload length in bytes (excl NUL) */
    char* data;               /* NUL-terminated payload */
} sd_str;

sd_str* sd_make_str(const char* s, size_t len);
sd_str* sd_error_text(void);
sd_str* sd_retain_str(sd_str* s);
void sd_release_str(sd_str* s);
sd_str* sd_concat(sd_str* a, sd_str* b);
sd_str* sd_str_view(sd_str* s, size_t start, size_t len);
int sd_str_equals(sd_str* a, sd_str* b);
int sd_str_cmp(sd_str* a, sd_str* b);
sd_str* sd_read_line(void);
sd_str* sd_to_str_int(int v);
sd_str* sd_to_str_decimal(double v);
sd_str* sd_to_str_char(char c);
int sd_parse_int(sd_str* s);
double sd_parse_decimal(sd_str* s);

/* ── Arrays: shared refcounted buffers, COW on mutation ─────────────────── */
typedef struct sd_abuf {
    volatile int refs;    /* sd_array structs sharing this buffer */
    int esize;
    char data[];           /* capacity * esize bytes */
} sd_abuf;

typedef struct sd_array {
    volatile int refs;     /* live references to this struct */
    int length;
    int capacity;
    int esize;
    sd_abuf* buf;
    char* data;             /* buf->data + view offset (element 0) */
    void (*elem_rel)(void* p); /* release one element; NULL = scalars */
    void (*elem_ret)(void* p); /* retain one element; NULL = scalars */
} sd_array;

sd_array* sd_make_array_typed(const void* data, size_t nbytes, int length, size_t esize,
                              void (*elem_rel)(void*), void (*elem_ret)(void*));
sd_array* sd_make_array(const void* data, size_t nbytes, int length, size_t esize);
sd_array* sd_retain_array(sd_array* a);
void sd_release_array(sd_array* a);
sd_array* sd_detach(sd_array* a);
sd_array* sd_push(sd_array* a, const void* item, size_t esize);
sd_array* sd_array_slice(sd_array* a, int start, int end);
sd_array* sd_array_concat(sd_array* x, sd_array* y);
sd_array* sd_split(sd_str* s, sd_str* sep);
int sd_check_index(int length, int index);
int sd_check_tuple_index(int length, int index);
unsigned char sd_to_byte(double v);

/* ── Closures: refcounted environments ──────────────────────────────────── */
typedef struct sd_envhdr {
    volatile int refs;    /* references to this env */
    void (*rel)(void*);   /* release captured values (env payload) */
} sd_envhdr;

typedef struct sd_closure {
    void* fn;
    void* env;
} sd_closure;

sd_closure sd_make_closure(void* fn, void* env);
void* sd_copy_env_typed(const void* src, size_t size, void (*rel)(void*));
void sd_retain_env(void* env);
void sd_release_env(void* env);
sd_closure sd_retain_closure(sd_closure c);
void sd_release_closure(sd_closure* c);

/* ── Per-type element capture/release helpers (p = pointer to a slot) ───── */
void sd_rel_text(void* p);
void sd_ret_text(void* p);
void sd_rel_arr(void* p);
void sd_ret_arr(void* p);
void sd_rel_fn(void* p);
void sd_ret_fn(void* p);

#ifdef __cplusplus
}
#endif
