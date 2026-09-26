#include "codegen.hpp"

#include <array>
#include <charconv>
#include <set>

static TypeDesc codegen_param_desc(const FunctionDecl::Param& p) {
    if (p.desc.type != TypeKind::Unknown) return p.desc;
    TypeDesc d;
    d.type = p.type;
    d.elem = p.elem_desc.elem;
    d.tuple_members = p.tuple_members;
    return d;
}

std::string CodeGen::generate(Program& program, const std::string& source_file) {
    source_file_ = source_file;
    line_file_ = source_file;
    TypeResolver resolver;
    resolver.resolve(program);

    out_ << "#include <stdio.h>\n";
    out_ << "#include <stdlib.h>\n";
    out_ << "#include <string.h>\n";
    out_ << "#include <errno.h>\n";
    out_ << "#include <limits.h>\n";
    out_ << "#include <setjmp.h>\n\n";

    // ─────────────────────────────────────────────────────────────────────────
    // M15 reference-counted runtime.
    //
    // Every heap value (text, array, closure environment) is a reference-
    // counted allocation. `text` values are `sd_str*`; `sd_array` structs
    // share `sd_abuf` buffers so slicing/concatting copies `O(1)` pointer
    // bookkeeping instead of the whole payload; mutation copy-on-writes via
    // `sd_detach`. Closure environments carry an `sd_envhdr` refcount header.
    // ─────────────────────────────────────────────────────────────────────────

    out_ << "typedef struct sd_str {\n";
    out_ << "    volatile int refs;       /* live references to this header */\n";
    out_ << "    struct sd_str* owner;     /* non-NULL => view into owner->data */\n";
    out_ << "    size_t len;               /* payload length in bytes (excl NUL) */\n";
    out_ << "    char* data;               /* NUL-terminated payload */\n";
    out_ << "} sd_str;\n\n";

    out_ << "static sd_str* sd_make_str(const char* s, size_t len) {\n";
    out_ << "    sd_str* r = (sd_str*)malloc(sizeof(sd_str));\n";
    out_ << "    if (!r) exit(1);\n";
    out_ << "    r->refs = 1;\n";
    out_ << "    r->owner = (sd_str*)0;\n";
    out_ << "    r->len = len;\n";
    out_ << "    r->data = (char*)malloc(len + 1);\n";
    out_ << "    if (!r->data) exit(1);\n";
    out_ << "    if (s && len) memcpy(r->data, s, len);\n";
    out_ << "    r->data[len] = '\\0';\n";
    out_ << "    return r;\n";
    out_ << "}\n\n";

    out_ << "static sd_str* sd_retain_str(sd_str* s) { if (s) s->refs++; return s; }\n\n";

    out_ << "static void sd_release_str(sd_str* s) {\n";
    out_ << "    if (!s) return;\n";
    out_ << "    if (--s->refs == 0) {\n";
    out_ << "        if (s->owner) sd_release_str(s->owner);\n";
    out_ << "        else free(s->data);\n";
    out_ << "        free(s);\n";
    out_ << "    }\n";
    out_ << "}\n\n";

    out_ << "static sd_str* sd_concat(sd_str* a, sd_str* b) {\n";
    out_ << "    if (a->len > ~(size_t)0 - b->len - 1) { fprintf(stderr, \"Error: string length overflow\\n\"); exit(1); }\n";
    out_ << "    size_t n = a->len + b->len;\n";
    out_ << "    sd_str* r = (sd_str*)malloc(sizeof(sd_str));\n";
    out_ << "    if (!r) exit(1);\n";
    out_ << "    r->refs = 1;\n";
    out_ << "    r->owner = (sd_str*)0;\n";
    out_ << "    r->len = n;\n";
    out_ << "    r->data = (char*)malloc(n + 1);\n";
    out_ << "    if (!r->data) exit(1);\n";
    out_ << "    if (a->len) memcpy(r->data, a->data, a->len);\n";
    out_ << "    if (b->len) memcpy(r->data + a->len, b->data, b->len);\n";
    out_ << "    r->data[n] = '\\0';\n";
    out_ << "    return r;\n";
    out_ << "}\n\n";

    // A substring is a VIEW into the base string: O(1), shares the payload
    // buffer, and pins the base with a refcount while the view is alive.
    out_ << "static sd_str* sd_str_view(sd_str* s, size_t start, size_t len) {\n";
    out_ << "    /* silent bounds failure (parity with the web VM's silentExit) */\n";
    out_ << "    if (start > s->len || len > s->len - start) exit(1);\n";
    out_ << "    sd_str* r = (sd_str*)malloc(sizeof(sd_str));\n";
    out_ << "    if (!r) exit(1);\n";
    out_ << "    sd_str* base = s->owner ? s->owner : s;\n";
    out_ << "    base->refs++;\n";
    out_ << "    r->refs = 1;\n";
    out_ << "    r->owner = base;\n";
    out_ << "    r->len = len;\n";
    out_ << "    r->data = s->data + start;\n";
    out_ << "    return r;\n";
    out_ << "}\n\n";

    // Views are NOT NUL-terminated, so text comparisons must be length-aware.
    out_ << "static int sd_str_equals(sd_str* a, sd_str* b) {\n";
    out_ << "    if (a->len != b->len) return 0;\n";
    out_ << "    return a->len ? memcmp(a->data, b->data, a->len) == 0 : 1;\n";
    out_ << "}\n\n";

    out_ << "static int sd_str_cmp(sd_str* a, sd_str* b) {\n";
    out_ << "    size_t n = a->len < b->len ? a->len : b->len;\n";
    out_ << "    int c = n ? memcmp(a->data, b->data, n) : 0;\n";
    out_ << "    if (c) return c;\n";
    out_ << "    return (a->len > b->len) - (a->len < b->len);\n";
    out_ << "}\n\n";

    out_ << "static sd_str* sd_read_line(void) {\n";
    out_ << "    char* line = NULL;\n";
    out_ << "    size_t cap = 0;\n";
    out_ << "    ssize_t n = getline(&line, &cap, stdin);\n";
    out_ << "    if (n < 0) {\n";
    out_ << "        free(line);\n";
    out_ << "        return sd_make_str(0, 0);\n";
    out_ << "    }\n";
    out_ << "    while (n > 0 && (line[n-1] == '\\n' || line[n-1] == '\\r')) {\n";
    out_ << "        line[--n] = '\\0';\n";
    out_ << "    }\n";
    out_ << "    sd_str* r = sd_make_str(line, (size_t)n);\n";
    out_ << "    free(line);\n";
    out_ << "    return r;\n";
    out_ << "}\n\n";

    out_ << "static sd_str* sd_to_str_int(int v) {\n";
    out_ << "    char buf[32];\n";
    out_ << "    snprintf(buf, 32, \"%d\", v);\n";
    out_ << "    return sd_make_str(buf, strlen(buf));\n";
    out_ << "}\n\n";

    out_ << "static sd_str* sd_to_str_decimal(double v) {\n";
    out_ << "    char buf[64];\n";
    out_ << "    snprintf(buf, 64, \"%f\", v);\n";
    out_ << "    return sd_make_str(buf, strlen(buf));\n";
    out_ << "}\n\n";

    out_ << "static sd_str* sd_to_str_char(char c) {\n";
    out_ << "    char buf[2];\n";
    out_ << "    buf[0] = c;\n";
    out_ << "    buf[1] = '\\0';\n";
    out_ << "    return sd_make_str(buf, 1);\n";
    out_ << "}\n\n";

    out_ << "static int sd_parse_int(sd_str* s) {\n";
    out_ << "    char* buf = (char*)malloc(s->len + 2);\n";
    out_ << "    if (!buf) exit(1);\n";
    out_ << "    if (s->len) memcpy(buf, s->data, s->len);\n";
    out_ << "    buf[s->len] = '\\0';\n";
    out_ << "    char* end = NULL;\n";
    out_ << "    errno = 0;\n";
    out_ << "    long v = strtol(buf, &end, 10);\n";
    out_ << "    if (end == buf || *end != '\\0' || errno == ERANGE ||\n";
    out_ << "        v < INT_MIN || v > INT_MAX) {\n";
    out_ << "        fprintf(stderr, \"Error: parse_int: invalid int '%.*s'\\n\", (int)s->len, s->data);\n";
    out_ << "        free(buf);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    free(buf);\n";
    out_ << "    return (int)v;\n";
    out_ << "}\n\n";

    out_ << "static double sd_parse_decimal(sd_str* s) {\n";
    out_ << "    char* buf = (char*)malloc(s->len + 2);\n";
    out_ << "    if (!buf) exit(1);\n";
    out_ << "    if (s->len) memcpy(buf, s->data, s->len);\n";
    out_ << "    buf[s->len] = '\\0';\n";
    out_ << "    char* end = NULL;\n";
    out_ << "    errno = 0;\n";
    out_ << "    double v = strtod(buf, &end);\n";
    out_ << "    if (end == buf || *end != '\\0' || errno == ERANGE) {\n";
    out_ << "        fprintf(stderr, \"Error: parse_decimal: invalid decimal '%.*s'\\n\", (int)s->len, s->data);\n";
    out_ << "        free(buf);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    free(buf);\n";
    out_ << "    return v;\n";
    out_ << "}\n\n";

    // ── Arrays: shared refcounted buffers, COW on mutation ──────────────────
    out_ << "typedef struct sd_abuf {\n";
    out_ << "    volatile int refs;    /* sd_array structs sharing this buffer */\n";
    out_ << "    int esize;\n";
    out_ << "    char data[];           /* capacity * esize bytes */\n";
    out_ << "} sd_abuf;\n\n";

    out_ << "typedef struct sd_array {\n";
    out_ << "    volatile int refs;     /* live references to this struct */\n";
    out_ << "    int length;\n";
    out_ << "    int capacity;\n";
    out_ << "    int esize;\n";
    out_ << "    sd_abuf* buf;\n";
    out_ << "    char* data;             /* buf->data + view offset (element 0) */\n";
    out_ << "    void (*elem_rel)(void* p); /* release one element; NULL = scalars */\n";
    out_ << "    void (*elem_ret)(void* p); /* retain one element; NULL = scalars */\n";
    out_ << "} sd_array;\n\n";

    out_ << "static sd_array* sd_make_array_typed(const void* data, size_t nbytes, int length, size_t esize,\n";
    out_ << "                                     void (*elem_rel)(void*), void (*elem_ret)(void*)) {\n";
    out_ << "    size_t el = esize ? esize : 1;\n";
    out_ << "    if (length > INT_MAX - 16) exit(1);\n";
    out_ << "    size_t cap = (size_t)length + 16;\n";
    out_ << "    if (cap > (~(size_t)0 - sizeof(sd_abuf)) / el) { fprintf(stderr, \"Error: array capacity overflow\\n\"); exit(1); }\n";
    out_ << "    sd_array* a = (sd_array*)malloc(sizeof(sd_array));\n";
    out_ << "    if (!a) exit(1);\n";
    out_ << "    a->refs = 1;\n";
    out_ << "    a->esize = (int)el;\n";
    out_ << "    a->length = length;\n";
    out_ << "    a->capacity = (int)cap;\n";
    out_ << "    a->elem_rel = elem_rel;\n";
    out_ << "    a->elem_ret = elem_ret;\n";
    out_ << "    sd_abuf* b = (sd_abuf*)malloc(sizeof(sd_abuf) + cap * el);\n";
    out_ << "    if (!b) exit(1);\n";
    out_ << "    b->refs = 1;\n";
    out_ << "    b->esize = (int)el;\n";
    out_ << "    if (nbytes) memcpy(b->data, data, nbytes);\n";
    out_ << "    a->buf = b;\n";
    out_ << "    a->data = b->data;\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_make_array(const void* data, size_t nbytes, int length, size_t esize) {\n";
    out_ << "    return sd_make_array_typed(data, nbytes, length, esize, (void(*)(void*))0, (void(*)(void*))0);\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_retain_array(sd_array* a) { if (a) a->refs++; return a; }\n\n";

    // Forward declarations so the slot helpers (defined below) can be used by
    // split/concat and early array routines.
    out_ << "static void sd_rel_text(void* p);\n";
    out_ << "static void sd_ret_text(void* p);\n";
    out_ << "static void sd_rel_arr(void* p);\n";
    out_ << "static void sd_ret_arr(void* p);\n\n";

    out_ << "static void sd_release_array(sd_array* a) {\n";
    out_ << "    if (!a) return;\n";
    out_ << "    if (--a->refs == 0) {\n";
    out_ << "        if (a->elem_rel) {\n";
    out_ << "            char* p = a->data;\n";
    out_ << "            for (int i = 0; i < a->length; i++) { a->elem_rel(p); p += a->esize; }\n";
    out_ << "        }\n";
    out_ << "        if (--a->buf->refs == 0) free(a->buf);\n";
    out_ << "        free(a);\n";
    out_ << "    }\n";
    out_ << "}\n\n";

    // Copy-on-write: if another struct shares this buffer, give this struct
    // its own private copy. The elements MOVE with the struct (no new refs):
    // this struct keeps its own per-element reference, now backed by nb.
    out_ << "static sd_array* sd_detach(sd_array* a) {\n";
    out_ << "    if (a->buf->refs == 1) return a;\n";
    out_ << "    sd_abuf* nb = (sd_abuf*)malloc(sizeof(sd_abuf) + (size_t)a->capacity * (size_t)a->esize);\n";
    out_ << "    if (!nb) exit(1);\n";
    out_ << "    nb->refs = 1;\n";
    out_ << "    nb->esize = a->esize;\n";
    out_ << "    size_t by = (size_t)a->length * (size_t)a->esize;\n";
    out_ << "    if (a->length) memcpy(nb->data, a->data, by);  /* copy this struct's range (views are offset) */\n";
    out_ << "    if (--a->buf->refs == 0) free(a->buf);\n";
    out_ << "    a->buf = nb;\n";
    out_ << "    a->data = nb->data;\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_push(sd_array* a, const void* item, size_t esize) {\n";
    out_ << "    sd_detach(a);\n";
    out_ << "    if (a->length >= a->capacity) {\n";
    out_ << "        size_t cap = (size_t)a->capacity * 2 + 8;\n";
    out_ << "        if ((size_t)a->esize != 0 && cap > (~(size_t)0 - sizeof(sd_abuf)) / (size_t)a->esize) { fprintf(stderr, \"Error: array capacity overflow\\n\"); exit(1); }\n";
    out_ << "        sd_abuf* nb = (sd_abuf*)malloc(sizeof(sd_abuf) + cap * (size_t)a->esize);\n";
    out_ << "        if (!nb) exit(1);\n";
    out_ << "        nb->refs = 1;\n";
    out_ << "        nb->esize = a->esize;\n";
    out_ << "        if (a->length) memcpy(nb->data, a->data, (size_t)a->length * (size_t)a->esize);\n";
    out_ << "        free(a->buf);\n";
    out_ << "        a->buf = nb;\n";
    out_ << "        a->data = nb->data;\n";
    out_ << "        a->capacity = (int)cap;\n";
    out_ << "    }\n";
    out_ << "    memcpy((char*)a->data + (size_t)a->length * (size_t)a->esize, item, esize);\n";
    out_ << "    if (a->elem_ret) a->elem_ret((char*)a->data + (size_t)a->length * (size_t)a->esize);\n";
    out_ << "    a->length++;\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_array_slice(sd_array* a, int start, int end) {\n";
    out_ << "    if (start < 0 || end < start || end > a->length) { fprintf(stderr, \"Error: slice out of bounds (%d, %d)\\n\", start, end); exit(1); }\n";
    out_ << "    sd_array* r = (sd_array*)malloc(sizeof(sd_array));\n";
    out_ << "    if (!r) exit(1);\n";
    out_ << "    r->refs = 1;\n";
    out_ << "    r->esize = a->esize;\n";
    out_ << "    r->length = end - start;\n";
    out_ << "    r->capacity = r->length;\n";
    out_ << "    r->elem_rel = a->elem_rel;\n";
    out_ << "    r->elem_ret = a->elem_ret;\n";
    out_ << "    a->buf->refs++;\n";
    out_ << "    r->buf = a->buf;\n";
    out_ << "    r->data = a->data + (size_t)start * (size_t)a->esize;\n";
    // The view struct holds its own reference to each element in range, so
    // releasing the source array drops only the source's reference.
    out_ << "    if (a->elem_ret) {\n";
    out_ << "        char* p = r->data;\n";
    out_ << "        for (int i = 0; i < r->length; i++) { r->elem_ret(p); p += r->esize; }\n";
    out_ << "    }\n";
    out_ << "    return r;\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_array_concat(sd_array* x, sd_array* y) {\n";
    out_ << "    size_t nx = (size_t)x->length, ny = (size_t)y->length;\n";
    out_ << "    if (nx > (size_t)(INT_MAX - 16) - ny) { fprintf(stderr, \"Error: array length overflow\\n\"); exit(1); }\n";
    out_ << "    sd_array* r = sd_make_array_typed((const void*)0, 0, (int)(nx + ny), (size_t)x->esize, x->elem_rel, x->elem_ret);\n";
    out_ << "    if (nx) memcpy(r->data, x->data, nx * (size_t)x->esize);\n";
    out_ << "    if (ny) memcpy(r->data + nx * (size_t)x->esize, y->data, ny * (size_t)y->esize);\n";
    out_ << "    if (r->elem_ret) {\n";
    out_ << "        char* p = r->data;\n";
    out_ << "        for (size_t i = 0; i < nx + ny; i++) { r->elem_ret(p); p += r->esize; }\n";
    out_ << "    }\n";
    out_ << "    return r;\n";
    out_ << "}\n\n";

    out_ << "static sd_array* sd_split(sd_str* s, sd_str* sep) {\n";
    out_ << "    if (sep->len == 0) { fprintf(stderr, \"Error: split separator must not be empty\\n\"); exit(1); }\n";
    out_ << "    const char* hay = s->data;\n";
    out_ << "    const char* ndl = sep->data;\n";
    out_ << "    size_t pl = sep->len;\n";
    out_ << "    const char* hay_end = hay + s->len;   /* views lack a trailing NUL */\n";
    out_ << "    sd_array* a = sd_make_array_typed((const void*)0, 0, 0, sizeof(sd_str*), sd_rel_text, sd_ret_text);\n";
    out_ << "    const char* cur = hay;\n";
    out_ << "    for (;;) {\n";
    out_ << "        const char* hit = (const char*)0;\n";
    out_ << "        for (const char* p = cur; p + pl <= hay_end; p++) {\n";
    out_ << "            if (memcmp(p, ndl, pl) == 0) { hit = p; break; }\n";
    out_ << "        }\n";
    out_ << "        size_t len = hit ? (size_t)(hit - cur) : (size_t)(hay_end - cur);\n";
    out_ << "        sd_str* piece = sd_make_str(cur, len);\n";
    out_ << "        if (a->length >= a->capacity) {\n";
    out_ << "            size_t cap = (size_t)a->capacity * 2;\n";
    out_ << "            if (cap > (~(size_t)0 - sizeof(sd_abuf)) / sizeof(sd_str*)) { fprintf(stderr, \"Error: array capacity overflow\\n\"); exit(1); }\n";
    out_ << "            sd_abuf* nb = (sd_abuf*)malloc(sizeof(sd_abuf) + cap * sizeof(sd_str*));\n";
    out_ << "            if (!nb) exit(1);\n";
    out_ << "            nb->refs = 1;\n";
    out_ << "            nb->esize = (int)sizeof(sd_str*);\n";
    out_ << "            memcpy(nb->data, a->buf->data, (size_t)a->length * sizeof(sd_str*));\n";
    out_ << "            free(a->buf);\n";
    out_ << "            a->buf = nb;\n";
    out_ << "            a->data = nb->data;\n";
    out_ << "            a->capacity = (int)cap;\n";
    out_ << "        }\n";
    out_ << "        ((sd_str**)a->data)[a->length++] = piece;\n";
    out_ << "        if (!hit) break;\n";
    out_ << "        cur = hit + pl;\n";
    out_ << "    }\n";
    out_ << "    return a;\n";
    out_ << "}\n\n";

    out_ << "static int sd_check_index(int length, int index) {\n";
    out_ << "    if (index < 0 || index >= length) {\n";
    out_ << "        fprintf(stderr, \"Error: array index out of bounds (index %d, length %d)\\n\", index, length);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    return index;\n";
    out_ << "}\n\n";

    out_ << "static int sd_check_tuple_index(int length, int index) {\n";
    out_ << "    if (index < 0 || index >= length) {\n";
    out_ << "        fprintf(stderr, \"Error: tuple index out of bounds (index %d, length %d)\\n\", index, length);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    return index;\n";
    out_ << "}\n\n";

    out_ << "static unsigned char sd_to_byte(double v) {\n";
    out_ << "    if (v < 0 || v > 255) {\n";
    out_ << "        fprintf(stderr, \"Error: byte cast out of range (%.0f)\\n\", v);\n";
    out_ << "        exit(1);\n";
    out_ << "    }\n";
    out_ << "    return (unsigned char)v;\n";
    out_ << "}\n\n";

    // ── Closures: refcounted environments ───────────────────────────────────
    out_ << "typedef struct sd_envhdr {\n";
    out_ << "    volatile int refs;    /* references to this env */\n";
    out_ << "    void (*rel)(void*);   /* release captured values (env payload) */\n";
    out_ << "} sd_envhdr;\n\n";

    out_ << "typedef struct sd_closure {\n";
    out_ << "    void* fn;\n";
    out_ << "    void* env;\n";
    out_ << "} sd_closure;\n\n";

    out_ << "static sd_closure sd_make_closure(void* fn, void* env) {\n";
    out_ << "    sd_closure c;\n";
    out_ << "    c.fn = fn;\n";
    out_ << "    c.env = env;\n";
    out_ << "    return c;\n";
    out_ << "}\n\n";

    out_ << "static void* sd_copy_env_typed(const void* src, size_t size, void (*rel)(void*)) {\n";
    out_ << "    sd_envhdr* h = (sd_envhdr*)malloc(sizeof(sd_envhdr) + (size ? size : 1));\n";
    out_ << "    if (!h) exit(1);\n";
    out_ << "    h->refs = 1;\n";
    out_ << "    h->rel = rel;\n";
    out_ << "    if (size) memcpy((char*)(h + 1), src, size);\n";
    out_ << "    return (void*)(h + 1);\n";
    out_ << "}\n\n";

    out_ << "static void sd_retain_env(void* env) { if (env) ((sd_envhdr*)env - 1)->refs++; }\n\n";

    out_ << "static void sd_release_env(void* env) {\n";
    out_ << "    if (!env) return;\n";
    out_ << "    sd_envhdr* h = (sd_envhdr*)env - 1;\n";
    out_ << "    if (--h->refs == 0) {\n";
    out_ << "        if (h->rel) h->rel(env);\n";
    out_ << "        free(h);\n";
    out_ << "    }\n";
    out_ << "}\n\n";

    out_ << "static sd_closure sd_retain_closure(sd_closure c) { if (c.env) sd_retain_env(c.env); return c; }\n\n";

    out_ << "static void sd_release_closure(sd_closure* c) { if (c->env) sd_release_env(c->env); }\n\n";

    // ── Per-type element capture/release helpers (p = pointer to a slot) ────
    out_ << "static void sd_rel_text(void* p) { sd_str* s = *(sd_str**)p; sd_release_str(s); }\n";
    out_ << "static void sd_ret_text(void* p) { sd_str* s = *(sd_str**)p; if (s) s->refs++; }\n";
    out_ << "static void sd_rel_arr(void* p) { sd_array* a = *(sd_array**)p; sd_release_array(a); }\n";
    out_ << "static void sd_ret_arr(void* p) { sd_array* a = *(sd_array**)p; if (a) a->refs++; }\n";
    out_ << "static void sd_rel_fn(void* p) { sd_closure* c = (sd_closure*)p; sd_release_closure(c); }\n";
    out_ << "static void sd_ret_fn(void* p) { sd_closure* c = (sd_closure*)p; sd_retain_closure(*c); }\n\n";

    for (auto& stmt : program.statements) collect_tuple_types(stmt.get());

    std::vector<Statement*> top_level;

    for (auto& stmt : program.statements) {
        if (auto* fn = dynamic_cast<FunctionDecl*>(stmt.get())) {
            all_functions_.push_back(fn);
            for (auto& body_stmt : fn->body) collect_function_decls(body_stmt.get());
        } else {
            top_level.push_back(stmt.get());
        }
    }

    for (auto* s : top_level) collect_lambdas_stmt(s);
    for (size_t fi = 0; fi < all_functions_.size(); fi++) {
        collect_lambdas_stmt(all_functions_[fi]);
    }
    // Lambdas live inside expressions, so they were collected a second time
    // (they also appear as hoisted FunctionDecl statements). Dedupe by pointer.
    std::vector<FunctionDecl*> unique_fns;
    std::set<FunctionDecl*> seen_fns;
    for (auto* f : all_functions_) {
        if (seen_fns.insert(f).second) unique_fns.push_back(f);
    }
    all_functions_ = std::move(unique_fns);

    for (auto* fn : all_functions_) {
        for (auto& p : fn->params) register_desc_types(p.desc);
        register_desc_types(fn->return_desc);
        for (auto& c : fn->captures) register_desc_types(c.desc);
    }

    emit_pending_tuple_types();
    generate_tuple_helpers();
    emit_papp_helpers();

    for (auto* fn : all_functions_) {
        if (fn->name != "main" && !fn->captures.empty()) {
            out_ << "typedef struct sd_env_" << safe_name(fn->name) << " {\n";
            for (auto& c : fn->captures) {
                out_ << "    " << c_type_for_desc(c.desc) << " " << safe_name(c.name) << ";\n";
            }
            out_ << "} sd_env_" << safe_name(fn->name) << ";\n\n";
            generate_env_rel_fn(fn);
        }
    }

    for (auto* fn : all_functions_) {
        if (fn->name != "main") {
            out_ << emit_function_signature(fn) << ";\n";
        }
    }
    out_ << "\n";

    out_ << "int main(void) {\n";
    scopes_.clear();
    loop_scopes_.clear();
    break_targets_.clear();
    push_scope();

    for (auto* fn : all_functions_) {
        functions_by_name_[fn->name] = fn;
    }

    for (auto* stmt : top_level) {
        // Module top-level statements carry their own file for #line accuracy.
        line_file_ = statement_file(stmt);
        emit_stmt(stmt);
    }

    FunctionDecl* main_fn = nullptr;
    for (auto* fn : all_functions_) {
        if (fn->name == "main") main_fn = fn;
    }
    if (main_fn) {
        current_fn_ = main_fn;
        line_file_ = fn_file(main_fn);
        for (auto& body_stmt : main_fn->body) {
            emit_stmt(body_stmt.get());
        }
        current_fn_ = nullptr;
        line_file_ = source_file_;
    }

    if (!main_fn || !main_fn->has_return_type) {
        emit_releases_at_current_scope();
        out_ << "    return 0;\n";
    } else {
        // int main() with an implicit fall-through (C implicit 0): still drop
        // any owned top-level references before main exits.
        emit_releases_at_current_scope();
    }
    pop_scope();
    out_ << "}\n\n";

    for (auto* fn : all_functions_) {
        if (fn->name != "main") {
            current_fn_ = fn;
            line_file_ = fn_file(fn);
            out_ << emit_function_signature(fn) << " {\n";
            scopes_.clear();
            loop_scopes_.clear();
            break_targets_.clear();
            push_scope();
            for (auto& body_stmt : fn->body) {
                emit_stmt(body_stmt.get());
            }
            // Fall-through path: release any owned locals. Only void functions
            // may actually fall off the end; non-void functions must have
            // returned already (parity with the pre-M15 codegen, which emitted
            // no trailing return for them).
            emit_releases_at_current_scope();
            if (!fn->has_return_type) {
                out_ << "    return;\n";
            }
            pop_scope();
            out_ << "}\n\n";
        }
    }
    current_fn_ = nullptr;
    line_file_ = source_file_;
    return out_.str();
}

