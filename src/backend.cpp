// P3 (ADR 0004): x86-64 System V backend v1 — see backend.hpp for scope.
//
// Value model. Every expression evaluates into one of three homes (rax =
// int/bool/char as a sign-extended 64-bit word, xmm0 = decimal, rax again =
// text as an owned sd_str*). Invariant: a text expression leaves an OWNED
// pointer (+1) in rax, mirroring the C emitter's `sd_ret_text` schedule —
// var reads retain through sd_retain_str, literals/concat results are fresh.
// Consumers (stores, print, the expression-statement release) drop that
// reference exactly like their C counterparts.
//
// Stack discipline. Locals and parameters live in rbp-relative slots. All
// scratch traffic uses push/pop tracked by a pending counter; emit_call
// realigns to 16 bytes around any call whenever that counter is odd, so
// nested calls inside mid-expression pushes keep the SysV alignment
// invariant without a real register allocator.

#include "backend.hpp"

#include "ast.hpp"
#include "ir.hpp"
#include "type_resolver.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace {

// SysV integer-argument registers (calls: user functions take args here;
// print: printf's own fmt pointer occupies rdi, its args start at rsi).
const char* const CALL_REGS[] = {"rdi", "rsi", "rdx", "rcx", "r8", "r9"};
const char* const PRINT_REGS[] = {"rsi", "rdx", "rcx", "r8", "r9"};
constexpr int MAX_CALL_WORD_ARGS = 6;
constexpr int MAX_PRINT_WORD_SLOTS = 5;   // after printf's fmt in rdi

enum class Vm { Word, Dec, Txt };

bool is_word(TypeKind k) {
    return k == TypeKind::Int || k == TypeKind::Bool || k == TypeKind::Char;
}

bool is_v1_value(TypeKind k) {
    return is_word(k) || k == TypeKind::Decimal || k == TypeKind::Text ||
           k == TypeKind::Unknown;
}

struct LoopTargets {
    std::string brk;
    std::string cont;
};

// One emission context = one assembly function frame.
struct Ctx {
    std::string label;                     // "main" or "_hmx_<fn>"
    std::map<std::string, int> locals;     // name -> rbp offset of its slot
    std::vector<int> text_release;         // slots holding owned sd_str*; freed at epilogue
    int slots = 0;                         // allocated 8-byte slots
    int frame = 0;                         // final rsp sub, 16-aligned
    int pending = 0;                       // outstanding 8-byte pushes (parity = alignment)
    int labels = 0;
    std::vector<LoopTargets> loops;
    int text_home[3] = {0, 0, 0};          // parked text pointers around a print/concat
    int dec_scratch = 0;                   // one per frame, for decimal binops
    int ret_slot = 0;                      // parked return value (all contexts)
    TypeKind ret_kind = TypeKind::Unknown; // which register reloads it at exit
    bool is_main_body = false;
};

class X64Backend {
public:
    X64Backend(Program& program, const std::string& source)
        : program_(program), source_file_(source) {}

    ~X64Backend() {
        for (auto& [fn, c] : fn_ctx_) delete c;
    }

    std::string run() {
        TypeResolver resolver;
        resolver.resolve(program_);

        auto program_ir = ir::build(program_.statements);

        // User functions; lambdas/generic templates/nested fns reject at their
        // declaration with the source line.
        for (auto& top : program_ir) {
            if (top->kind != ir::SKind::FuncDecl) continue;
            auto* fn = static_cast<FunctionDecl*>(top->ast);
            if (!fn->type_params.empty())
                err(fn->line, "asm backend v1: generics are not supported (build with the default C backend)");
            if (fn->is_lambda || !fn->captures.empty())
                err(fn->line, "asm backend v1: closures/lambdas are not supported (build with the default C backend)");
            fns_.push_back(fn);
            fns_by_name_[fn->name] = fn;
            if (fn->name == "main") main_fn_ = fn;
        }
        // main may also be declared inside a merged module: signature check
        if (main_fn_) {
            if (!main_fn_->params.empty())
                err(main_fn_->line, "asm backend v1: main cannot take parameters");
            if (main_fn_->has_return_type && !is_word(main_fn_->return_type))
                err(main_fn_->line, "asm backend v1: main must return int or nothing");
        }

        // ── layout pass: every context pre-allocates its slots so frames are
        //    known before the first emitted instruction of the body.
        ctx_main_.label = "main";
        ctx_main_.is_main_body = true;
        scan_list(ctx_main_, program_ir, /*skip_fns=*/true);
        if (main_fn_) scan_fn_body_into_main();
        finish_frame(ctx_main_);
        for (auto* fn : fns_) {
            if (fn == main_fn_) continue;
            check_fn_signature(fn);
            auto* c = new Ctx{};
            c->label = "_hmx_" + fn->name;
            c->ret_kind = fn->has_return_type ? fn->return_type : TypeKind::Unknown;
            for (auto& p : fn->params) declare_slot(*c, p.name, 0);
            auto body_ir = ir::build(fn->body);
            scan_list(*c, body_ir, false);
            finish_frame(*c);
            fn_ctx_[fn] = c;
        }

        // ── dump ──
        out_ << "\t.text\n";
        out_ << "\t.globl main\n\t.type main, @function\n";
        out_ << "main:\n";
        emit_frame_head(ctx_main_);
        for (auto& top : program_ir) {
            if (top->kind != ir::SKind::FuncDecl) emit_node(ctx_main_, *top);
        }
        if (main_fn_) {
            auto body_ir = ir::build(main_fn_->body);
            for (auto& n : body_ir) emit_node(ctx_main_, *n);
        }
        emit_frame_tail(ctx_main_);

        for (auto* fn : fns_) {
            if (fn == main_fn_) continue;
            emit_function(fn);
        }

        // The rodata pool is filled during emission; GNU as lets the section
        // appear after .text, so the dump runs last.
        dump_rodata();
        return out_.str();
    }

private:
    Program& program_;
    std::string source_file_;
    std::ostringstream out_;

    std::vector<FunctionDecl*> fns_;
    std::map<std::string, FunctionDecl*> fns_by_name_;
    FunctionDecl* main_fn_ = nullptr;

    Ctx ctx_main_;
    std::map<FunctionDecl*, Ctx*> fn_ctx_;
    std::map<const void*, std::pair<int, int>> loop_slots_;  // LoopStmt* -> (count, i)
    std::map<const void*, int> call_text_slots_;             // CallExpr* -> first park-slot offset
                                                             // (one slot per text argument, forward)

    Ctx* ctx_ = nullptr;   // current context during emit/scan helpers
    int global_labels_ = 0;
    std::map<const void*, int> decl_slots_;   // VarDecl* -> frame offset

    std::vector<std::string> str_pool_;
    std::vector<std::string> dbl_pool_;
    std::map<std::string, std::string> str_label_;
    std::map<std::string, std::string> dbl_label_;

    // ── diagnostics ─────────────────────────────────────────────────────────
    [[noreturn]] void err(int line, const std::string& msg) const {
        throw CompileError(line, msg);
    }

