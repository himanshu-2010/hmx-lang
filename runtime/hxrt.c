#include "hxrt.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#include <setjmp.h>
#include <stdarg.h>

// ─────────────────────────────────────────────────────────────────────────
// M15 reference-counted runtime (extracted from the per-program C emitter in
// P2 / ADR 0004). Every heap value (text, array, closure environment) is a
// reference-counted allocation. `text` values are `sd_str*`; `sd_array`
// structs share `sd_abuf` buffers so slicing/concatting copies O(1) pointer
// bookkeeping instead of the whole payload; mutation copy-on-writes via
// `sd_detach`. Closure environments carry an `sd_envhdr` refcount header.
// ─────────────────────────────────────────────────────────────────────────

#include <stdio.h>

#include <stdlib.h>

#include <string.h>

#include <errno.h>

#include <limits.h>

#include <setjmp.h>

#include <stdarg.h>



    // M18.2: catchable runtime faults. `sd_panicf` formats the same message the
    // old `fprintf(stderr, ...)` sites printed, then either unwinds to the
    // innermost `try` handler or preserves the default print+exit(1) behaviour.
sd_try_frame* _sd_try_top = 0;

char sd_errbuf[2048];

void _sd_panicf(const char* fmt, ...) {

    va_list ap; va_start(ap, fmt);

    vsnprintf(sd_errbuf, sizeof(sd_errbuf), fmt, ap);

    va_end(ap);

    if (_sd_try_top) longjmp(_sd_try_top->env, 1);

    fputs(sd_errbuf, stderr);

    exit(1);

}



    // ─────────────────────────────────────────────────────────────────────────
    // M15 reference-counted runtime.
    //
    // Every heap value (text, array, closure environment) is a reference-
    // counted allocation. `text` values are `sd_str*`; `sd_array` structs
    // share `sd_abuf` buffers so slicing/concatting copies `O(1)` pointer
    // bookkeeping instead of the whole payload; mutation copy-on-writes via
    // `sd_detach`. Closure environments carry an `sd_envhdr` refcount header.
    // ─────────────────────────────────────────────────────────────────────────



sd_str* sd_make_str(const char* s, size_t len) {

    sd_str* r = (sd_str*)malloc(sizeof(sd_str));

    if (!r) exit(1);

    r->refs = 1;

    r->owner = (sd_str*)0;

    r->len = len;

    r->data = (char*)malloc(len + 1);

    if (!r->data) exit(1);

    if (s && len) memcpy(r->data, s, len);

    r->data[len] = '\0';

    return r;

}



sd_str* sd_error_text(void) {

    size_t n = strlen(sd_errbuf);

    while (n > 0 && (sd_errbuf[n - 1] == '\n' || sd_errbuf[n - 1] == '\r')) n--;

    return sd_make_str(sd_errbuf, n);

}



sd_str* sd_retain_str(sd_str* s) { if (s) s->refs++; return s; }



void sd_release_str(sd_str* s) {

    if (!s) return;

    if (--s->refs == 0) {

        if (s->owner) sd_release_str(s->owner);

        else free(s->data);

        free(s);

    }

}



sd_str* sd_concat(sd_str* a, sd_str* b) {

    if (a->len > ~(size_t)0 - b->len - 1) { _sd_panicf("Error: string length overflow\n"); }

    size_t n = a->len + b->len;

    sd_str* r = (sd_str*)malloc(sizeof(sd_str));

    if (!r) exit(1);

    r->refs = 1;

    r->owner = (sd_str*)0;

    r->len = n;

    r->data = (char*)malloc(n + 1);

    if (!r->data) exit(1);

    if (a->len) memcpy(r->data, a->data, a->len);

    if (b->len) memcpy(r->data + a->len, b->data, b->len);

    r->data[n] = '\0';

    return r;

}



    // A substring is a VIEW into the base string: O(1), shares the payload
    // buffer, and pins the base with a refcount while the view is alive.
sd_str* sd_str_view(sd_str* s, size_t start, size_t len) {

    /* silent bounds failure (parity with the web VM's silentExit) */

    if (start > s->len || len > s->len - start) exit(1);

    sd_str* r = (sd_str*)malloc(sizeof(sd_str));

    if (!r) exit(1);

    sd_str* base = s->owner ? s->owner : s;

    base->refs++;

    r->refs = 1;

    r->owner = base;

    r->len = len;

    r->data = s->data + start;

    return r;

}



    // Views are NOT NUL-terminated, so text comparisons must be length-aware.