void CodeGen::collect_function_decls(Statement* stmt) {
    auto recurse = [this](const std::vector<StmtPtr>& list) {
        for (auto& s : list) collect_function_decls(s.get());
    };
    if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        all_functions_.push_back(fn);
        recurse(fn->body);
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        recurse(ifs->then_body);
        recurse(ifs->else_body);
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        for (auto& c : sw->cases) recurse(c.body);
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        recurse(loop->body);
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        recurse(fe->body);
    } else if (auto* w = dynamic_cast<WhileStmt*>(stmt)) {
        recurse(w->body);
    } else if (auto* f = dynamic_cast<ForStmt*>(stmt)) {
        recurse(f->body);
    } else if (auto* dw = dynamic_cast<DoWhileStmt*>(stmt)) {
        recurse(dw->body);
    }
}

void CodeGen::collect_lambdas_stmt(Statement* stmt) {
    auto recurse = [this](const std::vector<StmtPtr>& list) {
        for (auto& s : list) collect_lambdas_stmt(s.get());
    };
    if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        recurse(fn->body);
    } else if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        if (var->initializer) collect_lambdas_expr(var->initializer.get());
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        if (assign->rhs) collect_lambdas_expr(assign->rhs.get());
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        if (ma->rhs) collect_lambdas_expr(ma->rhs.get());
    } else if (auto* dd = dynamic_cast<DestructDecl*>(stmt)) {
        if (dd->rhs) collect_lambdas_expr(dd->rhs.get());
    } else if (auto* aa = dynamic_cast<ArrayAssignStmt*>(stmt)) {
        if (aa->index) collect_lambdas_expr(aa->index.get());
        if (aa->rhs) collect_lambdas_expr(aa->rhs.get());
    } else if (auto* ea = dynamic_cast<ElementAssignStmt*>(stmt)) {
        if (ea->target) collect_lambdas_expr(ea->target.get());
        if (ea->rhs) collect_lambdas_expr(ea->rhs.get());
    } else if (auto* es = dynamic_cast<ExprStmt*>(stmt)) {
        collect_lambdas_expr(es->expr.get());
    } else if (auto* ret = dynamic_cast<ReturnStmt*>(stmt)) {
        for (auto& v : ret->values) collect_lambdas_expr(v.get());
    } else if (auto* print = dynamic_cast<PrintStmt*>(stmt)) {
        for (auto& a : print->args) collect_lambdas_expr(a.get());
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        collect_lambdas_expr(ifs->condition.get());
        recurse(ifs->then_body);
        recurse(ifs->else_body);
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        collect_lambdas_expr(sw->value.get());
        for (auto& c : sw->cases) {
            if (c.value) collect_lambdas_expr(c.value.get());
            recurse(c.body);
        }
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        collect_lambdas_expr(loop->count.get());
        recurse(loop->body);
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        collect_lambdas_expr(fe->iterable.get());
        recurse(fe->body);
    } else if (auto* w = dynamic_cast<WhileStmt*>(stmt)) {
        collect_lambdas_expr(w->condition.get());
        recurse(w->body);
    } else if (auto* f = dynamic_cast<ForStmt*>(stmt)) {
        if (f->init) collect_lambdas_stmt(f->init.get());
        if (f->condition) collect_lambdas_expr(f->condition.get());
        if (f->update) collect_lambdas_stmt(f->update.get());
        recurse(f->body);
    } else if (auto* dw = dynamic_cast<DoWhileStmt*>(stmt)) {
        recurse(dw->body);
        collect_lambdas_expr(dw->condition.get());
    }
}