    // ── frame layout ─────────────────────────────────────────────────────────
    void declare_slot(Ctx& c, const std::string& name, int line) {
        if (c.locals.count(name))
            err(line, "asm backend v1: duplicate declaration '" + name + "' in one function (shadowing is not supported)");
        c.slots++;
        c.locals[name] = -8 * c.slots;
    }

    bool decl_is_text(const VarDecl* v) {
        if (v->annotation == TypeKind::Text) return true;
        return v->annotation == TypeKind::Unknown && v->initializer &&
               v->initializer->resolved_type == TypeKind::Text;
    }

    // scan_list: pre-allocate slots for every local of a statement list.
    // Unknown kinds are ignored here (the emit pass reports them with a line
    // number); this keeps the scan pass throw-free except for slot rules.
    void scan_list(Ctx& c, const std::vector<std::unique_ptr<ir::Node>>& list, bool skip_fns) {
        for (auto& n : list) scan_node(c, *n, skip_fns);
    }

    void scan_node(Ctx& c, const ir::Node& n, bool skip_fns) {
        ctx_ = &c;
        switch (n.kind) {
            case ir::SKind::FuncDecl:
                if (!skip_fns)
                    err(n.ast->line, "asm backend v1: nested functions are not supported");
                return;
            case ir::SKind::VarDecl: {
                auto* v = static_cast<VarDecl*>(n.ast);
                TypeKind vt = v->annotation == TypeKind::Unknown
                                  ? (v->initializer ? v->initializer->resolved_type : TypeKind::Int)
                                  : v->annotation;
                if (!is_v1_value(vt) || !v->tuple_members.empty())
                    err(v->line, "asm backend v1: unsupported variable type for '" + v->name + "'");
                if (v->initializer) scan_expr(c, v->initializer.get());
                // every declaration gets its own frame slot; the name is bound
                // by scope (restore logic lives in scan_scope)
                if (c.locals.count(v->name))
                    err(v->line, "asm backend v1: duplicate declaration '" + v->name + "' in one scope");
                c.slots++;
                decl_slots_[v] = -8 * c.slots;
                c.locals[v->name] = -8 * c.slots;
                if (decl_is_text(v)) c.text_release.push_back(c.locals[v->name]);
                return;
            }
            case ir::SKind::Assign: {
                auto* s = static_cast<AssignStmt*>(n.ast);
                if (s->rhs) scan_expr(c, s->rhs.get());
                return;
            }
            case ir::SKind::ExprStmt: {
                auto* s = static_cast<ExprStmt*>(n.ast);
                scan_expr(c, s->expr.get());
                return;
            }
            case ir::SKind::Print: {
                auto* s = static_cast<PrintStmt*>(n.ast);
                for (auto& e : s->args) scan_expr(c, e.get());
                return;
            }
            case ir::SKind::Return: {
                auto* s = static_cast<ReturnStmt*>(n.ast);
                for (auto& v : s->values) scan_expr(c, v.get());
                return;
            }
            case ir::SKind::If: {
                auto* s = static_cast<IfStmt*>(n.ast);
                scan_expr(c, s->condition.get());
                scan_scope(c, [&] {
                    for (auto& b : n.body) scan_node(c, *b, skip_fns);
                });
                if (s->has_else) scan_scope(c, [&] {
                    for (auto& b : n.else_body) scan_node(c, *b, skip_fns);
                });
                return;
            }
            case ir::SKind::While: {
                auto* s = static_cast<WhileStmt*>(n.ast);
                scan_expr(c, s->condition.get());
                scan_scope(c, [&] {
                    for (auto& b : n.body) scan_node(c, *b, skip_fns);
                });
                return;
            }
            case ir::SKind::DoWhile: {
                auto* s = static_cast<DoWhileStmt*>(n.ast);
                scan_scope(c, [&] {
                    for (auto& b : n.body) scan_node(c, *b, skip_fns);
                });
                scan_expr(c, s->condition.get());
                return;
            }
            case ir::SKind::For: {
                auto* s = static_cast<ForStmt*>(n.ast);
                // the header declaration is scoped to header + body
                std::string hdr; bool had = false; int prev = 0;
                if (n.init && n.init->kind == ir::SKind::VarDecl) {
                    hdr = static_cast<VarDecl*>(n.init->ast)->name;
                    auto it = c.locals.find(hdr);
                    if (it != c.locals.end()) { had = true; prev = it->second; }
                }
                if (n.init) scan_node(c, *n.init, skip_fns);
                if (s->condition) scan_expr(c, s->condition.get());
                scan_scope(c, [&] {
                    for (auto& b : n.body) scan_node(c, *b, skip_fns);
                });
                if (n.update) scan_node(c, *n.update, skip_fns);
                if (had) c.locals[hdr] = prev;
                else if (!hdr.empty()) c.locals.erase(hdr);
                return;
            }
            case ir::SKind::Loop: {
                auto* l = static_cast<LoopStmt*>(n.ast);
                scan_expr(c, l->count.get());
                c.slots++; int cnt = -8 * c.slots;
                c.slots++; int ctr = -8 * c.slots;
                loop_slots_[l] = {cnt, ctr};
                scan_scope(c, [&] {
                    for (auto& b : n.body) scan_node(c, *b, skip_fns);
                });
                return;
            }
            default:
                return;
        }
    }

    // Runs the scan of a nested block scope, then unbinds every name the
    // block declared (HMX block scoping: sibling blocks may redeclare, a
    // scope-local name is invisible after the block).
    template <typename F>
    void scan_scope(Ctx& c, F&& f) {
        std::map<std::string, int> before(c.locals);
        f();
        for (auto it = c.locals.begin(); it != c.locals.end();) {
            if (before.count(it->first) == 0) it = c.locals.erase(it);
            else ++it;
        }
    }

    // Pre-scan of expressions: the only slot needs live here are per-call-site
    // parks for text arguments (nested calls each get their own region, so
    // composition stays safe). Unknown expression shapes are ignored — the
    // emit pass reports them with a line number.
    void scan_expr(Ctx& c, Expression* e) {
        if (!e) return;
        if (auto* bin = dynamic_cast<BinaryExpr*>(e)) {
            scan_expr(c, bin->left.get());
            scan_expr(c, bin->right.get());
            return;
        }
        if (auto* n = dynamic_cast<NotExpr*>(e)) { scan_expr(c, n->operand.get()); return; }
        if (auto* n = dynamic_cast<NegExpr*>(e)) { scan_expr(c, n->operand.get()); return; }
        if (auto* cond = dynamic_cast<ConditionalExpr*>(e)) {
            scan_expr(c, cond->condition.get());
            scan_expr(c, cond->then_expr.get());
            scan_expr(c, cond->else_expr.get());
            return;
        }
        if (auto* cst = dynamic_cast<CastExpr*>(e)) { scan_expr(c, cst->operand.get()); return; }
        if (auto* idx = dynamic_cast<ArrayIndexExpr*>(e)) scan_expr(c, idx->index.get());
        if (auto* call = dynamic_cast<CallExpr*>(e)) {
            int n_text = 0;
            for (auto& a : call->args) {
                scan_expr(c, a.get());
                if (a->resolved_type == TypeKind::Text) n_text++;
            }
            if (n_text > 0) {
                // contiguous region: slot j (forward ordinal) at base - 8*j,
                // starting at the next free slot
                int base = -8 * (c.slots + 1);
                call_text_slots_[call] = base;
                c.slots += n_text;
            }
            return;
        }
    }