int sd_str_equals(sd_str* a, sd_str* b) {

    if (a->len != b->len) return 0;

    return a->len ? memcmp(a->data, b->data, a->len) == 0 : 1;

}



int sd_str_cmp(sd_str* a, sd_str* b) {

    size_t n = a->len < b->len ? a->len : b->len;

    int c = n ? memcmp(a->data, b->data, n) : 0;

    if (c) return c;

    return (a->len > b->len) - (a->len < b->len);

}



    // getline() is POSIX 2008 and does not exist under MinGW-w64, so every
    // generated program that used input() failed to compile on Windows with
    // "implicit declaration of function 'getline'" (and ssize_t is not
    // standard C either). Reading a byte at a time is portable to MSVC,
    // MinGW and POSIX, and the observable behaviour is unchanged: the line
    // terminator is stripped, CRLF is handled, and EOF with nothing read
    // yields an empty text.
sd_str* sd_read_line(void) {

    char* line = NULL;

    size_t cap = 0, len = 0;

    int c;

    while ((c = fgetc(stdin)) != EOF && c != '\n') {

        if (len + 1 >= cap) {

            size_t ncap = cap ? cap * 2 : 64;

            char* nl = (char*)realloc(line, ncap);

            if (!nl) { free(line); exit(1); }

            line = nl;

            cap = ncap;

        }

        line[len++] = (char)c;

    }

    if (len > 0 && line[len-1] == '\r') len--;

    if (!line) return sd_make_str(0, 0);

    sd_str* r = sd_make_str(line, len);

    free(line);

    return r;

}



sd_str* sd_to_str_int(int v) {

    char buf[32];

    snprintf(buf, 32, "%d", v);

    return sd_make_str(buf, strlen(buf));

}



sd_str* sd_to_str_decimal(double v) {

    char buf[64];

    snprintf(buf, 64, "%f", v);

    return sd_make_str(buf, strlen(buf));

}



sd_str* sd_to_str_char(char c) {

    char buf[2];

    buf[0] = c;

    buf[1] = '\0';

    return sd_make_str(buf, 1);

}



int sd_parse_int(sd_str* s) {

    char* buf = (char*)malloc(s->len + 2);

    if (!buf) exit(1);

    if (s->len) memcpy(buf, s->data, s->len);

    buf[s->len] = '\0';

    char* end = NULL;

    errno = 0;

    long v = strtol(buf, &end, 10);

    if (end == buf || *end != '\0' || errno == ERANGE ||

        v < INT_MIN || v > INT_MAX) {

        free(buf);

        _sd_panicf("Error: parse_int: invalid int '%.*s'\n", (int)s->len, s->data);

    }

    free(buf);

    return (int)v;

}



double sd_parse_decimal(sd_str* s) {

    char* buf = (char*)malloc(s->len + 2);

    if (!buf) exit(1);

    if (s->len) memcpy(buf, s->data, s->len);

    buf[s->len] = '\0';

    char* end = NULL;

    errno = 0;

    double v = strtod(buf, &end);

    if (end == buf || *end != '\0' || errno == ERANGE) {

        free(buf);

        _sd_panicf("Error: parse_decimal: invalid decimal '%.*s'\n", (int)s->len, s->data);

    }

    free(buf);

    return v;

}



    // ── Arrays: shared refcounted buffers, COW on mutation ──────────────────




sd_array* sd_make_array_typed(const void* data, size_t nbytes, int length, size_t esize,

                                     void (*elem_rel)(void*), void (*elem_ret)(void*)) {

    size_t el = esize ? esize : 1;

    if (length > INT_MAX - 16) exit(1);

    size_t cap = (size_t)length + 16;

    if (cap > (~(size_t)0 - sizeof(sd_abuf)) / el) { _sd_panicf("Error: array capacity overflow\n"); }

    sd_array* a = (sd_array*)malloc(sizeof(sd_array));

    if (!a) exit(1);

    a->refs = 1;

    a->esize = (int)el;

    a->length = length;

    a->capacity = (int)cap;

    a->elem_rel = elem_rel;

    a->elem_ret = elem_ret;

    sd_abuf* b = (sd_abuf*)malloc(sizeof(sd_abuf) + cap * el);

    if (!b) exit(1);

    b->refs = 1;

    b->esize = (int)el;

    if (nbytes) memcpy(b->data, data, nbytes);

    a->buf = b;

    a->data = b->data;

    return a;

}