void CodeGen::collect_lambdas_expr(Expression* expr) {
    if (auto* lam = dynamic_cast<LambdaExpr*>(expr)) {
        if (!lam->resolved) {
            throw std::runtime_error("internal error: unresolved lambda expression");
        }
        if (walked_lambdas_.insert(lam->resolved).second) {
            collect_lambdas_stmt(lam->resolved);   // body may hold nested lambdas / declarations
            all_functions_.push_back(lam->resolved);
        }
        return;
    }
    if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->is_partial) {
            std::string m = papp_mangle(call->partial_applied, call->partial_full_params,
                                        call->partial_ret);
            if (!papp_sigs_.count(m)) {
                papp_sigs_[m] = PartialSig{call->partial_full_params, call->partial_applied,
                                           call->partial_ret};
                for (auto& p : call->partial_full_params) register_desc_types(p);
                register_desc_types(call->partial_ret);
            }
        }
        for (auto& a : call->args) collect_lambdas_expr(a.get());
    } else if (auto* arr = dynamic_cast<ArrayLiteral*>(expr)) {
        for (auto& e : arr->elements) collect_lambdas_expr(e.get());
    } else if (auto* tup = dynamic_cast<TupleLiteral*>(expr)) {
        TypeDesc d;
        d.type = TypeKind::Tuple;
        d.tuple_members = tup->resolved_members;
        register_tuple_types_deep(d);
        for (auto& v : tup->values) collect_lambdas_expr(v.get());
    } else if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        if (idx->base) collect_lambdas_expr(idx->base.get());
        collect_lambdas_expr(idx->index.get());
    } else if (auto* bin = dynamic_cast<BinaryExpr*>(expr)) {
        collect_lambdas_expr(bin->left.get());
        collect_lambdas_expr(bin->right.get());
    } else if (auto* n = dynamic_cast<NotExpr*>(expr)) {
        collect_lambdas_expr(n->operand.get());
    } else if (auto* n = dynamic_cast<NegExpr*>(expr)) {
        collect_lambdas_expr(n->operand.get());
    } else if (auto* c = dynamic_cast<ConditionalExpr*>(expr)) {
        collect_lambdas_expr(c->condition.get());
        collect_lambdas_expr(c->then_expr.get());
        collect_lambdas_expr(c->else_expr.get());
    } else if (auto* c = dynamic_cast<CastExpr*>(expr)) {
        collect_lambdas_expr(c->operand.get());
    }
}

std::string CodeGen::papp_mangle_type(const TypeDesc& d) {
    if (d.type == TypeKind::Array) return "arr_of_" + papp_mangle_type(d.element());
    if (d.type == TypeKind::Tuple) {
        std::string s = "tup";
        for (auto& m : d.tuple_members) s += "_" + papp_mangle_type(m);
        return s;
    }
    if (d.type == TypeKind::Function) {
        std::string s = "fn";
        if (d.fn_info) {
            for (auto& p : d.fn_info->params) s += "_" + papp_mangle_type(p);
            s += "_r_" + papp_mangle_type(d.fn_info->ret);
        }
        return s;
    }
    return type_to_string(d.type);
}

std::string CodeGen::papp_mangle(int applied, const std::vector<TypeDesc>& full,
                                 const TypeDesc& ret) const {
    std::string s = "sd_papp";
    for (auto& p : full) s += "_" + papp_mangle_type(p);
    s += "_to_" + papp_mangle_type(ret) + "_k" + std::to_string(applied);
    return s;
}

void CodeGen::emit_papp_helpers() {
    for (auto& [mangle, ps] : papp_sigs_) {
        std::string env_name = mangle + "_e";
        out_ << "typedef struct " << env_name << " {\n";
        out_ << "    sd_closure orig;\n";
        for (int i = 0; i < ps.applied; i++) {
            out_ << "    " << c_type_for_desc(ps.full[i]) << " a" << i << ";\n";
        }
        out_ << "} " << env_name << ";\n\n";
        out_ << "static " << c_type_for_desc(ps.ret) << " " << mangle << "(void* e";
        for (size_t i = (size_t)ps.applied; i < ps.full.size(); i++) {
            out_ << ", " << c_type_for_desc(ps.full[i]) << " p" << i;
        }
        out_ << ") {\n";
        out_ << "    " << env_name << "* _sd_p = (" << env_name << "*)e;\n";
        if (ps.ret.type == TypeKind::Unknown) {
            out_ << "    ((void (*)(void*";
            for (size_t i = 0; i < ps.full.size(); i++) {
                out_ << ", " << c_type_for_desc(ps.full[i]);
            }
            out_ << "))_sd_p->orig.fn)(_sd_p->orig.env";
        } else {
            out_ << "    return ((" << c_type_for_desc(ps.ret) << " (*)(void*";
            for (size_t i = 0; i < ps.full.size(); i++) {
                out_ << ", " << c_type_for_desc(ps.full[i]);
            }
            out_ << "))_sd_p->orig.fn)(_sd_p->orig.env";
        }
        for (int i = 0; i < ps.applied; i++) {
            out_ << ", _sd_p->a" << i;
        }
        for (size_t i = (size_t)ps.applied; i < ps.full.size(); i++) {
            out_ << ", p" << i;
        }
        out_ << ");\n";
        if (ps.ret.type == TypeKind::Unknown) {
            out_ << "    return;\n";
        }
        out_ << "}\n\n";
        // Release function for the papp env: drop the orig closure and every
        // heap-typed applied arg it owns.
        out_ << "static void sd_rel_" << env_name << "(void* p) {\n";
        out_ << "    " << env_name << "* _e = (" << env_name << "*)p;\n";
        out_ << "    sd_release_closure(&_e->orig);\n";
        for (int i = 0; i < ps.applied; i++) {
            if (type_has_heap(ps.full[i])) {
                emit_release_value("_e->a" + std::to_string(i), ps.full[i]);
                out_ << "\n";
            }
        }
        out_ << "}\n\n";
    }
}

std::string CodeGen::emit_function_signature(FunctionDecl* fn) {
    std::string s;
    if (fn->has_return_type) {
        if (fn->return_type == TypeKind::Tuple) {
            s += tuple_name(fn->return_tuple_members);
        } else if (fn->return_type == TypeKind::Array) {
            s += c_type_for_desc(fn->return_desc);
        } else {
            s += type_to_c(fn->return_type);
        }
    } else {
        s += "void";
    }
    s += " " + safe_name(fn->name) + "(";
    if (fn->name != "main") s += "void* _sd_env";
    if (fn->name != "main" && fn->has_nonlocal) s += ", void* _sd_nl";
    for (size_t i = 0; i < fn->params.size(); i++) {
        if (i > 0 || fn->name != "main") s += ", ";
        s += c_type_for_desc(codegen_param_desc(fn->params[i])) + " " + safe_name(fn->params[i].name);
    }
    s += ")";
    return s;
}

std::string CodeGen::c_type_for_desc(const TypeDesc& d) {
    if (d.type == TypeKind::Array) return "sd_array*";
    if (d.type == TypeKind::Tuple) return tuple_name(d.tuple_members);
    if (d.type == TypeKind::Function) return "sd_closure";
    return type_to_c(d.type);
}

void CodeGen::register_desc_types(const TypeDesc& d) {
    if (d.type == TypeKind::Tuple) {
        register_tuple_types_deep(d);
    }
    if (d.type == TypeKind::Function && d.fn_info) {
        for (auto& p : d.fn_info->params) register_desc_types(p);
        register_desc_types(d.fn_info->ret);
    }
}

bool CodeGen::is_capture(const FunctionDecl* fn, const std::string& name) const {
    if (!fn) return false;
    for (auto& c : fn->captures) {
        if (c.name == name) return true;
    }
    return false;
}

void CodeGen::emit_env_arg(const FunctionDecl* callee) {
    if (callee->name == "main" || callee->captures.empty()) {
        out_ << "((void*)0)";
        return;
    }
    out_ << "(void*)&(sd_env_" << safe_name(callee->name) << "){";;
    for (size_t i = 0; i < callee->captures.size(); i++) {
        if (i > 0) out_ << ", ";
        // Cast to the field type so a `const` captured text/array (top-level
        // `const` state, M14) doesn't trip gcc -Wdiscarded-qualifiers.
        out_ << "(" << c_type_for_desc(callee->captures[i].desc) << ")";
        emit_identifier_value(callee->captures[i].name);
    }
    out_ << "}";
}

void CodeGen::emit_env_heap_arg(const FunctionDecl* callee) {
    if (callee->name == "main" || callee->captures.empty()) {
        out_ << "((void*)0)";
        return;
    }
    // A fresh refcounted env owned by the new closure: capture VALUES are read
    // as borrows, then each heap-typed capture is RETAINED so the env owns its
    // own reference. sd_copy_env_typed allocates the sd_envhdr header + payload.
    out_ << "({ sd_env_" << safe_name(callee->name) << " _e = {";
    for (size_t i = 0; i < callee->captures.size(); i++) {
        if (i > 0) out_ << ", ";
        out_ << "(" << c_type_for_desc(callee->captures[i].desc) << ")";
        emit_identifier_value(callee->captures[i].name);
    }
    out_ << "}; ";
    for (auto& c : callee->captures) {
        if (!type_has_heap(c.desc)) continue;
        out_ << slot_ret_name(c.desc) << "(&_e." << safe_name(c.name) << "); ";
    }
    out_ << "sd_copy_env_typed(&_e, sizeof(sd_env_" << safe_name(callee->name)
         << "), sd_rel_env_" << safe_name(callee->name) << "); })";
}

std::string CodeGen::safe_name(const std::string& name) const {
    if (name == "main") return name;
    if (name.rfind("__lam_", 0) == 0) return name;  // resolver-synthesized lambdas
    return "hmx_" + name;
}

void CodeGen::emit_identifier_value(const std::string& name) {
    if (current_fn_ && is_capture(current_fn_, name)) {
        out_ << "((sd_env_" << safe_name(current_fn_->name) << "*) _sd_env)->" << safe_name(name);
    } else {
        out_ << safe_name(name);
    }
}