    void finish_frame(Ctx& c) {
        for (int i = 0; i < 3; i++) { c.slots++; c.text_home[i] = -8 * c.slots; }
        c.slots++; c.dec_scratch = -8 * c.slots;
        // Every context parks its return value in a dedicated slot: the
        // epilogue's text releases clobber rax/xmm0, so the value is reloaded
        // after them (main uses it for the process exit code too).
        c.slots++; c.ret_slot = -8 * c.slots;
        int bytes = (c.slots * 8 + 15) & ~15;   // 16-align
        c.slots = bytes / 8;
        c.frame = bytes;
    }

    void emit_frame_head(Ctx& c) {
        out_ << "\tpushq %rbp\n\tmovq %rsp, %rbp\n\tsubq $" << c.frame << ", %rsp\n";
        if (c.ret_slot != 0) out_ << "\tmovq $0, " << c.ret_slot << "(%rbp)\n";
        // text slots are zeroed so a re-executed declaration can release the
        // old value safely (a NULL release is a no-op in the runtime)
        for (int off : c.text_release) out_ << "\tmovq $0, " << off << "(%rbp)\n";
    }

    void emit_frame_tail(Ctx& c) {
        emit_label(c, c.label + "_ret");
        for (int off : c.text_release) {
            out_ << "\tmovq " << off << "(%rbp), %rdi\n";
            emit_call("sd_release_str", 0);
        }
        // reload the parked return value after the releases; main reloads the
        // process exit code, decimal returns ride xmm0.
        if (c.ret_kind == TypeKind::Decimal)
            out_ << "\tmovsd " << c.ret_slot << "(%rbp), %xmm0\n";
        else
            out_ << "\tmovq " << c.ret_slot << "(%rbp), %rax\n";
        out_ << "\tleave\n\tret\n\t.size " << c.label << ", .-" << c.label << "\n";
    }

    // ── labels / calls ───────────────────────────────────────────────────────
    std::string new_label(const char* prefix) {
        // GAS refuses to define the same (even dot-prefixed) label twice in
        // one file, so the counter is backend-wide, not per-context.
        return std::string(".L" + std::string(prefix)) + std::to_string(++global_labels_);
    }
    void emit_label(Ctx&, const std::string& l) {
        // Labels with a leading '.' are local; "main_ret" is a plain local
        // symbol in this object.
        out_ << l << ":\n";
    }
    // Calls realign to 16 when mid-expression pushes are outstanding.
    void emit_call(const std::string& target, int xmm_count) {
        if (ctx_->pending % 2 != 0) out_ << "\tsubq $8, %rsp\n";
        out_ << "\tmovl $" << xmm_count << ", %eax\n";
        out_ << "\tcall " << target << "\n";
        if (ctx_->pending % 2 != 0) out_ << "\taddq $8, %rsp\n";
    }

    // ── rodata pool ──────────────────────────────────────────────────────────
    std::string pool_str(const std::string& s) {
        auto it = str_label_.find(s);
        if (it != str_label_.end()) return it->second;
        std::string lbl = ".LCs" + std::to_string(str_pool_.size());
        str_label_[s] = lbl;
        str_pool_.push_back(s);
        return lbl;
    }
    std::string pool_double(double v) {
        std::array<char, 48> buf{};
        auto [ptr, ec] = std::to_chars(buf.data(), buf.data() + buf.size(), v);
        std::string repr(buf.data(), ptr);
        auto it = dbl_label_.find(repr);
        if (it != dbl_label_.end()) return it->second;
        std::string lbl = ".LCd" + std::to_string(dbl_pool_.size());
        dbl_label_[repr] = lbl;
        dbl_pool_.push_back(repr);
        return lbl;
    }
    void dump_rodata() {
        out_ << "\n\t.section .rodata\n";
        for (size_t i = 0; i < str_pool_.size(); i++) {
            out_ << ".LCs" << i << ":\n\t.byte ";
            for (unsigned char ch : str_pool_[i]) out_ << (int)ch << ", ";
            out_ << "0\n";
        }
        for (size_t i = 0; i < dbl_pool_.size(); i++) {
            out_ << ".LCd" << i << ":\n\t.double " << dbl_pool_[i] << "\n";
        }
        out_ << "\n";
    }

    // ── text runtime shorthands (rax in/out unless noted) ────────────────────
    void release_str_from(int off) {
        out_ << "\tmovq " << off << "(%rbp), %rdi\n";
        emit_call("sd_release_str", 0);
    }
    void retain_str_rax() {
        out_ << "\tmovq %rax, %rdi\n";
        emit_call("sd_retain_str", 0);
    }

    // ── expression compilation ───────────────────────────────────────────────
    Vm type_vm(TypeKind k) {
        switch (k) {
            case TypeKind::Decimal: return Vm::Dec;
            case TypeKind::Text:    return Vm::Txt;
            default:                return Vm::Word;
        }
    }