sd_array* sd_make_array(const void* data, size_t nbytes, int length, size_t esize) {

    return sd_make_array_typed(data, nbytes, length, esize, (void(*)(void*))0, (void(*)(void*))0);

}



sd_array* sd_retain_array(sd_array* a) { if (a) a->refs++; return a; }



    // Forward declarations so the slot helpers (defined below) can be used by
    // split/concat and early array routines.
void sd_rel_text(void* p);

void sd_ret_text(void* p);

void sd_rel_arr(void* p);

void sd_ret_arr(void* p);



void sd_release_array(sd_array* a) {

    if (!a) return;

    if (--a->refs == 0) {

        if (a->elem_rel) {

            char* p = a->data;

            for (int i = 0; i < a->length; i++) { a->elem_rel(p); p += a->esize; }

        }

        if (--a->buf->refs == 0) free(a->buf);

        free(a);

    }

}



    // Copy-on-write: if another struct shares this buffer, give this struct
    // its own private copy. The elements MOVE with the struct (no new refs):
    // this struct keeps its own per-element reference, now backed by nb.
sd_array* sd_detach(sd_array* a) {

    if (a->buf->refs == 1) return a;

    sd_abuf* nb = (sd_abuf*)malloc(sizeof(sd_abuf) + (size_t)a->capacity * (size_t)a->esize);

    if (!nb) exit(1);

    nb->refs = 1;

    nb->esize = a->esize;

    size_t by = (size_t)a->length * (size_t)a->esize;

    if (a->length) memcpy(nb->data, a->data, by);  /* copy this struct's range (views are offset) */

    if (--a->buf->refs == 0) free(a->buf);

    a->buf = nb;

    a->data = nb->data;

    return a;

}



sd_array* sd_push(sd_array* a, const void* item, size_t esize) {

    sd_detach(a);

    if (a->length >= a->capacity) {

        size_t cap = (size_t)a->capacity * 2 + 8;

        if ((size_t)a->esize != 0 && cap > (~(size_t)0 - sizeof(sd_abuf)) / (size_t)a->esize) { _sd_panicf("Error: array capacity overflow\n"); }

        sd_abuf* nb = (sd_abuf*)malloc(sizeof(sd_abuf) + cap * (size_t)a->esize);

        if (!nb) exit(1);

        nb->refs = 1;

        nb->esize = a->esize;

        if (a->length) memcpy(nb->data, a->data, (size_t)a->length * (size_t)a->esize);

        free(a->buf);

        a->buf = nb;

        a->data = nb->data;

        a->capacity = (int)cap;

    }

    memcpy((char*)a->data + (size_t)a->length * (size_t)a->esize, item, esize);

    if (a->elem_ret) a->elem_ret((char*)a->data + (size_t)a->length * (size_t)a->esize);

    a->length++;

    return a;

}



sd_array* sd_array_slice(sd_array* a, int start, int end) {

    if (start < 0 || end < start || end > a->length) { _sd_panicf("Error: slice out of bounds (%d, %d)\n", start, end); }

    sd_array* r = (sd_array*)malloc(sizeof(sd_array));

    if (!r) exit(1);

    r->refs = 1;

    r->esize = a->esize;

    r->length = end - start;

    r->capacity = r->length;

    r->elem_rel = a->elem_rel;

    r->elem_ret = a->elem_ret;

    a->buf->refs++;

    r->buf = a->buf;

    r->data = a->data + (size_t)start * (size_t)a->esize;

    // The view struct holds its own reference to each element in range, so
    // releasing the source array drops only the source's reference.
    if (a->elem_ret) {

        char* p = r->data;

        for (int i = 0; i < r->length; i++) { r->elem_ret(p); p += r->esize; }

    }

    return r;

}



sd_array* sd_array_concat(sd_array* x, sd_array* y) {

    size_t nx = (size_t)x->length, ny = (size_t)y->length;

    if (nx > (size_t)(INT_MAX - 16) - ny) { _sd_panicf("Error: array length overflow\n"); }

    sd_array* r = sd_make_array_typed((const void*)0, 0, (int)(nx + ny), (size_t)x->esize, x->elem_rel, x->elem_ret);

    if (nx) memcpy(r->data, x->data, nx * (size_t)x->esize);

    if (ny) memcpy(r->data + nx * (size_t)x->esize, y->data, ny * (size_t)y->esize);

    if (r->elem_ret) {

        char* p = r->data;

        for (size_t i = 0; i < nx + ny; i++) { r->elem_ret(p); p += r->esize; }

    }

    return r;

}