void CodeGen::emit_line_directive(int line, const std::string& file) {
    out_ << "#line " << line << " \"" << file << "\"\n";
}

TypeKind CodeGen::get_expr_type(Expression* expr) {
    return expr->resolved_type;
}

static std::string mangle_type_name(const TypeDesc& d) {
    if (d.type == TypeKind::Array)
        return "arr_of_" + mangle_type_name(d.element());
    if (d.type == TypeKind::Tuple) {
        std::string s = "tup";
        for (auto& m : d.tuple_members) s += "_" + mangle_type_name(m);
        return s;
    }
    return type_to_string(d.type);
}

std::string CodeGen::tuple_name(const std::vector<TypeDesc>& members) const {
    auto it = tuple_types_.find(members);
    if (it != tuple_types_.end()) return it->second;
    std::string name = "sd_tuple";
    for (auto& m : members) {
        name += "_" + mangle_type_name(m);
    }
    tuple_types_[members] = name;
    return name;
}

void CodeGen::register_tuple_types_deep(const TypeDesc& d) {
    if (d.type == TypeKind::Tuple) {
        tuple_name(d.tuple_members);
        for (auto& m : d.tuple_members) register_tuple_types_deep(m);
    } else if (d.type == TypeKind::Array) {
        register_tuple_types_deep(d.element());
    } else if (d.type == TypeKind::Function && d.fn_info) {
        for (auto& p : d.fn_info->params) register_tuple_types_deep(p);
        register_tuple_types_deep(d.fn_info->ret);
    }
}

void CodeGen::emit_pending_tuple_types() {
    std::set<std::vector<TypeDesc>> emitted;
    bool progress = true;
    while (progress) {
        progress = false;
        std::vector<std::pair<std::vector<TypeDesc>, std::string>> pending;
        for (auto& [members, name] : tuple_types_) {
            if (!emitted.count(members)) pending.push_back({members, name});
        }
        for (auto& [members, name] : pending) {
            if (emitted.count(members)) continue;
            bool ready = true;
            for (auto& m : members) {
                if (m.type == TypeKind::Tuple && !emitted.count(m.tuple_members)) {
                    ready = false;
                    break;
                }
            }
            if (!ready) continue;
            out_ << "typedef struct " << name << " {\n";
            for (size_t i = 0; i < members.size(); i++) {
                out_ << "    " << c_type_for_desc(members[i]) << " f" << i << ";\n";
            }
            out_ << "} " << name << ";\n\n";
            emitted.insert(members);
            progress = true;
        }
    }
}

void CodeGen::collect_tuple_types(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        if (var->annotation == TypeKind::Tuple && !var->tuple_members.empty()) {
            TypeDesc d{TypeKind::Tuple, {}, var->tuple_members, {}};
            register_tuple_types_deep(d);
        }
    } else if (auto* td = dynamic_cast<DestructDecl*>(stmt)) {
        for (auto& p : td->patterns) register_tuple_types_deep(p.vdesc);
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        for (auto& p : ma->patterns) register_tuple_types_deep(p.vdesc);
    } else if (auto* fn = dynamic_cast<FunctionDecl*>(stmt)) {
        for (auto& p : fn->params) {
            if (p.type == TypeKind::Tuple && !p.tuple_members.empty()) {
                TypeDesc d{TypeKind::Tuple, {}, p.tuple_members, {}};
                register_tuple_types_deep(d);
            }
        }
        if (fn->return_type == TypeKind::Tuple && !fn->return_tuple_members.empty()) {
            TypeDesc d{TypeKind::Tuple, {}, fn->return_tuple_members, {}};
            register_tuple_types_deep(d);
        }
        for (auto& s : fn->body) collect_tuple_types(s.get());
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        for (auto& s : loop->body) collect_tuple_types(s.get());
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        for (auto& s : fe->body) collect_tuple_types(s.get());
    } else if (auto* w = dynamic_cast<WhileStmt*>(stmt)) {
        for (auto& s : w->body) collect_tuple_types(s.get());
    } else if (auto* f = dynamic_cast<ForStmt*>(stmt)) {
        collect_tuple_types(f->init.get());
        collect_tuple_types(f->update.get());
        for (auto& s : f->body) collect_tuple_types(s.get());
    } else if (auto* dw = dynamic_cast<DoWhileStmt*>(stmt)) {
        for (auto& s : dw->body) collect_tuple_types(s.get());
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        for (auto& s : ifs->then_body) collect_tuple_types(s.get());
        for (auto& s : ifs->else_body) collect_tuple_types(s.get());
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        for (auto& c : sw->cases) for (auto& s : c.body) collect_tuple_types(s.get());
    } else if (auto* ret = dynamic_cast<ReturnStmt*>(stmt)) {
        if (ret->values.size() > 1 && !ret->return_tuple_members.empty()) {
            TypeDesc d{TypeKind::Tuple, {}, ret->return_tuple_members, {}};
            register_tuple_types_deep(d);
        }
    }
}