    Vm compile_expr(Expression* e) {
        if (auto* num = dynamic_cast<NumberLiteral*>(e)) {
            out_ << "\tmovq $" << num->value << ", %rax\n";
            return Vm::Word;
        }
        if (auto* dec = dynamic_cast<DecimalLiteral*>(e)) {
            out_ << "\tmovsd " << pool_double(dec->value) << "(%rip), %xmm0\n";
            return Vm::Dec;
        }
        if (auto* str = dynamic_cast<StringLiteral*>(e)) {
            out_ << "\tleaq " << pool_str(str->value) << "(%rip), %rdi\n";
            out_ << "\tmovq $" << str->value.size() << ", %rsi\n";
            emit_call("sd_make_str", 0);
            return Vm::Txt;
        }
        if (auto* ch = dynamic_cast<CharLiteral*>(e)) {
            out_ << "\tmovq $" << (int)ch->value << ", %rax\n";
            return Vm::Word;
        }
        if (auto* b = dynamic_cast<BoolLiteral*>(e)) {
            out_ << "\tmovq $" << (b->value ? 1 : 0) << ", %rax\n";
            return Vm::Word;
        }
        if (auto* id = dynamic_cast<Identifier*>(e)) {
            if (id->is_function_reference)
                err(e->source_line(), "asm backend v1: function values are not supported");
            auto it = ctx_->locals.find(id->name);
            if (it == ctx_->locals.end())
                err(e->source_line(), "asm backend v1: name '" + id->name + "' is not accessible here");
            int off = it->second;
            Vm vm = type_vm(e->resolved_type);
            if (vm == Vm::Txt) { out_ << "\tmovq " << off << "(%rbp), %rax\n"; retain_str_rax(); return Vm::Txt; }
            if (vm == Vm::Dec) { out_ << "\tmovsd " << off << "(%rbp), %xmm0\n"; return Vm::Dec; }
            out_ << "\tmovq " << off << "(%rbp), %rax\n";
            return Vm::Word;
        }
        if (auto* bin = dynamic_cast<BinaryExpr*>(e)) return compile_binary(bin);
        if (auto* n = dynamic_cast<NotExpr*>(e)) {
            if (type_vm(n->operand->resolved_type) != Vm::Word)
                err(e->source_line(), "asm backend v1: 'not' requires a word operand");
            compile_expr(n->operand.get());
            out_ << "\tcmpq $0, %rax\n\tsete %al\n\tmovzbq %al, %rax\n";
            return Vm::Word;
        }
        if (auto* n = dynamic_cast<NegExpr*>(e)) {
            if (type_vm(n->operand->resolved_type) == Vm::Dec) {
                compile_expr(n->operand.get());
                // xmm0 = -0.0 ^ xmm0 — exact sign flip, so -0.0 stays -0.0.
                out_ << "\tmovsd " << neg_mask() << "(%rip), %xmm1\n";
                out_ << "\txorpd %xmm1, %xmm0\n";
                return Vm::Dec;
            }
            compile_expr(n->operand.get());
            out_ << "\tnegq %rax\n";
            return Vm::Word;
        }
        if (auto* c = dynamic_cast<ConditionalExpr*>(e)) {
            compile_expr(c->condition.get());
            require_word_result_of(c->condition.get(), "c?b condition");
            std::string else_l = new_label("cond");
            std::string end_l = new_label("cond");
            out_ << "\ttestq %rax, %rax\n\tje " << else_l << "\n";
            Vm then_vm = compile_expr(c->then_expr.get());
            out_ << "\tjmp " << end_l << "\n";
            emit_label(*ctx_, else_l);
            Vm else_vm = compile_expr(c->else_expr.get());
            if (then_vm != else_vm)
                err(c->source_line(), "asm backend v1: conditional branches evaluate to different value kinds");
            emit_label(*ctx_, end_l);
            return then_vm;
        }
        if (auto* cst = dynamic_cast<CastExpr*>(e)) {
            Vm src = compile_expr(cst->operand.get());
            if (src == Vm::Word && (cst->target_type == TypeKind::Char || cst->target_type == TypeKind::Int)) {
                if (cst->target_type == TypeKind::Char && TypeKind::Char != cst->operand->resolved_type)
                    out_ << "\tmovsbq %al, %rax\n";   // int -> char: truncate + sign-extend
                return Vm::Word;
            }
            err(e->source_line(), "asm backend v1: unsupported cast target");
        }
        if (auto* call = dynamic_cast<CallExpr*>(e)) return compile_call(call);
        if (auto* idx = dynamic_cast<ArrayIndexExpr*>(e)) {
            if (!idx->is_text || idx->base)
                err(e->source_line(), "asm backend v1: array indexing is not supported (text[name] single index only)");
            int slot = slot_of(idx->name, e->source_line());
            // s[i] -> char: retain the source, bounds-check through the
            // runtime, sign-extend the payload byte (C char semantics).
            out_ << "\tmovq " << slot << "(%rbp), %rax\n";
            retain_str_rax();
            out_ << "\tmovq %rax, " << ctx_->text_home[0] << "(%rbp)\n";
            compile_expr(idx->index.get());
            out_ << "\tpushq %rax\n"; ctx_->pending++;
            out_ << "\tmovq " << ctx_->text_home[0] << "(%rbp), %rax\n";
            out_ << "\tmovl 16(%rax), %edi\n";
            out_ << "\tpopq %rsi\n"; ctx_->pending--;
            emit_call("sd_check_index", 0);
            out_ << "\tmovq %rax, " << ctx_->text_home[1] << "(%rbp)\n";
            out_ << "\tmovq " << ctx_->text_home[0] << "(%rbp), %rax\n";
            out_ << "\tmovq 24(%rax), %rax\n";
            out_ << "\tmovq %rax, " << ctx_->text_home[2] << "(%rbp)\n";
            release_str_from(ctx_->text_home[0]);
            out_ << "\tmovq " << ctx_->text_home[1] << "(%rbp), %rax\n";
            out_ << "\tmovq " << ctx_->text_home[2] << "(%rbp), %rdx\n";
            out_ << "\tmovsbq (%rdx,%rax), %rax\n";
            return Vm::Word;
        }
        err(e->source_line(), "asm backend v1: unsupported expression (build with the default C backend)");
    }

    std::string neg_mask() { return pool_double(-0.0); }

    Vm compile_binary(BinaryExpr* e) {
        TypeKind lt = e->left->resolved_type;
        TypeKind rt = e->right->resolved_type;
        if (lt == TypeKind::Text && rt == TypeKind::Text) return compile_text_binary(e);
        if (lt == TypeKind::Decimal || rt == TypeKind::Decimal) return compile_dec_binary(e);
        if (!is_word(lt) || !is_word(rt))
            err(e->source_line(), "asm backend v1: unsupported operand types for '" + e->op + "'");

        const std::string& op = e->op;
        if (op == "&&" || op == "||") {
            std::string skip_l = new_label("lg");
            std::string end_l = new_label("lg");
            compile_expr(e->left.get());
            out_ << "\ttestq %rax, %rax\n\tj";
            if (op == "&&") out_ << "e " << skip_l << "\n";
            else            out_ << "ne " << skip_l << "\n";
            compile_expr(e->right.get());
            // canonicalize the right result to 0/1 and fall through
            out_ << "\ttestq %rax, %rax\n\t";
            out_ << "setne %al\n\tmovzbq %al, %rax\n";
            out_ << "\tjmp " << end_l << "\n";
            emit_label(*ctx_, skip_l);
            out_ << (op == "&&" ? "\tmovq $0, %rax\n" : "\tmovq $1, %rax\n");
            emit_label(*ctx_, end_l);
            return Vm::Word;
        }

        compile_expr(e->left.get());
        out_ << "\tpushq %rax\n"; ctx_->pending++;
        compile_expr(e->right.get());
        out_ << "\tmovq %rax, %rcx\n";           // right operand
        out_ << "\tpopq %rax\n"; ctx_->pending--; // left operand

        if (op == "+" || op == "-" || op == "*" || op == "/" || op == "%") {
            if (op == "+") out_ << "\taddq %rcx, %rax\n";
            else if (op == "-") out_ << "\tsubq %rcx, %rax\n";
            else if (op == "*") out_ << "\timulq %rcx, %rax\n";
            else {
                out_ << "\tcqto\n\tidivq %rcx\n";
                if (op == "%") out_ << "\tmovq %rdx, %rax\n";
            }
            return Vm::Word;
        }
        const char* cc =
            op == "==" ? "sete"  : op == "!=" ? "setne" : op == "<"  ? "setl"  :
            op == "<=" ? "setle" : op == ">"  ? "setg"  : op == ">=" ? "setge" : nullptr;
        if (!cc) err(e->source_line(), "asm backend v1: unsupported operator '" + op + "'");
        out_ << "\tcmpq %rcx, %rax\n\t" << cc << " %al\n\tmovzbq %al, %rax\n";
        return Vm::Word;
    }