sd_array* sd_split(sd_str* s, sd_str* sep) {

    if (sep->len == 0) { _sd_panicf("Error: split separator must not be empty\n"); }

    const char* hay = s->data;

    const char* ndl = sep->data;

    size_t pl = sep->len;

    const char* hay_end = hay + s->len;   /* views lack a trailing NUL */

    sd_array* a = sd_make_array_typed((const void*)0, 0, 0, sizeof(sd_str*), sd_rel_text, sd_ret_text);

    const char* cur = hay;

    for (;;) {

        const char* hit = (const char*)0;

        for (const char* p = cur; p + pl <= hay_end; p++) {

            if (memcmp(p, ndl, pl) == 0) { hit = p; break; }

        }

        size_t len = hit ? (size_t)(hit - cur) : (size_t)(hay_end - cur);

        sd_str* piece = sd_make_str(cur, len);

        if (a->length >= a->capacity) {

            size_t cap = (size_t)a->capacity * 2;

            if (cap > (~(size_t)0 - sizeof(sd_abuf)) / sizeof(sd_str*)) { _sd_panicf("Error: array capacity overflow\n"); }

            sd_abuf* nb = (sd_abuf*)malloc(sizeof(sd_abuf) + cap * sizeof(sd_str*));

            if (!nb) exit(1);

            nb->refs = 1;

            nb->esize = (int)sizeof(sd_str*);

            memcpy(nb->data, a->buf->data, (size_t)a->length * sizeof(sd_str*));

            free(a->buf);

            a->buf = nb;

            a->data = nb->data;

            a->capacity = (int)cap;

        }

        ((sd_str**)a->data)[a->length++] = piece;

        if (!hit) break;

        cur = hit + pl;

    }

    return a;

}



int sd_check_index(int length, int index) {

    if (index < 0 || index >= length) {

        _sd_panicf("Error: array index out of bounds (index %d, length %d)\n", index, length);

    }

    return index;

}



int sd_check_tuple_index(int length, int index) {

    if (index < 0 || index >= length) {

        _sd_panicf("Error: tuple index out of bounds (index %d, length %d)\n", index, length);

    }

    return index;

}



unsigned char sd_to_byte(double v) {

    if (v < 0 || v > 255) {

        _sd_panicf("Error: byte cast out of range (%.0f)\n", v);

    }

    return (unsigned char)v;

}



    // ── Closures: refcounted environments ───────────────────────────────────




sd_closure sd_make_closure(void* fn, void* env) {

    sd_closure c;

    c.fn = fn;

    c.env = env;

    return c;

}



void* sd_copy_env_typed(const void* src, size_t size, void (*rel)(void*)) {

    sd_envhdr* h = (sd_envhdr*)malloc(sizeof(sd_envhdr) + (size ? size : 1));

    if (!h) exit(1);

    h->refs = 1;

    h->rel = rel;

    if (size) memcpy((char*)(h + 1), src, size);

    return (void*)(h + 1);

}



void sd_retain_env(void* env) { if (env) ((sd_envhdr*)env - 1)->refs++; }



void sd_release_env(void* env) {

    if (!env) return;

    sd_envhdr* h = (sd_envhdr*)env - 1;

    if (--h->refs == 0) {

        if (h->rel) h->rel(env);

        free(h);

    }

}



sd_closure sd_retain_closure(sd_closure c) { if (c.env) sd_retain_env(c.env); return c; }



void sd_release_closure(sd_closure* c) { if (c->env) sd_release_env(c->env); }



    // ── Per-type element capture/release helpers (p = pointer to a slot) ────
void sd_rel_text(void* p) { sd_str* s = *(sd_str**)p; sd_release_str(s); }

void sd_ret_text(void* p) { sd_str* s = *(sd_str**)p; if (s) s->refs++; }

void sd_rel_arr(void* p) { sd_array* a = *(sd_array**)p; sd_release_array(a); }

void sd_ret_arr(void* p) { sd_array* a = *(sd_array**)p; if (a) a->refs++; }

void sd_rel_fn(void* p) { sd_closure* c = (sd_closure*)p; sd_release_closure(c); }

void sd_ret_fn(void* p) { sd_closure* c = (sd_closure*)p; sd_retain_closure(*c); }