void CodeGen::emit_expr(Expression* expr, bool parenthesize) {
    if (auto* num = dynamic_cast<NumberLiteral*>(expr)) {
        out_ << num->value;
    } else if (auto* dec = dynamic_cast<DecimalLiteral*>(expr)) {
        // Emit a shortest-round-trip double literal so the C text is always a
        // genuine double (e.g. "6.0", never "6" — an int passed to %f is UB).
        std::array<char, 40> buf{};
        auto [ptr, ec] = std::to_chars(buf.data(), buf.data() + buf.size(), dec->value);
        std::string s(buf.data(), ptr);
        if (s.find_first_of(".eE") == std::string::npos) s += ".0";
        out_ << s;
    } else if (auto* str = dynamic_cast<StringLiteral*>(expr)) {
        // Materialize every literal as an owned refcounted string (rodata can
        // never be released, so a literal must become a heap sd_str at use).
        out_ << "sd_make_str(\"" << str->value << "\", sizeof(\"" << str->value << "\") - 1)";
    } else if (auto* ch = dynamic_cast<CharLiteral*>(expr)) {
        out_ << "'";
        if (ch->value == '\\' || ch->value == '\'') out_ << '\\';
        out_ << ch->value << "'";
    } else if (auto* bl = dynamic_cast<BoolLiteral*>(expr)) {
        out_ << (bl->value ? "1" : "0");
    } else if (auto* id = dynamic_cast<Identifier*>(expr)) {
        if (id->is_function_reference) {
            auto it = functions_by_name_.find(id->name);
            if (it != functions_by_name_.end()) {
                out_ << "sd_make_closure((void*)" << safe_name(id->name) << ", ";
                emit_env_heap_arg(it->second);
                out_ << ")";
            } else {
                throw std::runtime_error("internal error: unknown function reference '" + id->name + "'");
            }
        } else {
            emit_identifier_value(id->name);
        }
    } else if (auto* lam = dynamic_cast<LambdaExpr*>(expr)) {
        if (!lam->resolved) {
            throw std::runtime_error("internal error: unresolved lambda expression");
        }
        out_ << "sd_make_closure((void*)" << lam->resolved->name << ", ";
        emit_env_heap_arg(lam->resolved);
        out_ << ")";
    } else if (auto* call = dynamic_cast<CallExpr*>(expr)) {
        if (call->name == "length") {
            if (get_expr_type(call->args[0].get()) == TypeKind::Array) {
                out_ << "({ sd_array* _sd_l = ";
                emit_owned_expr(call->args[0].get());
                out_ << "; int _sd_lr = _sd_l->length; sd_release_array(_sd_l); _sd_lr; })";
            } else {
                out_ << "({ sd_str* _sd_l = ";
                emit_owned_expr(call->args[0].get());
                out_ << "; int _sd_lr = (int)_sd_l->len; sd_release_str(_sd_l); _sd_lr; })";
            }
        } else if (call->name == "substring") {
            out_ << "({ sd_str* _sd_s = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; int _sd_x = ";
            emit_expr(call->args[1].get());
            out_ << "; int _sd_y = ";
            emit_expr(call->args[2].get());
            out_ << "; sd_str* _sd_r = sd_str_view(_sd_s, (size_t)_sd_x, (size_t)(_sd_y - _sd_x)); "
                 << "sd_release_str(_sd_s); _sd_r; })";
        } else if (call->name == "ord") {
            out_ << "((int)(unsigned char)(";
            emit_expr(call->args[0].get());
            out_ << "))";
        } else if (call->name == "chr") {
            out_ << "({ int _sd_c = (";
            emit_expr(call->args[0].get());
            out_ << "); if (_sd_c < 0 || _sd_c > 255) { fprintf(stderr, \"Error: chr expects a character code between 0 and 255, got %d\\n\", _sd_c); exit(1); } (char)_sd_c; })";
        } else if (call->name == "split") {
            out_ << "({ sd_str* _sd_x = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; sd_str* _sd_y = ";
            emit_owned_expr(call->args[1].get());
            out_ << "; sd_array* _sd_r = sd_split(_sd_x, _sd_y); "
                 << "sd_release_str(_sd_x); sd_release_str(_sd_y); _sd_r; })";
        } else if (call->name == "push") {
            std::string T = c_type_for_desc(call->array_aux);
            out_ << "({ sd_array* _sd_r = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; " << T << " _sd_v = ";
            emit_owned_expr(call->args[1].get());
            out_ << "; sd_push(_sd_r, &_sd_v, sizeof(" << T << ")); ";
            // sd_push retains heap elements, so the temp reference must be
            // dropped (the array now owns its own reference to the element).
            if (type_has_heap(call->array_aux)) {
                emit_release_value("_sd_v", call->array_aux);
            }
            out_ << "_sd_r; })";
        } else if (call->name == "pop") {
            std::string T = c_type_for_desc(call->array_aux);
            out_ << "({ sd_array* _sd_p = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; if (_sd_p->length == 0) { fprintf(stderr, \"Error: pop on empty array\\n\"); exit(1); } "
                 << "--_sd_p->length; " << T << " _sd_v = *((" << T
                 << "*)((char*)_sd_p->data + (size_t)_sd_p->length * sizeof(" << T << "))); "
                 << "sd_release_array(_sd_p); _sd_v; })";
        } else if (call->name == "sort") {
            std::string T = c_type_for_desc(call->array_aux);
            bool is_text = call->array_aux.type == TypeKind::Text;
            out_ << "({ sd_array* _sd_a = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; sd_detach(_sd_a); for (int _sd_i = 1; _sd_i < _sd_a->length; _sd_i++) { "
                 << "for (int _sd_j = _sd_i; _sd_j > 0; _sd_j--) { ";
            if (is_text) {
                out_ << "int _sd_c = sd_str_cmp(((" << T << "*)_sd_a->data)[_sd_j - 1], (("
                     << T << "*)_sd_a->data)[_sd_j]); ";
            } else {
                out_ << "int _sd_c = ((" << T << "*)_sd_a->data)[_sd_j - 1] > (("
                     << T << "*)_sd_a->data)[_sd_j]; ";
            }
            out_ << "if (_sd_c <= 0) break; " << T << " _sd_w = ((" << T
                 << "*)_sd_a->data)[_sd_j]; "
                 << "((" << T << "*)_sd_a->data)[_sd_j] = ((" << T
                 << "*)_sd_a->data)[_sd_j - 1]; "
                 << "((" << T << "*)_sd_a->data)[_sd_j - 1] = _sd_w; } } _sd_a; })";
        } else if (call->name == "slice") {
            out_ << "({ sd_array* _sd_s = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; int _sd_a = ";
            emit_expr(call->args[1].get());
            out_ << "; int _sd_b = ";
            emit_expr(call->args[2].get());
            out_ << "; sd_array* _sd_r = sd_array_slice(_sd_s, _sd_a, _sd_b); "
                 << "sd_release_array(_sd_s); _sd_r; })";
        } else if (call->name == "concat") {
            out_ << "({ sd_array* _sd_x = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; sd_array* _sd_y = ";
            emit_owned_expr(call->args[1].get());
            out_ << "; sd_array* _sd_c = sd_array_concat(_sd_x, _sd_y); "
                 << "sd_release_array(_sd_x); sd_release_array(_sd_y); _sd_c; })";
        } else if (call->name == "index_of" || call->name == "contains") {
            std::string T = c_type_for_desc(call->array_aux);
            bool is_text = call->array_aux.type == TypeKind::Text;
            out_ << "({ " << T << " _sd_v = ";
            emit_owned_expr(call->args[1].get());
            out_ << "; sd_array* _sd_a = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; int _sd_r = " << (call->name == "index_of" ? "-1" : "0") << "; "
                 << "for (int _sd_i = 0; _sd_i < _sd_a->length; _sd_i++) { ";
            if (is_text) {
                out_ << "int _sd_f = sd_str_equals(((" << T << "*)_sd_a->data)[_sd_i], _sd_v); ";
            } else {
                out_ << "int _sd_f = ((" << T << "*)_sd_a->data)[_sd_i] == _sd_v; ";
            }
            if (call->name == "index_of") {
                out_ << "if (_sd_f) { _sd_r = _sd_i; break; } } ";
            } else {
                out_ << "if (_sd_f) { _sd_r = 1; break; } } ";
            }
            out_ << "sd_release_array(_sd_a); ";
            emit_release_value("_sd_v", call->array_aux);
            out_ << "_sd_r; })";
        } else if (call->name == "input") {
            out_ << "sd_read_line()";
        } else if (call->name == "tostr") {
            TypeKind at = get_expr_type(call->args[0].get());
            if (at == TypeKind::Text) {
                emit_owned_expr(call->args[0].get());
            } else if (at == TypeKind::Decimal) {
                out_ << "sd_to_str_decimal(";
                emit_expr(call->args[0].get());
                out_ << ")";
            } else if (at == TypeKind::Char) {
                out_ << "sd_to_str_char(";
                emit_expr(call->args[0].get());
                out_ << ")";
            } else {
                out_ << "sd_to_str_int(";
                emit_expr(call->args[0].get());
                out_ << ")";
            }
        } else if (call->name == "parse_int") {
            out_ << "({ sd_str* _sd_p = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; int _sd_r = sd_parse_int(_sd_p); sd_release_str(_sd_p); _sd_r; })";
        } else if (call->name == "parse_decimal") {
            out_ << "({ sd_str* _sd_p = ";
            emit_owned_expr(call->args[0].get());
            out_ << "; double _sd_r = sd_parse_decimal(_sd_p); sd_release_str(_sd_p); _sd_r; })";
        } else if (call->is_partial) {
            std::string mangle = papp_mangle(call->partial_applied, call->partial_full_params,
                                             call->partial_ret);
            if (!papp_sigs_.count(mangle)) {
                throw std::runtime_error("internal error: partial application signature not registered");
            }
            std::string env_name = mangle + "_e";
            // The orig closure value and each heap-typed applied arg are fresh
            // owned values that TRANSFER into the refcounted papp env.
            out_ << "({ sd_closure _sd_b = ";
            if (call->is_function_value_call) {
                out_ << "({ sd_closure _t = ";
                emit_identifier_value(call->name);
                out_ << "; _t = sd_retain_closure(_t); _t; })";
            } else {
                auto it = functions_by_name_.find(call->name);
                if (it == functions_by_name_.end()) {
                    throw std::runtime_error("internal error: unknown function '" + call->name + "'");
                }
                out_ << "sd_make_closure((void*)" << safe_name(call->name) << ", ";
                emit_env_heap_arg(it->second);
                out_ << ")";
            }
            out_ << "; ";
            for (size_t i = 0; i < call->args.size(); i++) {
                if (type_has_heap(call->partial_full_params[i])) {
                    out_ << c_type_for_desc(call->partial_full_params[i]) << " _sd_pa" << i << " = ";
                    emit_owned_expr(call->args[i].get());
                    out_ << "; ";
                }
            }
            out_ << "sd_make_closure((void*)" << mangle << ", sd_copy_env_typed(&(" << env_name << "){ _sd_b";
            for (size_t i = 0; i < call->args.size(); i++) {
                out_ << ", ";
                if (type_has_heap(call->partial_full_params[i])) {
                    out_ << "_sd_pa" << i;
                } else {
                    emit_expr(call->args[i].get());
                }
            }
            out_ << " }, sizeof(" << env_name << "), sd_rel_" << env_name << ")); })";
        } else if (call->is_function_value_call) {
            const FunctionTypeInfo& info = *call->fn_type.fn_info;
            std::vector<Expression*> eff_args;
            for (auto& a : call->args) eff_args.push_back(a.get());
            emit_wrapped_call(eff_args, info.params, info.ret,
                [this, call, &info](const std::vector<std::string>& tn) {
                    out_ << "((" << c_type_for_desc(info.ret) << " (*)(void*";
                    for (size_t i = 0; i < info.params.size(); i++) {
                        out_ << ", " << c_type_for_desc(info.params[i]);
                    }
                    out_ << "))";
                    emit_identifier_value(call->name);
                    out_ << ".fn)(";
                    emit_identifier_value(call->name);
                    out_ << ".env";
                    for (size_t i = 0; i < call->args.size(); i++) {
                        out_ << ", ";
                        if (i < tn.size() && !tn[i].empty()) out_ << tn[i];
                        else emit_expr(call->args[i].get());
                    }
                    out_ << ")";
                });
        } else {
            auto it = functions_by_name_.find(call->name);
            if (it != functions_by_name_.end()) {
                const FunctionDecl* callee = it->second;
                size_t variadic_index = (size_t)-1;
                for (size_t i = 0; i < callee->params.size(); i++) {
                    if (callee->params[i].variadic) { variadic_index = i; break; }
                }
                size_t fixed = (variadic_index == (size_t)-1) ? callee->params.size() : variadic_index;
                std::vector<Expression*> eff_args;
                std::vector<TypeDesc> param_descs;
                for (size_t i = 0; i < fixed; i++) {
                    param_descs.push_back(codegen_param_desc(callee->params[i]));
                    eff_args.push_back(i < call->args.size() ? call->args[i].get()
                                                             : callee->params[i].default_value.get());
                }
                const TypeDesc ret_desc = callee->return_desc;
                bool is_var = variadic_index != (size_t)-1;
                const TypeDesc vdesc = is_var ? TypeDesc::array_of(callee->params[variadic_index].elem_desc)
                                              : TypeDesc{};
                const FunctionDecl* cc = callee;
                emit_wrapped_call(eff_args, param_descs, ret_desc,
                    [this, cc, &eff_args, is_var](const std::vector<std::string>& tn) {
                        out_ << safe_name(cc->name) << "(";
                        emit_env_arg(cc);
                        if (cc->has_nonlocal) {
                            out_ << ", (void*)_sd_nl_buf" << cc->nl_target_loop_id;
                        }
                        for (size_t i = 0; i < eff_args.size(); i++) {
                            out_ << ", ";
                            if (i < tn.size() && !tn[i].empty()) out_ << tn[i];
                            else emit_expr(eff_args[i]);
                        }
                        if (is_var) out_ << ", _sd_va";
                        out_ << ")";
                    },
                    [this, cc, call, variadic_index, fixed]() {
                        if (variadic_index == (size_t)-1) return;
                        TypeDesc ed = cc->params[variadic_index].elem_desc;
                        bool heap = type_has_heap(ed);
                        std::string rel = heap ? ("(void(*)(void*))" + slot_rel_name(ed)) : "((void(*)(void*))0)";
                        std::string ret = heap ? ("(void(*)(void*))" + slot_ret_name(ed)) : "((void(*)(void*))0)";
                        out_ << "sd_array* _sd_va = ";
                        if (call->args.size() > fixed) {
                            out_ << "sd_make_array_typed((" << c_type_for_desc(ed) << "[]){";
                            for (size_t i = fixed; i < call->args.size(); i++) {
                                if (i > fixed) out_ << ", ";
                                if (heap) emit_owned_expr(call->args[i].get());
                                else emit_expr(call->args[i].get());
                            }
                            out_ << "}, sizeof(" << c_type_for_desc(ed) << ") * "
                                 << (call->args.size() - fixed) << ", " << (call->args.size() - fixed)
                                 << ", sizeof(" << c_type_for_desc(ed) << "), " << rel << ", " << ret << ")";
                        } else {
                            out_ << "sd_make_array_typed(0, 0, 0, sizeof(" << c_type_for_desc(ed) << "), "
                                 << rel << ", " << ret << ")";
                        }
                        out_ << "; ";
                    },
                    [this, is_var]() {
                        if (is_var) out_ << "sd_release_array(_sd_va); ";
                    });
            } else {
                out_ << safe_name(call->name) << "(";
                for (size_t i = 0; i < call->args.size(); i++) {
                    if (i > 0) out_ << ", ";
                    emit_expr(call->args[i].get());
                }
                out_ << ")";
            }
        }
    } else if (auto* not_expr = dynamic_cast<NotExpr*>(expr)) {
        out_ << "!(";
        emit_expr(not_expr->operand.get());
        out_ << ")";
    } else if (auto* neg = dynamic_cast<NegExpr*>(expr)) {
        out_ << "-(";
        emit_expr(neg->operand.get());
        out_ << ")";
    } else if (auto* arr = dynamic_cast<ArrayLiteral*>(expr)) {
        // Elements TRANSFER into the fresh array: fresh values keep refs=1,
        // borrows are retained by emit_owned_expr so the array owns its share.
        TypeDesc ed = arr->elem;
        std::string ct = c_type_for_desc(ed);
        bool heap_elem = type_has_heap(ed);
        std::string rel = heap_elem ? "(void(*)(void*))" + slot_rel_name(ed)
                                    : "((void(*)(void*))0)";
        std::string rtr = heap_elem ? "(void(*)(void*))" + slot_ret_name(ed)
                                    : "((void(*)(void*))0)";
        if (arr->elements.empty()) {
            out_ << "sd_make_array_typed(0, 0, 0, sizeof(" << ct << "), " << rel << ", " << rtr << ")";
        } else {
            out_ << "sd_make_array_typed((" << ct << "[]){";
            for (size_t i = 0; i < arr->elements.size(); i++) {
                if (i > 0) out_ << ", ";
                if (heap_elem) emit_owned_expr(arr->elements[i].get());
                else emit_expr(arr->elements[i].get());
            }
            out_ << "}, sizeof(" << ct << ") * "
                 << arr->elements.size() << ", " << arr->elements.size() << ", sizeof("
                 << ct << "), " << rel << ", " << rtr << ")";
        }
    } else if (auto* tup = dynamic_cast<TupleLiteral*>(expr)) {
        // Fresh tuple: heap members are owned by the tuple via transfer.
        out_ << "(" << tuple_name(tup->resolved_members) << "){ ";
        for (size_t i = 0; i < tup->values.size(); i++) {
            if (i > 0) out_ << ", ";
            if (type_has_heap(tup->resolved_members[i])) emit_owned_expr(tup->values[i].get());
            else emit_expr(tup->values[i].get());
        }
        out_ << " }";
    } else if (auto* idx = dynamic_cast<ArrayIndexExpr*>(expr)) {
        if (idx->base) {
            if (idx->is_tuple) {
                if (idx->tuple_dynamic) {
                    out_ << "(((" << c_type_for_desc(idx->elem) << "*)(&";
                    emit_expr(idx->base.get());
                    out_ << "))[sd_check_tuple_index(" << idx->tuple_arity << ", ";
                    emit_expr(idx->index.get());
                    out_ << ")])";
                } else {
                    emit_expr(idx->base.get());
                    out_ << ".f" << idx->member_index;
                }
            } else if (idx->is_text) {
                // Single-eval the base (may be a fresh expression) via an owned
                // temp; the char is read then the temp released (parity: web is
                // single-eval too).
                out_ << "({ sd_str* _tb = ";
                emit_owned_expr(idx->base.get());
                out_ << "; char _tc = _tb->data[sd_check_index((int)_tb->len, ";
                emit_expr(idx->index.get());
                out_ << ")]; sd_release_str(_tb); _tc; })";
            } else {
                std::string ct = c_type_for_desc(idx->elem);
                out_ << "((" << ct << "*)";
                emit_expr(idx->base.get());
                out_ << "->data)";
                out_ << "[sd_check_index(";
                emit_expr(idx->base.get());
                out_ << "->length, ";
                emit_expr(idx->index.get());
                out_ << ")]";
            }
        } else if (idx->is_tuple) {
            if (idx->tuple_dynamic) {
                out_ << "(((" << c_type_for_desc(idx->elem) << "*)(&";
                emit_identifier_value(idx->name);
                out_ << "))[sd_check_tuple_index(" << idx->tuple_arity << ", ";
                emit_expr(idx->index.get());
                out_ << ")])";
            } else {
                emit_identifier_value(idx->name);
                out_ << ".f" << idx->member_index;
            }
        } else if (idx->is_text) {
            out_ << "({ sd_str* _tb = ({ sd_str* _r = ";
            emit_identifier_value(idx->name);
            out_ << "; sd_retain_str(_r); _r; }); char _tc = _tb->data[sd_check_index((int)_tb->len, ";
            emit_expr(idx->index.get());
            out_ << ")]; sd_release_str(_tb); _tc; })";
        } else {
            out_ << "((" << c_type_for_desc(idx->elem) << "*)";
            emit_identifier_value(idx->name);
            out_ << "->data)";
            out_ << "[sd_check_index(";
            emit_identifier_value(idx->name);
            out_ << "->length, ";
            emit_expr(idx->index.get());
            out_ << ")]";
        }
    } else if (auto* conditional = dynamic_cast<ConditionalExpr*>(expr)) {
        // A heap result must be OWNED whichever branch runs; emit per-branch
        // owned values into a temp so the result is always an owned value.
        TypeDesc cd = desc_of_expr(conditional);
        if (type_has_heap(cd)) {
            out_ << "({ " << c_type_for_desc(cd) << " _cv; if (";
            emit_expr(conditional->condition.get());
            out_ << ") _cv = ";
            emit_owned_expr(conditional->then_expr.get());
            out_ << "; else _cv = ";
            emit_owned_expr(conditional->else_expr.get());
            out_ << "; _cv; })";
        } else {
            out_ << "(";
            emit_expr(conditional->condition.get());
            out_ << " ? ";
            emit_expr(conditional->then_expr.get());
            out_ << " : ";
            emit_expr(conditional->else_expr.get());
            out_ << ")";
        }
    } else if (auto* cast = dynamic_cast<CastExpr*>(expr)) {
        if (cast->target_type == TypeKind::Byte) {
            out_ << "sd_to_byte(";
            emit_expr(cast->operand.get());
            out_ << ")";
        } else {
            out_ << "(" << type_to_c(cast->target_type) << ")(";
            emit_expr(cast->operand.get());
            out_ << ")";
        }
    } else if (auto* bin = dynamic_cast<BinaryExpr*>(expr)) {
        if (bin->kind == ExprKind::Arithmetic && bin->op == "+" &&
            get_expr_type(bin->left.get()) == TypeKind::Text) {
            // Own both operands for the duration of sd_concat then release.
            out_ << "({ sd_str* _a = ";
            emit_owned_expr(bin->left.get());
            out_ << "; sd_str* _b = ";
            emit_owned_expr(bin->right.get());
            out_ << "; sd_str* _r = sd_concat(_a, _b); sd_release_str(_a); sd_release_str(_b); _r; })";
        } else if (bin->kind == ExprKind::Comparison &&
            get_expr_type(bin->left.get()) == TypeKind::Text) {
            out_ << "({ sd_str* _a = ";
            emit_owned_expr(bin->left.get());
            out_ << "; sd_str* _b = ";
            emit_owned_expr(bin->right.get());
            out_ << "; int _r = "
                 << (bin->op == "!=" ? "!" : "")
                 << "sd_str_equals(_a, _b)"
                 << "; sd_release_str(_a); sd_release_str(_b); _r; })";
        } else {
            if (parenthesize) out_ << "(";
            bool pl = dynamic_cast<BinaryExpr*>(bin->left.get()) != nullptr;
            bool pr = dynamic_cast<BinaryExpr*>(bin->right.get()) != nullptr;
            if (pl) out_ << "(";
            emit_expr(bin->left.get());
            if (pl) out_ << ")";
            out_ << " " << bin->op << " ";
            if (pr) out_ << "(";
            emit_expr(bin->right.get());
            if (pr) out_ << ")";
            if (parenthesize) out_ << ")";
        }
    }
}