    // Operands evaluate to owned pointers; freed after the runtime call.
    Vm compile_text_binary(BinaryExpr* e) {
        int h0 = ctx_->text_home[0], h1 = ctx_->text_home[1], h2 = ctx_->text_home[2];
        compile_expr(e->left.get());
        out_ << "\tpushq %rax\n"; ctx_->pending++;
        compile_expr(e->right.get());
        out_ << "\tmovq %rax, " << h1 << "(%rbp)\n";     // right
        out_ << "\tpopq %rax\n"; ctx_->pending--;
        out_ << "\tmovq %rax, " << h0 << "(%rbp)\n";     // left
        if (e->op == "+") {
            // sd_concat(a, b) in HMX order: a = left, b = right
            out_ << "\tmovq " << h0 << "(%rbp), %rdi\n";
            out_ << "\tmovq " << h1 << "(%rbp), %rsi\n";
            emit_call("sd_concat", 0);
            out_ << "\tmovq %rax, " << h2 << "(%rbp)\n";
            release_str_from(h0);
            release_str_from(h1);
            out_ << "\tmovq " << h2 << "(%rbp), %rax\n";
            return Vm::Txt;
        }
        if (e->op == "==" || e->op == "!=" || e->op == "<" || e->op == "<=" ||
            e->op == ">" || e->op == ">=") {
            bool eq = e->op == "==" || e->op == "!=";
            out_ << "\tmovq " << h0 << "(%rbp), %rdi\n";
            out_ << "\tmovq " << h1 << "(%rbp), %rsi\n";
            emit_call(eq ? "sd_str_equals" : "sd_str_cmp", 0);
            out_ << "\tmovq %rax, " << h2 << "(%rbp)\n";
            release_str_from(h0);
            release_str_from(h1);
            out_ << "\tmovq " << h2 << "(%rbp), %rax\n";
            if (eq) {
                if (e->op == "!=") {
                    // equality result is canonical 0/1: invert for !=.
                    out_ << "\tcmpq $0, %rax\n\tsete %al\n\tmovzbq %al, %rax\n";
                }
                return Vm::Word;
            }
            // sd_str_cmp: result <0/0/>0 — canonicalize to 0/1 via cmp-to-zero.
            const char* cc = e->op == "<" ? "setl" : e->op == "<=" ? "setle"
                             : e->op == ">" ? "setg" : "setge";
            out_ << "\tcmpq $0, %rax\n\t" << cc << " %al\n\tmovzbq %al, %rax\n";
            return Vm::Word;
        }
        err(e->source_line(), "asm backend v1: unsupported text operator '" + e->op + "'");
    }

    Vm compile_dec_binary(BinaryExpr* e) {
        if (e->op != "+" && e->op != "-" && e->op != "*" && e->op != "/")
            err(e->source_line(), "asm backend v1: decimal '" + e->op + "' is not supported (decimal comparisons not in v1)");
        compile_expr(e->left.get());
        out_ << "\tmovsd %xmm0, " << ctx_->dec_scratch << "(%rbp)\n";
        compile_expr(e->right.get());
        out_ << "\tmovsd " << ctx_->dec_scratch << "(%rbp), %xmm1\n";
        const char* m = e->op == "+" ? "addsd" : e->op == "-" ? "subsd"
                        : e->op == "*" ? "mulsd" : "divsd";
        out_ << "\t" << m << " %xmm0, %xmm1\n";
        out_ << "\tmovsd %xmm1, %xmm0\n";
        return Vm::Dec;
    }

    // ── user function calls ──────────────────────────────────────────────────
    Vm compile_call(CallExpr* c) {
        if (c->is_struct_ctor)        err(c->source_line(), "asm backend v1: structs are not supported");
        if (c->is_partial)            err(c->source_line(), "asm backend v1: partial application is not supported");
        if (c->is_function_value_call) err(c->source_line(), "asm backend v1: function values are not supported");
        auto it = fns_by_name_.find(c->name);
        if (it == fns_by_name_.end()) {
            // Text/char built-ins route through the shared runtime ABI.
            if (c->name == "length") {
                if (c->args[0]->resolved_type == TypeKind::Text) {
                    compile_expr(c->args[0].get());            // owned sd_str*
                    out_ << "\tmovq %rax, " << ctx_->text_home[0] << "(%rbp)\n";
                    out_ << "\tmovq " << ctx_->text_home[0] << "(%rbp), %rax\n";
                    out_ << "\tmovq 16(%rax), %rax\n";
                    out_ << "\tmovq %rax, " << ctx_->text_home[1] << "(%rbp)\n";
                    release_str_from(ctx_->text_home[0]);
                    out_ << "\tmovq " << ctx_->text_home[1] << "(%rbp), %rax\n";
                    return Vm::Word;
                }
                err(c->source_line(), "asm backend v1: length() of arrays is not supported");
            }
            if (c->name == "substring") {
                compile_expr(c->args[0].get());                // owned sd_str*
                out_ << "\tpushq %rax\n\tpushq %rax\n"; ctx_->pending += 2; // + duplicate for post-call release
                compile_expr(c->args[1].get());
                out_ << "\tpushq %rax\n"; ctx_->pending++;
                compile_expr(c->args[2].get());
                out_ << "\tpushq %rax\n"; ctx_->pending++;
                out_ << "\tpopq %rcx\n"; ctx_->pending--;      // end
                out_ << "\tpopq %rsi\n"; ctx_->pending--;      // start
                out_ << "\tpopq %rdi\n"; ctx_->pending--;      // sd_str* (duplicate)
                out_ << "\tmovq %rcx, %rdx\n\tsubq %rsi, %rdx\n";
                emit_call("sd_str_view", 0);
                out_ << "\tmovq %rax, " << ctx_->text_home[2] << "(%rbp)\n";
                out_ << "\tpopq %rax\n"; ctx_->pending--;      // original copy
                out_ << "\tmovq %rax, %rdi\n";
                emit_call("sd_release_str", 0);
                out_ << "\tmovq " << ctx_->text_home[2] << "(%rbp), %rax\n";
                return Vm::Txt;
            }
            if (c->name == "ord") {
                compile_expr(c->args[0].get());
                out_ << "\tmovzbq %al, %rax\n";
                return Vm::Word;
            }
            if (c->name == "chr") {
                compile_expr(c->args[0].get());
                std::string panic_l = new_label("chrpanic");
                std::string done_l = new_label("chrdone");
                out_ << "\tmovq %rax, %rdx\n";
                out_ << "\tcmpq $0, %rax\n\tjl " << panic_l << "\n";
                out_ << "\tcmpq $255, %rax\n\tjg " << panic_l << "\n";
                out_ << "\tmovzbq %al, %rax\n\tjmp " << done_l << "\n";
                emit_label(*ctx_, panic_l);
                out_ << "\tleaq " << pool_str("Error: chr expects a character code between 0 and 255, got %d\n")
                     << "(%rip), %rdi\n";
                out_ << "\tmovq %rdx, %rsi\n";
                emit_call("_sd_panicf", 0);
                emit_label(*ctx_, done_l);
                return Vm::Word;
            }
            err(c->source_line(), "asm backend v1: builtin '" + c->name + "' is not supported (build with the default C backend)");
        }
        FunctionDecl* fn = it->second;
        size_t n = c->args.size();
        if (n != fn->params.size())
            err(c->source_line(), "asm backend v1: argument count mismatch for '" + fn->name + "'");
        if (n > MAX_CALL_WORD_ARGS) err(c->source_line(), "asm backend v1: too many call arguments (max 6)");

        // SysV plan: word args fill CALL_REGS in order; decimals fill xmm0.. in
        // order. Text arguments pass one word register (the sd_str*). Every
        // argument is spilled on the stack exactly once; text arguments are
        // additionally parked in this call site's reserved slots so the
        // caller can drop its +1 after the call (nested calls use their own
        // regions, so parking composes safely).
        std::vector<std::pair<Vm, int>> plan(n);
        int wi = 0, xi = 0;
        for (size_t i = 0; i < n; i++) {
            if (fn->params[i].type == TypeKind::Decimal) plan[i] = {Vm::Dec, xi++};
            else plan[i] = {Vm::Word, wi++};
        }
        for (size_t i = 0; i < n; i++) {
            compile_expr(c->args[i].get());
            if (plan[i].first == Vm::Dec) {
                out_ << "\tsubq $8, %rsp\n\tmovsd %xmm0, (%rsp)\n";
                ctx_->pending++;
            } else {
                out_ << "\tpushq %rax\n";
                ctx_->pending++;
            }
        }
        for (size_t k = n; k-- > 0;) {
            if (plan[k].first == Vm::Dec) {
                out_ << "\tmovsd (%rsp), %xmm" << plan[k].second << "\n\taddq $8, %rsp\n";
                ctx_->pending--;
            } else {
                out_ << "\tpopq %rax\n";
                ctx_->pending--;
                if (c->args[k]->resolved_type == TypeKind::Text) {
                    int ordinal = 0;
                    for (size_t j = 0; j < k; j++)
                        if (c->args[j]->resolved_type == TypeKind::Text) ordinal++;
                    const int base = call_text_slots_[c];
                    out_ << "\tmovq %rax, " << base - 8 * ordinal << "(%rbp)\n";
                }
                out_ << "\tmovq %rax, %" << CALL_REGS[plan[k].second] << "\n";
            }
        }
        emit_call("_hmx_" + fn->name, 0);
        // drop the caller's +1 on each text argument from its reserved slot;
        // the releases clobber rax/xmm0, so a call result is parked first.
        size_t can_text = 0;
        for (size_t i = 0; i < n; i++)
            if (c->args[i]->resolved_type == TypeKind::Text) can_text++;
        if (can_text > 0) {
            if (fn->has_return_type && fn->return_type == TypeKind::Decimal)
                out_ << "\tmovsd %xmm0, " << ctx_->dec_scratch << "(%rbp)\n";
            else
                out_ << "\tmovq %rax, " << ctx_->text_home[0] << "(%rbp)\n";
        }
        for (size_t i = 0, t = 0; i < n; i++) {
            if (c->args[i]->resolved_type != TypeKind::Text) continue;
            const int base = call_text_slots_[c];
            out_ << "\tmovq " << base - 8 * t << "(%rbp), %rdi\n"; t++;
            emit_call("sd_release_str", 0);
        }
        if (can_text > 0) {
            if (fn->has_return_type && fn->return_type == TypeKind::Decimal)
                out_ << "\tmovsd " << ctx_->dec_scratch << "(%rbp), %xmm0\n";
            else
                out_ << "\tmovq " << ctx_->text_home[0] << "(%rbp), %rax\n";
        }
        return !fn->has_return_type ? Vm::Word : type_vm(fn->return_type);
    }