void CodeGen::emit_binding(const DestructPattern& slot, const std::string& rhs,
                           const TypeDesc& vd, bool declare) {
    out_ << "    ";
    if (declare) {
        out_ << c_type_for_desc(vd) << " " << safe_name(slot.name) << " = ";
        if (type_has_heap(vd)) {
            // rhs reads a heap value (tuple member / array element): retain so
            // the new local owns its own reference.
            out_ << "({ " << c_type_for_desc(vd) << " _v = (" << rhs << "); "
                 << slot_ret_name(vd) << "(&_v); _v; })";
        } else {
            out_ << rhs;
        }
        out_ << ";\n";
        declare_owned(safe_name(slot.name), vd);
    } else {
        // Multi-assign: retain the new value's ref, drop the target's old ref,
        // then store.
        if (type_has_heap(vd)) {
            out_ << "({ " << c_type_for_desc(vd) << " _v = (" << rhs << "); "
                 << slot_ret_name(vd) << "(&_v); ";
            emit_release_value(safe_name(slot.name), vd);
            out_ << safe_name(slot.name) << " = _v; });\n";
        } else {
            out_ << safe_name(slot.name) << " = " << rhs << ";\n";
        }
    }
}

void CodeGen::emit_destruct_level(const std::vector<DestructPattern>& slots,
                                  const std::string& src, const TypeDesc& val,
                                  bool declare) {
    if (val.type == TypeKind::Tuple) {
        for (size_t i = 0; i < slots.size(); i++) {
            const DestructPattern& slot = slots[i];
            const TypeDesc& member = val.tuple_members[i];
            std::string member_src = "(" + src + ").f" + std::to_string(i);
            if (slot.nested) {
                emit_destruct_level(slot.items, member_src, member, declare);
            } else {
                emit_binding(slot, member_src, member, declare);
            }
        }
        return;
    }
    if (val.type == TypeKind::Array) {
        const TypeDesc& elem = val.element();
        TypeDesc arr_desc;
        arr_desc.type = TypeKind::Array;
        arr_desc.elem = std::make_shared<TypeDesc>(elem);
        size_t n = 0;
        for (auto& p : slots) if (!p.is_rest) n++;
        out_ << "    if (" << src << "->length < " << n << ") { fprintf(stderr, \"Error: cannot destructure array of length %d into " << n << " targets\\n\", " << src << "->length); exit(1); }\n";
        size_t fix_i = 0;
        for (size_t i = 0; i < slots.size(); i++) {
            const DestructPattern& slot = slots[i];
            if (slot.is_rest) {
                if (declare) {
                    out_ << "    sd_array* " << safe_name(slot.name)
                         << " = sd_array_slice(" << src << ", " << n << ", "
                         << src << "->length);\n";
                    declare_owned(safe_name(slot.name), arr_desc);
                } else {
                    out_ << "    { sd_array* _v = sd_array_slice(" << src << ", " << n << ", "
                         << src << "->length); ";
                    emit_release_value(safe_name(slot.name), arr_desc);
                    out_ << safe_name(slot.name) << " = _v; }\n";
                }
                continue;
            }
            std::string T = c_type_for_desc(elem);
            std::string member_src = "((" + T + "*)(" + src + ")->data)[" + std::to_string(fix_i) + "]";
            if (slot.nested) {
                emit_destruct_level(slot.items, member_src, elem, declare);
            } else {
                emit_binding(slot, member_src, elem, declare);
            }
            fix_i++;
        }
        return;
    }
    // Text source: src is an sd_str*.
    size_t n = 0;
    for (auto& p : slots) if (!p.is_rest) n++;
    std::string len_expr = "(int)" + src + "->len";
    out_ << "    if (" << len_expr << " < " << n << ") { fprintf(stderr, \"Error: cannot destructure text of length %d into " << n << " targets\\n\", " << len_expr << "); exit(1); }\n";
    size_t fix_i = 0;
    TypeDesc char_desc{TypeKind::Char, {}, {}, {}};
    TypeDesc text_desc{TypeKind::Text, {}, {}, {}};
    for (size_t i = 0; i < slots.size(); i++) {
        const DestructPattern& slot = slots[i];
        if (slot.is_rest) {
            if (declare) {
                out_ << "    sd_str* " << safe_name(slot.name)
                     << " = sd_str_view(" << src << ", " << n << ", "
                     << len_expr << " - " << n << ");\n";
                declare_owned(safe_name(slot.name), text_desc);
            } else {
                out_ << "    { sd_str* _v = sd_str_view(" << src << ", " << n << ", "
                     << len_expr << " - " << n << "); ";
                emit_release_value(safe_name(slot.name), text_desc);
                out_ << safe_name(slot.name) << " = _v; }\n";
            }
            continue;
        }
        std::string member_src = src + "->data[" + std::to_string(fix_i) + "]";
        emit_binding(slot, member_src, char_desc, declare);
        fix_i++;
    }
}

// Defined below (with the other M15 helpers); forward-declared for emit_stmt.
static TypeDesc var_desc_of(const VarDecl* var);