    // ── print (printf varargs packing) ───────────────────────────────────────
    void emit_print(PrintStmt* s) {
        std::string fmt;
        std::vector<Vm> modes(s->args.size());
        for (size_t i = 0; i < s->args.size(); i++) {
            if (i > 0) fmt += " ";
            TypeKind t = s->args[i]->resolved_type;
            if (!is_v1_value(t))
                err(s->line, "asm backend v1: unsupported print argument type");
            modes[i] = type_vm(t);
            fmt += t == TypeKind::Text ? "%.*s" : t == TypeKind::Decimal ? "%f" : t == TypeKind::Char ? "%c" : "%d";
        }
        fmt += "\n";
        std::string fmt_lbl = pool_str(fmt);

        // Layout: text occupies two word slots (len, ptr); decimals go to xmm.
        std::vector<std::pair<int, int>> plan(s->args.size());  // (wordIdx, xmmIdx)
        int w = 0, x = 0;
        for (size_t i = 0; i < s->args.size(); i++) {
            if (modes[i] == Vm::Txt) { plan[i] = {w, -1}; w += 2; }
            else if (modes[i] == Vm::Dec) { plan[i] = {-1, x++}; }
            else { plan[i] = {w, -1}; w += 1; }
        }
        if (w > MAX_PRINT_WORD_SLOTS)
            err(s->line, "asm backend v1: print with this many text/int arguments needs stack variable args (unsupported in v1)");

        // evaluate + spill each arg
        for (size_t i = 0; i < s->args.size(); i++) {
            compile_expr(s->args[i].get());
            if (modes[i] == Vm::Dec) {
                out_ << "\tsubq $8, %rsp\n\tmovsd %xmm0, (%rsp)\n";
                ctx_->pending++;
            } else {
                out_ << "\tpushq %rax\n";
                ctx_->pending++;
            }
        }
        // pack in reverse argument order; text pointers are parked in homes
        // for their release after the call.
        for (size_t k = s->args.size(); k-- > 0;) {
            auto [wi, xi] = plan[k];
            if (modes[k] == Vm::Txt) {
                // one pushed quad: the owned sd_str*. len (+16) and data
                // (+24) are dereferenced into the format's two word slots;
                // the sd_str* itself parks in a home for the release.
                int h = text_home_of(wi / 2);
                out_ << "\tpopq %rax\n"; ctx_->pending--;
                out_ << "\tmovq %rax, " << h << "(%rbp)\n";
                out_ << "\tmovq 16(%rax), %" << PRINT_REGS[wi] << "\n";          // len
                out_ << "\tmovq 24(%rax), %" << PRINT_REGS[wi + 1] << "\n";      // data
            } else if (modes[k] == Vm::Dec) {
                out_ << "\tmovsd (%rsp), %xmm" << xi << "\n\taddq $8, %rsp\n";
                ctx_->pending--;
            } else {
                out_ << "\tpopq %" << PRINT_REGS[wi] << "\n";
                ctx_->pending--;
            }
        }
        out_ << "\tleaq " << fmt_lbl << "(%rip), %rdi\n";
        int xmm_count = 0;
        for (auto& p : plan) if (p.second >= 0) xmm_count++;
        emit_call("printf", xmm_count);
        for (size_t i = 0, th = 0; i < s->args.size(); i++) {
            if (modes[i] == Vm::Txt) release_str_from(text_home_of(th++));
        }
    }

    int text_home_of(int i) {
        if (i >= 3) err(0, "asm backend v1: at most 3 text arguments per print are supported");
        return ctx_->text_home[i];
    }