void CodeGen::emit_stmt(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        emit_line_directive(var->line, line_file_);
        TypeDesc d = var_desc_of(var);
        out_ << "    " << (var->is_mutable ? "" : "const ") << c_type_for_desc(d)
             << " " << safe_name(var->name) << " = ";
        if (type_has_heap(d)) emit_owned_expr(var->initializer.get());
        else emit_expr(var->initializer.get());
        out_ << ";\n";
        declare_owned(safe_name(var->name), d);
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        emit_line_directive(assign->line, line_file_);
        out_ << "    " << safe_name(assign->name);
        if (assign->op == "++" || assign->op == "--") {
            out_ << assign->op << ";\n";
        } else {
            out_ << " " << assign->op << " ";
            const TypeDesc* vd = find_var_desc(assign->name);
            if (assign->op == "=" && vd && type_has_heap(*vd)) {
                // b = a (arrays/text/closure alias-share): own the new value,
                // drop the old reference, then store.
                std::string cn = safe_name(assign->name);
                out_ << "({ " << c_type_for_desc(*vd) << " _v = ";
                emit_owned_expr(assign->rhs.get());
                out_ << "; ";
                emit_release_value(cn, *vd);
                out_ << cn << " = _v; });\n";
            } else if (assign->op == "=" && type_has_heap(param_desc_of(assign->name))) {
                // Reassignment of a (borrowed) parameter: retain the new value
                // but do NOT drop the old — the caller's argument temp still
                // owns it. From here the param holds an owned reference.
                TypeDesc pd = param_desc_of(assign->name);
                std::string cn = safe_name(assign->name);
                out_ << "({ " << c_type_for_desc(pd) << " _v = ";
                emit_owned_expr(assign->rhs.get());
                out_ << "; " << cn << " = _v; });\n";
                declare_param_owned(assign->name);
            } else {
                emit_expr(assign->rhs.get());
                out_ << ";\n";
            }
        }
    } else if (auto* aa = dynamic_cast<ArrayAssignStmt*>(stmt)) {
        emit_line_directive(aa->line, line_file_);
        // COW-detect: evaluate the owned RHS first (may alias the stored slot),
        // check the index, detach (fork if the buffer is a shared view), drop
        // the old element ref (heap elems), then store. The element type is the
        // RHS type (resolver-verified identical to the element desc), which
        // works for both locals and params.
        TypeDesc ed = desc_of_expr(aa->rhs.get());
        std::string cn = safe_name(aa->name);
        std::string ct = c_type_for_desc(ed);
        bool heap_elem = type_has_heap(ed);
        out_ << "    { ";
        out_ << "int _si = sd_check_index(" << cn << "->length, ";
        emit_expr(aa->index.get());
        out_ << "); ";
        if (heap_elem) {
            out_ << ct << " _sv = ";
            emit_owned_expr(aa->rhs.get());
            out_ << "; ";
        } else {
            out_ << ct << " _sv = (";
            emit_expr(aa->rhs.get());
            out_ << "); ";
        }
        out_ << "sd_detach(" << cn << "); ";
        if (heap_elem) {
            out_ << slot_rel_name(ed) << "(&((" << ct << "*)" << cn << "->data)[_si]); ";
        }
        out_ << "((" << ct << "*)" << cn << "->data)[_si] = _sv; }\n";
    } else if (auto* ea = dynamic_cast<ElementAssignStmt*>(stmt)) {
        emit_line_directive(ea->line, line_file_);
        auto* target = dynamic_cast<ArrayIndexExpr*>(ea->target.get());
        if (target && !target->is_tuple) {
            // a[i] = v on an array lvalue chain: own the RHS, COW-detach the
            // innermost array, release the old element, then store.
            TypeDesc ed = target->elem;
            std::string ct = c_type_for_desc(ed);
            bool heap_elem = type_has_heap(ed);
            out_ << "    ({ sd_array* _db = ";
            emit_owned_expr(target->base.get());
            out_ << "; int _bi = sd_check_index(_db->length, ";
            emit_expr(target->index.get());
            out_ << "); ";
            if (heap_elem) {
                out_ << ct << " _ev = ";
                emit_owned_expr(ea->rhs.get());
                out_ << "; ";
            } else {
                out_ << ct << " _ev = (";
                emit_expr(ea->rhs.get());
                out_ << "); ";
            }
            out_ << "sd_detach(_db); ";
            if (heap_elem) {
                out_ << slot_rel_name(ed) << "(&((" << ct << "*)_db->data)[_bi]); ";
            }
            out_ << "((" << ct << "*)_db->data)[_bi] = _ev; sd_release_array(_db); });\n";
        } else {
            // t.fN = v (tuple member store, possibly chained): own the RHS,
            // release the old member, then store into the member lvalue.
            TypeDesc m = target ? target->elem : TypeDesc{};
            out_ << "    ({ " << c_type_for_desc(m) << " _ev = ";
            emit_owned_expr(ea->rhs.get());
            out_ << "; ";
            if (type_has_heap(m)) {
                out_ << slot_rel_name(m) << "(&(";
                emit_expr(ea->target.get());
                out_ << ")); ";
            }
            out_ << "(";
            emit_expr(ea->target.get());
            out_ << ") = _ev; });\n";
        }
    } else if (auto* td = dynamic_cast<DestructDecl*>(stmt)) {
        emit_line_directive(td->line, line_file_);
        std::string tmp = "__sd_d" + std::to_string(temp_counter_++);
        TypeDesc val;
        std::string ct;
        if (td->destruct_type == TypeKind::Tuple) {
            val.type = TypeKind::Tuple;
            val.tuple_members = td->tuple_members;
            ct = tuple_name(td->tuple_members);
        } else if (td->destruct_type == TypeKind::Array) {
            val.type = TypeKind::Array;
            val.elem = std::make_shared<TypeDesc>(td->destruct_elem);
            ct = "sd_array*";
        } else {
            val.type = TypeKind::Text;
            ct = "sd_str*";
        }
        out_ << "    " << ct << " " << tmp << " = ";
        emit_owned_expr(td->rhs.get());   // owned temp
        out_ << ";\n";
        emit_destruct_level(td->patterns, tmp, val, /*declare=*/true);
        if (type_has_heap(val)) {
            out_ << "    ";
            emit_release_value(tmp, val);
            out_ << "\n";
        }
    } else if (auto* ma = dynamic_cast<MultiAssignStmt*>(stmt)) {
        emit_line_directive(ma->line, line_file_);
        std::string tmp = "__sd_m" + std::to_string(temp_counter_++);
        TypeDesc val;
        std::string ct;
        if (ma->destruct_type == TypeKind::Tuple) {
            val.type = TypeKind::Tuple;
            val.tuple_members = ma->tuple_members;
            ct = tuple_name(ma->tuple_members);
        } else if (ma->destruct_type == TypeKind::Array) {
            val.type = TypeKind::Array;
            val.elem = std::make_shared<TypeDesc>(ma->destruct_elem);
            ct = "sd_array*";
        } else {
            val.type = TypeKind::Text;
            ct = "sd_str*";
        }
        out_ << "    " << ct << " " << tmp << " = ";
        emit_owned_expr(ma->rhs.get());
        out_ << ";\n";
        emit_destruct_level(ma->patterns, tmp, val, /*declare=*/false);
        if (type_has_heap(val)) {
            out_ << "    ";
            emit_release_value(tmp, val);
            out_ << "\n";
        }
    } else if (auto* print = dynamic_cast<PrintStmt*>(stmt)) {
        emit_line_directive(print->line, line_file_);
        out_ << "    ({ ";
        std::vector<std::string> pt(print->args.size());
        bool any_text = false;
        for (size_t i = 0; i < print->args.size(); i++) {
            if (get_expr_type(print->args[i].get()) == TypeKind::Text) {
                pt[i] = "_sd_ps" + std::to_string(i);
                any_text = true;
            }
        }
        if (any_text) {
            for (size_t i = 0; i < print->args.size(); i++) {
                if (get_expr_type(print->args[i].get()) == TypeKind::Text) {
                    out_ << "sd_str* " << pt[i] << " = ";
                    emit_owned_expr(print->args[i].get());
                    out_ << "; ";
                }
            }
        }
        out_ << "printf(\"";
        for (size_t i = 0; i < print->args.size(); i++) {
            if (i > 0) out_ << " ";
            TypeKind at = get_expr_type(print->args[i].get());
            // Text values may be non-NUL-terminated views: print with a bound.
            out_ << (at == TypeKind::Text ? "%.*s" : type_to_format(at));
        }
        out_ << "\\n\", ";
        for (size_t i = 0; i < print->args.size(); i++) {
            if (i > 0) out_ << ", ";
            TypeKind at = get_expr_type(print->args[i].get());
            if (at == TypeKind::Text) out_ << "(int)(" << pt[i] << "->len), " << pt[i] << "->data";
            else emit_expr(print->args[i].get(), false);
        }
        out_ << "); ";
        if (any_text) {
            for (size_t i = 0; i < print->args.size(); i++) {
                if (get_expr_type(print->args[i].get()) == TypeKind::Text) {
                    out_ << "sd_release_str(" << pt[i] << "); ";
                }
            }
        }
        out_ << "});\n";
    } else if (auto* expr_stmt = dynamic_cast<ExprStmt*>(stmt)) {
        emit_line_directive(expr_stmt->line, line_file_);
        // push/sort are statement-only builtins (the resolver types them as
        // returning nothing), but each retains its array argument into an
        // internal temp. Wrap them so the discarded result is released.
        auto* ecall = dynamic_cast<CallExpr*>(expr_stmt->expr.get());
        bool stmt_heap_builtin = ecall &&
                                 (ecall->name == "push" || ecall->name == "sort");
        TypeDesc d = desc_of_expr(expr_stmt->expr.get());
        if (stmt_heap_builtin) {
            out_ << "    ({ sd_array* _sd_e = ";
            emit_owned_expr(expr_stmt->expr.get());
            out_ << "; sd_release_array(_sd_e); });\n";
        } else if (type_has_heap(d)) {
            out_ << "    ({ " << c_type_for_desc(d) << " _sd_e = ";
            emit_owned_expr(expr_stmt->expr.get());
            out_ << "; ";
            emit_release_value("_sd_e", d);
            out_ << "});\n";
        } else {
            out_ << "    ";
            emit_expr(expr_stmt->expr.get());
            out_ << ";\n";
        }
    } else if (auto* loop = dynamic_cast<LoopStmt*>(stmt)) {
        emit_line_directive(loop->line, line_file_);
        if (loop->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << loop->nl_id << ";\n";
        }
        out_ << "    for (int _i = 0; _i < ";
        emit_expr(loop->count.get());
        out_ << "; _i++) {\n";
        if (loop->nl_target) {
            out_ << "    volatile int _sd_nls" << loop->nl_id << " = setjmp(_sd_nl_buf" << loop->nl_id << ");\n";
            out_ << "    if (_sd_nls" << loop->nl_id << " == 1) break;\n";
            out_ << "    if (_sd_nls" << loop->nl_id << " == 0) {\n";
        }
        push_scope();
        loop_scopes_.push_back((int)scopes_.size() - 1);
        break_targets_.push_back((int)scopes_.size() - 1);
        for (auto& body_stmt : loop->body) emit_stmt(body_stmt.get());
        pop_scope();
        loop_scopes_.pop_back();
        break_targets_.pop_back();
        if (loop->nl_target) {
            out_ << "    }\n";
        }
        out_ << "    }\n";
    } else if (auto* fe = dynamic_cast<ForeachStmt*>(stmt)) {
        emit_line_directive(fe->line, line_file_);
        TypeKind itype = get_expr_type(fe->iterable.get());
        std::string idx = fe->index_name.empty() ? "_fe" : safe_name(fe->index_name);
        if (fe->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << fe->nl_id << ";\n";
        }
        auto nl_arm = [&]() {
            if (fe->nl_target) {
                out_ << "    volatile int _sd_nls" << fe->nl_id << " = setjmp(_sd_nl_buf" << fe->nl_id << ");\n";
                out_ << "    if (_sd_nls" << fe->nl_id << " == 1) break;\n";
                out_ << "    if (_sd_nls" << fe->nl_id << " == 0) {\n";
            }
        };
        auto nl_disarm = [&]() {
            if (fe->nl_target) {
                out_ << "    }\n";
            }
        };
        if (itype == TypeKind::Array) {
            // Single-eval the iterable into an owned temp.
            std::string it = "(__sd_fe_it_" + std::to_string(temp_counter_++) + ")";
            TypeDesc ed = fe->elem;
            std::string ct = c_type_for_desc(ed);
            out_ << "    sd_array* " << it << " = ";
            emit_owned_expr(fe->iterable.get());
            out_ << ";\n";
            out_ << "    for (int " << idx << " = 0; " << idx << " < " << it << "->length; " << idx << "++) {\n";
            nl_arm();
            out_ << "        " << ct << " " << safe_name(fe->value_name)
                 << " = ((" << ct << "*)";
            out_ << it << "->data)[" << idx << "];\n";
            push_scope();
            loop_scopes_.push_back((int)scopes_.size() - 1);
            break_targets_.push_back((int)scopes_.size() - 1);
            for (auto& body_stmt : fe->body) emit_stmt(body_stmt.get());
            pop_scope();
            loop_scopes_.pop_back();
            break_targets_.pop_back();
            nl_disarm();
            out_ << "    }\n";
            out_ << "    sd_release_array" << it << ";\n";
        } else {
            std::string it = "(__sd_fe_ts_" + std::to_string(temp_counter_++) + ")";
            out_ << "    sd_str* " << it << " = ";
            emit_owned_expr(fe->iterable.get());
            out_ << ";\n";
            out_ << "    for (int " << idx << " = 0; " << idx << " < (int)" << it << "->len; " << idx << "++) {\n";
            nl_arm();
            out_ << "        char " << safe_name(fe->value_name) << " = " << it << "->data[" << idx << "];\n";
            push_scope();
            loop_scopes_.push_back((int)scopes_.size() - 1);
            break_targets_.push_back((int)scopes_.size() - 1);
            for (auto& body_stmt : fe->body) emit_stmt(body_stmt.get());
            pop_scope();
            loop_scopes_.pop_back();
            break_targets_.pop_back();
            nl_disarm();
            out_ << "    }\n";
            out_ << "    sd_release_str" << it << ";\n";
        }
    } else if (auto* while_stmt = dynamic_cast<WhileStmt*>(stmt)) {
        emit_line_directive(while_stmt->line, line_file_);
        if (while_stmt->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << while_stmt->nl_id << ";\n";
        }
        out_ << "    while (";
        emit_expr(while_stmt->condition.get());
        out_ << ") {\n";
        if (while_stmt->nl_target) {
            out_ << "    volatile int _sd_nls" << while_stmt->nl_id << " = setjmp(_sd_nl_buf" << while_stmt->nl_id << ");\n";
            out_ << "    if (_sd_nls" << while_stmt->nl_id << " == 1) break;\n";
            out_ << "    if (_sd_nls" << while_stmt->nl_id << " == 0) {\n";
        }
        push_scope();
        loop_scopes_.push_back((int)scopes_.size() - 1);
        break_targets_.push_back((int)scopes_.size() - 1);
        for (auto& body_stmt : while_stmt->body) emit_stmt(body_stmt.get());
        pop_scope();
        loop_scopes_.pop_back();
        break_targets_.pop_back();
        if (while_stmt->nl_target) {
            out_ << "    }\n";
        }
        out_ << "    }\n";
    } else if (auto* for_stmt = dynamic_cast<ForStmt*>(stmt)) {
        emit_line_directive(for_stmt->line, line_file_);
        if (for_stmt->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << for_stmt->nl_id << ";\n";
        }
        push_scope();   // scope covering the init component (declared in the header)
        out_ << "    for (";
        emit_for_component(for_stmt->init.get());
        out_ << "; ";
        emit_expr(for_stmt->condition.get());
        out_ << "; ";
        emit_for_component(for_stmt->update.get());
        out_ << ") {\n";
        if (for_stmt->nl_target) {
            out_ << "    volatile int _sd_nls" << for_stmt->nl_id << " = setjmp(_sd_nl_buf" << for_stmt->nl_id << ");\n";
            out_ << "    if (_sd_nls" << for_stmt->nl_id << " == 1) break;\n";
            out_ << "    if (_sd_nls" << for_stmt->nl_id << " == 0) {\n";
        }
        push_scope();
        loop_scopes_.push_back((int)scopes_.size() - 1);
        break_targets_.push_back((int)scopes_.size() - 1);
        for (auto& body_stmt : for_stmt->body) emit_stmt(body_stmt.get());
        pop_scope();
        loop_scopes_.pop_back();
        break_targets_.pop_back();
        if (for_stmt->nl_target) {
            out_ << "    }\n";
        }
        out_ << "    }\n";
        pop_scope();   // releases any heap vars declared in the init component
    } else if (auto* do_while = dynamic_cast<DoWhileStmt*>(stmt)) {
        emit_line_directive(do_while->line, line_file_);
        if (do_while->nl_target) {
            out_ << "    jmp_buf _sd_nl_buf" << do_while->nl_id << ";\n";
        }
        out_ << "    do {\n";
        if (do_while->nl_target) {
            out_ << "    volatile int _sd_nls" << do_while->nl_id << " = setjmp(_sd_nl_buf" << do_while->nl_id << ");\n";
            out_ << "    if (_sd_nls" << do_while->nl_id << " == 1) break;\n";
            out_ << "    if (_sd_nls" << do_while->nl_id << " == 0) {\n";
        }
        push_scope();
        loop_scopes_.push_back((int)scopes_.size() - 1);
        break_targets_.push_back((int)scopes_.size() - 1);
        for (auto& body_stmt : do_while->body) emit_stmt(body_stmt.get());
        pop_scope();
        loop_scopes_.pop_back();
        break_targets_.pop_back();
        if (do_while->nl_target) {
            out_ << "    }\n";
        }
        out_ << "    } while (";
        emit_expr(do_while->condition.get());
        out_ << ");\n";
    } else if (auto* ret = dynamic_cast<ReturnStmt*>(stmt)) {
        emit_line_directive(ret->line, line_file_);
        if (ret->values.size() > 1) {
            // Tuple return: retain members (never transfer), then release the
            // enclosing scopes from a temp that outlives the cleanup.
            out_ << "    { " << tuple_name(ret->return_tuple_members) << " _rv = ("
                 << tuple_name(ret->return_tuple_members) << "){ ";
            for (size_t i = 0; i < ret->values.size(); i++) {
                if (i > 0) out_ << ", ";
                if (type_has_heap(ret->return_tuple_members[i])) emit_owned_expr(ret->values[i].get());
                else emit_expr(ret->values[i].get());
            }
            out_ << " }; ";
            emit_all_scope_releases(nullptr);
            out_ << "return _rv; }\n";
        } else if (ret->values.size() == 1) {
            TypeDesc rd = desc_of_expr(ret->values[0].get());
            Expression* v0 = ret->values[0].get();
            if (rd.type == TypeKind::Unknown) {
                emit_all_scope_releases(nullptr);
                out_ << "    return;\n";
            } else if (type_has_heap(rd)) {
                // Transfer ONLY for a bare owned-local identifier (params and
                // captures are borrowed; tuples always retain).
                bool transfer = false;
                std::string skip_cn;
                if (auto* id = dynamic_cast<Identifier*>(v0); id && !id->is_function_reference &&
                    rd.type != TypeKind::Tuple) {
                    std::string cn = safe_name(id->name);
                    if (is_owned_local(cn)) { transfer = true; skip_cn = cn; }
                }
                if (transfer) {
                    emit_all_scope_releases(&skip_cn);
                    out_ << "    return " << skip_cn << ";\n";
                } else {
                    out_ << "    { " << c_type_for_desc(rd) << " _rv = ";
                    emit_owned_expr(v0);
                    out_ << "; ";
                    emit_all_scope_releases(nullptr);
                    out_ << "return _rv; }\n";
                }
            } else {
                out_ << "    { " << c_type_for_desc(rd) << " _rv = ";
                emit_expr(v0);
                out_ << "; ";
                emit_all_scope_releases(nullptr);
                out_ << "return _rv; }\n";
            }
        } else {
            emit_all_scope_releases(nullptr);
            out_ << "    return;\n";
        }
    } else if (auto* ifs = dynamic_cast<IfStmt*>(stmt)) {
        emit_line_directive(ifs->line, line_file_);
        out_ << "    if (";
        emit_expr(ifs->condition.get());
        out_ << ") {\n";
        push_scope();
        for (auto& body_stmt : ifs->then_body) emit_stmt(body_stmt.get());
        pop_scope();
        out_ << "    }";
        if (ifs->has_else) {
            out_ << " else {\n";
            push_scope();
            for (auto& body_stmt : ifs->else_body) emit_stmt(body_stmt.get());
            pop_scope();
            out_ << "    }";
        }
        out_ << "\n";
    } else if (auto* sw = dynamic_cast<SwitchStmt*>(stmt)) {
        emit_line_directive(sw->line, line_file_);
        out_ << "    switch (";
        emit_expr(sw->value.get());
        out_ << ") {\n";
        for (auto& c : sw->cases) {
            out_ << "    ";
            if (c.is_default) {
                out_ << "default:\n";
            } else {
                out_ << "case ";
                emit_expr(c.value.get());
                out_ << ":\n";
            }
            // Per-case C scope so `break` (and scope-exit releases) reach only
            // this case's locals.
            out_ << "    {\n";
            push_scope();
            break_targets_.push_back((int)scopes_.size() - 1);
            for (auto& body_stmt : c.body) emit_stmt(body_stmt.get());
            emit_releases_at_current_scope();
            pop_scope();
            break_targets_.pop_back();
            out_ << "        break;\n";
            out_ << "    }\n";
        }
        out_ << "    }\n";
    } else if (auto* brk = dynamic_cast<BreakStmt*>(stmt)) {
        emit_line_directive(brk->line, line_file_);
        if (brk->nonlocal) {
            out_ << "    longjmp(*(jmp_buf*)_sd_nl, 1);\n";
        } else {
            if (!break_targets_.empty()) {
                for (size_t i = (size_t)break_targets_.back(); i < scopes_.size(); i++) {
                    for (auto& e : scopes_[i]) {
                        out_ << "    ";
                        emit_release_value(e.cname, e.desc);
                        out_ << "\n";
                    }
                }
            }
            out_ << "    break;\n";
        }
    } else if (auto* cont = dynamic_cast<ContinueStmt*>(stmt)) {
        emit_line_directive(cont->line, line_file_);
        if (cont->nonlocal) {
            out_ << "    longjmp(*(jmp_buf*)_sd_nl, 2);\n";
        } else {
            int t = innermost_loop_scope();
            if (t >= 0) {
                for (size_t i = (size_t)t; i < scopes_.size(); i++) {
                    for (auto& e : scopes_[i]) {
                        out_ << "    ";
                        emit_release_value(e.cname, e.desc);
                        out_ << "\n";
                    }
                }
            }
            out_ << "    continue;\n";
        }
    } else if (dynamic_cast<FunctionDecl*>(stmt)) {
        // Nested function declarations are hoisted to program scope during
        // generation; nothing is emitted at their definition site.
    }
}