    // ── statements ───────────────────────────────────────────────────────────
    const int& slot_of(const std::string& name, int line) {
        auto it = ctx_->locals.find(name);
        if (it == ctx_->locals.end())
            err(line, "asm backend v1: name '" + name + "' is not assignable here");
        return it->second;
    }

    void require_word_result_of(Expression* e, const char* where) {
        if (!is_word(e->resolved_type))
            err(e->source_line(), std::string("asm backend v1: ") + where + " must be a word value (int/bool/char)");
    }

    void emit_node(Ctx& c, const ir::Node& n) {
        ctx_ = &c;
        switch (n.kind) {
            case ir::SKind::VarDecl: {
                auto* v = static_cast<VarDecl*>(n.ast);
                auto ds = decl_slots_.find(v);
                if (ds == decl_slots_.end())
                    err(v->line, "asm backend v1: internal: undeclared name '" + v->name + "'");
                const int off = ds->second;
                c.locals[v->name] = off;   // bind the name for this scope
                if (!v->initializer) {
                    if (decl_is_text(v))
                        err(v->line, "asm backend v1: uninitialized text local would dangle (text slots are released at function exit)");
                    out_ << "\tmovq $0, " << off << "(%rbp)\n";
                    return;
                }
                Vm vm = compile_expr(v->initializer.get());
                if (vm == Vm::Txt) {
                    // owned new ref; the slot may already hold a value from a
                    // previous execution of this declaration inside a loop
                    out_ << "\tpushq %rax\n"; ctx_->pending++;
                    release_str_from(off);
                    out_ << "\tpopq %rax\n"; ctx_->pending--;
                    out_ << "\tmovq %rax, " << off << "(%rbp)\n";
                    register_text_slot(off);
                } else store_dropdown(off, vm);
                return;
            }
            case ir::SKind::Assign: {
                auto* s = static_cast<AssignStmt*>(n.ast);
                const int& off = slot_of(s->name, s->line);
                TypeKind rhs_t = s->rhs ? s->rhs->resolved_type : TypeKind::Int;
                if (s->op == "=") {
                    Vm vm = compile_expr(s->rhs.get());
                    if (vm == Vm::Txt) {
                        // new ref is owned; release the old value AFTER
                        out_ << "\tpushq %rax\n"; ctx_->pending++;
                        release_str_from(off);
                        out_ << "\tpopq %rax\n"; ctx_->pending--;
                        out_ << "\tmovq %rax, " << off << "(%rbp)\n";
                        register_text_slot(off);
                    } else store_dropdown(off, vm);
                    return;
                }
                if (s->op == "++" || s->op == "--") {
                    if (rhs_t == TypeKind::Decimal)
                        err(s->line, "asm backend v1: '++'/'--' on a decimal is not supported");
                    out_ << (s->op == "++" ? "\tincq " : "\tdecq ") << off << "(%rbp)\n";
                    return;
                }
                if (rhs_t == TypeKind::Decimal || rhs_t == TypeKind::Text)
                    err(s->line, "asm backend v1: compound assignment on decimals/text is not supported");
                compile_expr(s->rhs.get());
                out_ << "\tmovq %rax, %rcx\n";
                out_ << "\tmovq " << off << "(%rbp), %rax\n";
                const std::string& op = s->op;
                if (op == "+=") out_ << "\taddq %rcx, %rax\n";
                else if (op == "-=") out_ << "\tsubq %rcx, %rax\n";
                else if (op == "*=") out_ << "\timulq %rcx, %rax\n";
                else if (op == "/=" || op == "%=") {
                    out_ << "\tcqto\n\tidivq %rcx\n";
                    if (op == "%=") out_ << "\tmovq %rdx, %rax\n";
                } else err(s->line, "asm backend v1: unsupported assignment operator '" + op + "'");
                out_ << "\tmovq %rax, " << off << "(%rbp)\n";
                return;
            }
            case ir::SKind::ExprStmt: {
                auto* s = static_cast<ExprStmt*>(n.ast);
                Vm vm = compile_expr(s->expr.get());
                if (vm == Vm::Txt) {
                    out_ << "\tmovq %rax, %rdi\n";
                    emit_call("sd_release_str", 0);
                }
                return;
            }
            case ir::SKind::Print:
                emit_print(static_cast<PrintStmt*>(n.ast));
                return;
            case ir::SKind::If: {
                auto* s = static_cast<IfStmt*>(n.ast);
                compile_expr(s->condition.get());
                require_word_result_of(s->condition.get(), "if condition");
                std::string else_l = s->has_else ? new_label("else") : new_label("endif");
                std::string end_l = s->has_else ? new_label("endif") : else_l;
                out_ << "\ttestq %rax, %rax\n\tje " << (s->has_else ? else_l : end_l) << "\n";
                emit_scope(c, [&] {
                    for (auto& b : n.body) emit_node(c, *b);
                });
                if (s->has_else) {
                    out_ << "\tjmp " << end_l << "\n";
                    emit_label(c, else_l);
                    emit_scope(c, [&] {
                        for (auto& b : n.else_body) emit_node(c, *b);
                    });
                }
                emit_label(c, end_l);
                return;
            }
            case ir::SKind::While: {
                auto* s = static_cast<WhileStmt*>(n.ast);
                std::string top_l = new_label("while");
                std::string end_l = new_label("wend");
                emit_label(c, top_l);
                compile_expr(s->condition.get());
                require_word_result_of(s->condition.get(), "while condition");
                out_ << "\ttestq %rax, %rax\n\tje " << end_l << "\n";
                c.loops.push_back({end_l, top_l});
                emit_scope(c, [&] {
                    for (auto& b : n.body) emit_node(c, *b);
                });
                c.loops.pop_back();
                out_ << "\tjmp " << top_l << "\n";
                emit_label(c, end_l);
                return;
            }
            case ir::SKind::DoWhile: {
                auto* s = static_cast<DoWhileStmt*>(n.ast);
                std::string top_l = new_label("do");
                std::string end_l = new_label("od");
                std::string cont_l = new_label("doc");
                emit_label(c, top_l);
                c.loops.push_back({end_l, cont_l});
                emit_scope(c, [&] {
                    for (auto& b : n.body) emit_node(c, *b);
                });
                c.loops.pop_back();
                emit_label(c, cont_l);
                compile_expr(s->condition.get());
                require_word_result_of(s->condition.get(), "do-while condition");
                out_ << "\ttestq %rax, %rax\n\tjne " << top_l << "\n";
                out_ << end_l << ":\n";
                return;
            }
            case ir::SKind::For: {
                auto* s = static_cast<ForStmt*>(n.ast);
                std::string top_l = new_label("for");
                std::string end_l = new_label("rof");
                // the header declaration is scoped to header + body
                std::string hdr; bool had = false; int prev = 0;
                if (n.init && n.init->kind == ir::SKind::VarDecl) {
                    hdr = static_cast<VarDecl*>(n.init->ast)->name;
                    auto it = c.locals.find(hdr);
                    if (it != c.locals.end()) { had = true; prev = it->second; }
                }
                if (n.init) emit_node(c, *n.init);
                emit_label(c, top_l);
                if (s->condition) {
                    compile_expr(s->condition.get());
                    require_word_result_of(s->condition.get(), "for condition");
                } else {
                    out_ << "\tmovq $1, %rax\n";
                }
                out_ << "\ttestq %rax, %rax\n\tje " << end_l << "\n";
                std::string cont_l = new_label("forcont");
                c.loops.push_back({end_l, cont_l});
                emit_scope(c, [&] {
                    for (auto& b : n.body) emit_node(c, *b);
                });
                c.loops.pop_back();
                emit_label(c, cont_l);
                if (n.update) emit_node(c, *n.update);
                out_ << "\tjmp " << top_l << "\n";
                emit_label(c, end_l);
                if (had) c.locals[hdr] = prev;
                else if (!hdr.empty()) c.locals.erase(hdr);
                return;
            }
            case ir::SKind::Loop: {
                auto* s = static_cast<LoopStmt*>(n.ast);
                require_word_result_of(s->count.get(), "loop count");
                auto slots = loop_slots_[s];
                std::string top_l = new_label("loop");
                std::string end_l = new_label("pool");
                compile_expr(s->count.get());
                out_ << "\tmovq %rax, " << slots.first << "(%rbp)\n";
                out_ << "\tmovq $0, " << slots.second << "(%rbp)\n";
                emit_label(c, top_l);
                out_ << "\tmovq " << slots.second << "(%rbp), %rax\n";
                out_ << "\tcmpq " << slots.first << "(%rbp), %rax\n\tjge " << end_l << "\n";
                std::string cont_l = new_label("loopcont");
                c.loops.push_back({end_l, cont_l});
                emit_scope(c, [&] {
                    for (auto& b : n.body) emit_node(c, *b);
                });
                c.loops.pop_back();
                emit_label(c, cont_l);
                out_ << "\tincq " << slots.second << "(%rbp)\n";
                out_ << "\tjmp " << top_l << "\n";
                emit_label(c, end_l);
                return;
            }
            case ir::SKind::Break:
                if (c.loops.empty()) err(n.ast->line, "asm backend v1: break outside a loop");
                out_ << "\tjmp " << c.loops.back().brk << "\n";
                return;
            case ir::SKind::Continue:
                if (c.loops.empty()) err(n.ast->line, "asm backend v1: continue outside a loop");
                out_ << "\tjmp " << c.loops.back().cont << "\n";
                return;
            case ir::SKind::Return: {
                auto* s = static_cast<ReturnStmt*>(n.ast);
                if (!s->values.empty()) {
                    if (s->values.size() > 1)
                        err(s->line, "asm backend v1: multi-value return is a tuple (not supported)");
                    Expression* val = s->values[0].get();
                    Vm vm = compile_expr(val);
                    if (c.is_main_body) {
                        if (vm != Vm::Word)
                            err(s->line, "asm backend v1: main must return an int");
                        out_ << "\tmovq %rax, " << c.ret_slot << "(%rbp)\n";
                    } else {
                        // Park the return value: the epilogue's text releases
                        // clobber rax/xmm0, so the tail reloads it.
                        if (vm == Vm::Dec)
                            out_ << "\tmovsd %xmm0, " << c.ret_slot << "(%rbp)\n";
                        else
                            out_ << "\tmovq %rax, " << c.ret_slot << "(%rbp)\n";
                    }
                }
                out_ << "\tjmp " << (c.label + "_ret") << "\n";
                return;
            }
            case ir::SKind::Defer:
                err(n.ast->line, "asm backend v1: defer is not supported");
                return;
            case ir::SKind::Try:
                err(n.ast->line, "asm backend v1: try/catch is not supported");
                return;
            case ir::SKind::Switch:
                err(n.ast->line, "asm backend v1: switch is not supported");
                return;
            case ir::SKind::Foreach:
                err(n.ast->line, "asm backend v1: foreach is not supported");
                return;
            case ir::SKind::MultiAssign:
            case ir::SKind::DestructDecl:
            case ir::SKind::ArrayAssign:
            case ir::SKind::ElementAssign:
            case ir::SKind::MemberAssign:
                err(n.ast->line, "asm backend v1: array/tuple/struct assignment is not supported");
                return;
            case ir::SKind::TypeDecl:
                err(n.ast->line, "asm backend v1: type declarations are not supported");
                return;
            case ir::SKind::FuncDecl:
                return;  // registered up front
        }
    }

private:
    void store_dropdown(int off, Vm vm) {
        if (vm == Vm::Dec) out_ << "\tmovsd %xmm0, " << off << "(%rbp)\n";
        else out_ << "\tmovq %rax, " << off << "(%rbp)\n";
    }
    void register_text_slot(int off) {
        auto& v = ctx_->text_release;
        if (std::find(v.begin(), v.end(), off) == v.end()) v.push_back(off);
    }