void CodeGen::emit_for_component(Statement* stmt) {
    if (auto* var = dynamic_cast<VarDecl*>(stmt)) {
        if (var->annotation == TypeKind::Tuple) {
            out_ << tuple_name(var->tuple_members);
        } else if (var->annotation == TypeKind::Array) {
            out_ << "sd_array*";
        } else {
            out_ << type_to_c(var->annotation);
        }
        out_ << " " << safe_name(var->name) << " = ";
        TypeDesc d = var_desc_of(var);
        if (type_has_heap(d)) emit_owned_expr(var->initializer.get());
        else emit_expr(var->initializer.get());
        declare_owned(safe_name(var->name), d);
    } else if (auto* assign = dynamic_cast<AssignStmt*>(stmt)) {
        out_ << safe_name(assign->name);
        if (assign->op == "++" || assign->op == "--") {
            out_ << assign->op;
        } else {
            out_ << " " << assign->op << " ";
            const TypeDesc* vd = find_var_desc(assign->name);
            if (assign->op == "=" && vd && type_has_heap(*vd)) {
                // b = a (arrays/text alias-share): retain the RHS, drop the old.
                std::string cn = safe_name(assign->name);
                out_ << "({ " << c_type_for_desc(*vd) << " _v = ";
                emit_owned_expr(assign->rhs.get());
                out_ << "; ";
                emit_release_value(cn, *vd);
                out_ << cn << " = _v; })";
            } else {
                emit_expr(assign->rhs.get());
            }
        }
    }
}

// ── M15 reference-counting helpers ────────────────────────────────────────
bool CodeGen::type_has_heap(const TypeDesc& d) {
    if (d.type == TypeKind::Text || d.type == TypeKind::Array ||
        d.type == TypeKind::Function) return true;
    if (d.type == TypeKind::Tuple) {
        for (auto& m : d.tuple_members) if (type_has_heap(m)) return true;
    }
    return false;
}

bool CodeGen::expr_is_fresh(Expression* e) {
    if (auto* id = dynamic_cast<Identifier*>(e)) return id->is_function_reference;
    if (dynamic_cast<ArrayIndexExpr*>(e)) return false;
    // ConditionalExpr emits its own per-branch owned value (see emit_expr),
    // so it is always an owned producer.
    if (dynamic_cast<ConditionalExpr*>(e)) return true;
    return true;
}

// Build the full TypeDesc of a VarDecl from its annotation fields.
static TypeDesc var_desc_of(const VarDecl* var) {
    TypeDesc d;
    d.type = var->annotation;
    if (var->annotation == TypeKind::Array) {
        d.elem = std::make_shared<TypeDesc>(var->elem_desc);
    } else if (var->annotation == TypeKind::Tuple) {
        d.tuple_members = var->tuple_members;
    } else if (var->annotation == TypeKind::Function) {
        d.fn_info = var->annotation_desc.fn_info;
    }
    return d;
}

void CodeGen::push_scope() { scopes_.push_back({}); }

void CodeGen::pop_scope() {
    if (scopes_.empty()) return;
    for (auto& e : scopes_.back()) {
        out_ << "    ";
        emit_release_value(e.cname, e.desc);
        out_ << "\n";
    }
    scopes_.pop_back();
}

void CodeGen::declare_owned(const std::string& cname, const TypeDesc& t) {
    if (!type_has_heap(t)) return;
    if (scopes_.empty()) push_scope();
    scopes_.back().push_back({cname, t});
}

// Full descriptor of a parameter, or an Unknown desc when not a parameter.
TypeDesc CodeGen::param_desc_of(const std::string& user_name) const {
    if (!current_fn_) return TypeDesc{};
    for (auto& p : current_fn_->params) {
        if (p.name == user_name) return codegen_param_desc(p);
    }
    return TypeDesc{};
}

// Reassigning a (borrowed) heap parameter: the new value is retained and the
// param becomes OWNED for the rest of the function body, so it must be
// released on scope exit. The old borrowed value is left alone — it is owned
// by the caller's argument temp, which the caller releases after the call.
void CodeGen::declare_param_owned(const std::string& user_name) {
    if (!current_fn_) return;
    for (auto& p : current_fn_->params) {
        if (p.name != user_name) continue;
        TypeDesc d = codegen_param_desc(p);
        if (!type_has_heap(d)) return;
        if (scopes_.empty()) push_scope();
        std::string cn = safe_name(user_name);
        for (auto& e : scopes_[0]) if (e.cname == cn) return;
        scopes_[0].push_back({cn, d});
        return;
    }
}

bool CodeGen::is_owned_local(const std::string& cname) const {
    for (auto it = scopes_.rbegin(); it != scopes_.rend(); ++it) {
        for (auto& e : *it) if (e.cname == cname) return true;
    }
    return false;
}

int CodeGen::innermost_loop_scope() const {
    return loop_scopes_.empty() ? -1 : loop_scopes_.back();
}

void CodeGen::emit_all_scope_releases(const std::string* skip) {
    for (auto it = scopes_.rbegin(); it != scopes_.rend(); ++it) {
        for (auto& e : *it) {
            if (skip && e.cname == *skip) continue;
            out_ << "    ";
            emit_release_value(e.cname, e.desc);
            out_ << "\n";
        }
    }
}

void CodeGen::emit_loop_escape_releases() {
    int target = innermost_loop_scope();
    if (target < 0) return;
    for (size_t i = (size_t)target; i < scopes_.size(); i++) {
        for (auto& e : scopes_[i]) {
            out_ << "    ";
            emit_release_value(e.cname, e.desc);
            out_ << "\n";
        }
    }
}

void CodeGen::emit_releases_at_current_scope() {
    if (scopes_.empty()) return;
    for (auto& e : scopes_.back()) {
        out_ << "    ";
        emit_release_value(e.cname, e.desc);
        out_ << "\n";
    }
}

std::string CodeGen::slot_ret_name(const TypeDesc& d) const {
    switch (d.type) {
        case TypeKind::Text: return "sd_ret_text";
        case TypeKind::Array: return "sd_ret_arr";
        case TypeKind::Function: return "sd_ret_fn";
        case TypeKind::Tuple: return "sd_ret_" + tuple_name(d.tuple_members);
        default:
            throw std::runtime_error("internal error: slot_ret_name for non-heap type");
    }
}

std::string CodeGen::slot_rel_name(const TypeDesc& d) const {
    switch (d.type) {
        case TypeKind::Text: return "sd_rel_text";
        case TypeKind::Array: return "sd_rel_arr";
        case TypeKind::Function: return "sd_rel_fn";
        case TypeKind::Tuple: return "sd_rel_" + tuple_name(d.tuple_members);
        default:
            throw std::runtime_error("internal error: slot_rel_name for non-heap type");
    }
}

// Emit `sd_rel_<t>(&<src>); ` (a full C statement text, semicolon included).
void CodeGen::emit_release_value(const std::string& src, const TypeDesc& t) {
    switch (t.type) {
        case TypeKind::Text:
        case TypeKind::Array:
        case TypeKind::Function:
            out_ << slot_rel_name(t) << "(&" << src << "); ";
            break;
        case TypeKind::Tuple:
            if (type_has_heap(t)) out_ << slot_rel_name(t) << "(&" << src << "); ";
            break;
        default:
            break;  // scalars have no release
    }
}

const TypeDesc* CodeGen::find_var_desc(const std::string& user_name) const {
    std::string cn = safe_name(user_name);
    for (auto it = scopes_.rbegin(); it != scopes_.rend(); ++it) {
        for (auto& e : *it) {
            if (e.cname == cn) return &e.desc;
        }
    }
    return nullptr;
}

TypeDesc CodeGen::desc_of_expr(const Expression* expr) const {
    TypeDesc d;
    d.type = expr->resolved_type;
    if (d.type != TypeKind::Tuple) return d;
    if (auto* id = dynamic_cast<const Identifier*>(expr)) {
        if (current_fn_ && is_capture(current_fn_, id->name)) {
            for (auto& c : current_fn_->captures) {
                if (c.name == id->name) return c.desc;
            }
        }
        if (const TypeDesc* vd = find_var_desc(id->name)) return *vd;
        // A tuple parameter is borrowed but still has a full descriptor.
        if (current_fn_) {
            for (auto& p : current_fn_->params) {
                if (p.name == id->name) return codegen_param_desc(p);
            }
        }
        throw std::runtime_error("internal error: cannot resolve tuple variable '" +
                                 id->name + "' for ownership tracking");
    }
    if (auto* tup = dynamic_cast<const TupleLiteral*>(expr)) {
        d.tuple_members = tup->resolved_members;
        return d;
    }
    if (auto* idx = dynamic_cast<const ArrayIndexExpr*>(expr)) {
        return idx->elem;   // member / element descriptor (may itself be a tuple)
    }
    if (auto* cond = dynamic_cast<const ConditionalExpr*>(expr)) {
        return desc_of_expr(cond->then_expr.get());
    }
    if (auto* call = dynamic_cast<const CallExpr*>(expr)) {
        if (call->is_function_value_call && call->fn_type.fn_info)
            return call->fn_type.fn_info->ret;
        auto it = functions_by_name_.find(call->name);
        if (it != functions_by_name_.end()) return it->second->return_desc;
    }
    throw std::runtime_error("internal error: unknown tuple descriptor");
}

void CodeGen::emit_owned_expr(Expression* expr) {
    TypeDesc d = desc_of_expr(expr);
    if (!type_has_heap(d)) { emit_expr(expr); return; }
    if (expr_is_fresh(expr)) { emit_expr(expr); return; }
    // A read/borrow: copy into an owned temp and retain it (slot helpers are
    // value-agnostic — they operate on the slot in place).
    out_ << "({ " << c_type_for_desc(d) << " _v = (";
    emit_expr(expr);
    out_ << "); " << slot_ret_name(d) << "(&_v); _v; })";
}

void CodeGen::emit_wrapped_call(
    const std::vector<Expression*>& args,
    const std::vector<TypeDesc>& param_descs,
    const TypeDesc& ret_desc,
    const std::function<void(const std::vector<std::string>&)>& emit_call,
    const std::function<void()>& emit_temps,
    const std::function<void()>& emit_releases) {
    bool has_ret = ret_desc.type != TypeKind::Unknown;
    std::vector<std::string> tnames(args.size());
    std::vector<std::pair<std::string, TypeDesc>> temps;
    out_ << "({ ";
    if (has_ret) out_ << c_type_for_desc(ret_desc) << " _sd_r; ";
    for (size_t i = 0; i < args.size() && i < param_descs.size(); i++) {
        if (!type_has_heap(param_descs[i])) continue;
        std::string tn = "_sd_ca" + std::to_string(i);
        tnames[i] = tn;
        temps.emplace_back(tn, param_descs[i]);
        out_ << c_type_for_desc(param_descs[i]) << " " << tn << " = ";
        emit_owned_expr(args[i]);
        out_ << "; ";
    }
    if (emit_temps) emit_temps();
    if (has_ret) out_ << "_sd_r = ";
    emit_call(tnames);
    out_ << "; ";
    for (auto& t : temps) emit_release_value(t.first, t.second);
    if (emit_releases) emit_releases();
    if (has_ret) out_ << "_sd_r; ";
    out_ << "})";
}

void CodeGen::generate_tuple_helpers() {
    for (auto& [members, name] : tuple_types_) {
        bool has_heap = false;
        for (auto& m : members) if (type_has_heap(m)) { has_heap = true; break; }
        if (!has_heap) continue;
        out_ << "static void sd_rel_" << name << "(void* p) {\n";
        out_ << "    " << name << "* _e = (" << name << "*)p;\n";
        for (size_t i = 0; i < members.size(); i++) {
            if (!type_has_heap(members[i])) continue;
            out_ << "    ";
            emit_release_value("_e->f" + std::to_string(i), members[i]);
            out_ << "\n";
        }
        out_ << "}\n\n";
        out_ << "static void sd_ret_" << name << "(void* p) {\n";
        out_ << "    " << name << "* _e = (" << name << "*)p;\n";
        for (size_t i = 0; i < members.size(); i++) {
            if (!type_has_heap(members[i])) continue;
            out_ << "    " << slot_ret_name(members[i]) << "(&_e->f" << std::to_string(i) << ");\n";
        }
        out_ << "}\n\n";
    }
}

void CodeGen::generate_env_rel_fn(const FunctionDecl* fn) {
    out_ << "static void sd_rel_env_" << safe_name(fn->name) << "(void* p) {\n";
    out_ << "    sd_env_" << safe_name(fn->name) << "* _e = (sd_env_" << safe_name(fn->name)
         << "*)p;\n";
    for (auto& c : fn->captures) {
        if (!type_has_heap(c.desc)) continue;
        out_ << "    ";
        emit_release_value("_e->" + safe_name(c.name), c.desc);
        out_ << "\n";
    }
    out_ << "}\n\n";
}