    // Emit-side mirror of scan_scope: unbind names the block declared so a
    // later sibling block rebinds cleanly through its own declaration.
    template <typename F>
    void emit_scope(Ctx& c, F&& f) {
        std::map<std::string, int> before(c.locals);
        f();
        for (auto it = c.locals.begin(); it != c.locals.end();) {
            if (before.count(it->first) == 0) it = c.locals.erase(it);
            else ++it;
        }
    }

    void check_fn_signature(FunctionDecl* fn) {
        for (auto& p : fn->params) {
            if (!is_v1_value(p.type))
                err(fn->line, "asm backend v1: parameter type of '" + fn->name + "' is unsupported (word/decimal/text only)");
        }
        if (fn->has_return_type && !is_v1_value(fn->return_type))
            err(fn->line, "asm backend v1: return type of '" + fn->name + "' is unsupported");
    }

    void scan_fn_body_into_main() {
        auto main_ir = ir::build(main_fn_->body);
        scan_list(ctx_main_, main_ir, false);
    }

    void emit_function(FunctionDecl* fn) {
        Ctx& c = *fn_ctx_[fn];
        out_ << "\n\t.type " << c.label << ", @function\n";
        out_ << c.label << ":\n";
        emit_frame_head(c);
        // park register args into their slots (SysV: words in CALL_REGS,
        // decimals in xmm0.. in order of appearance)
        int xi = 0;
        for (size_t i = 0; i < fn->params.size(); i++) {
            int off = c.locals[fn->params[i].name];
            if (fn->params[i].type == TypeKind::Decimal)
                out_ << "\tmovsd %xmm" << xi++ << ", " << off << "(%rbp)\n";
            else
                out_ << "\tmovq %" << CALL_REGS[i] << ", " << off << "(%rbp)\n";
        }
        auto body_ir = ir::build(fn->body);
        for (auto& n : body_ir) emit_node(c, *n);
        emit_label(c, c.label + "_ret");
        for (int off : c.text_release) release_str_from(off);
        if (c.ret_kind == TypeKind::Decimal)
            out_ << "\tmovsd " << c.ret_slot << "(%rbp), %xmm0\n";
        else
            out_ << "\tmovq " << c.ret_slot << "(%rbp), %rax\n";
        out_ << "\tleave\n\tret\n\t.size " << c.label << ", .-" << c.label << "\n";
    }
};

} // namespace

std::string emit_asm(Program& program, const std::string& source_file) {
    X64Backend backend(program, source_file);
    return backend.run();
}
