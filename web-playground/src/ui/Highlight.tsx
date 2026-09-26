import type { ReactNode } from "react";

const KEYWORDS = new Set([
  "and", "as", "break", "case", "const", "continue", "default", "do",
  "else", "false", "fn", "for", "foreach", "if", "in", "lambda", "let",
  "loop", "not", "or", "print", "return", "switch", "true", "use", "while",
]);

const TYPES = new Set(["int", "decimal", "text", "bool", "char", "byte"]);

const BUILTINS = new Set([
  "input", "tostr", "parse_int", "parse_decimal", "length", "push", "pop",
  "sort", "slice", "concat", "index_of", "contains", "split", "ord", "chr",
]);

/**
 * Tiny HMX syntax highlighter. Line-based: `//` comments run to end of line,
 * strings/chars scanned greedily, then numbers, then identifiers/punctuation.
 */
export function Highlight({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <>
      {lines.map((line, li) => {
        const nodes: ReactNode[] = [];
        let i = 0;

        const commentAt = line.indexOf("//");
        const active = commentAt === -1 ? line : line.slice(0, commentAt);
        const comment = commentAt === -1 ? null : line.slice(commentAt);

        while (i < active.length) {
          const ch = active[i];

          if (ch === '"' || ch === "'") {
            const quote = ch;
            let j = i + 1;
            while (j < active.length && active[j] !== quote) j++;
            const token = active.slice(i, j + 1);
            nodes.push(
              <span key={`${li}-${i}`} className="tok-str">
                {token}
              </span>,
            );
            i = j + 1;
            continue;
          }

          if (/[0-9]/.test(ch)) {
            let j = i;
            if (active.startsWith("0x", i) || active.startsWith("0X", i)) {
              j = i + 2;
              while (j < active.length && /[0-9a-fA-F]/.test(active[j])) j++;
            } else {
              while (j < active.length && /[0-9.]/.test(active[j])) j++;
            }
            nodes.push(
              <span key={`${li}-${i}`} className="tok-num">
                {active.slice(i, j)}
              </span>,
            );
            i = j;
            continue;
          }

          if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < active.length && /[A-Za-z0-9_]/.test(active[j])) j++;
            const word = active.slice(i, j);
            let cls = "tok-id";
            if (KEYWORDS.has(word)) cls = "tok-kw";
            else if (TYPES.has(word)) cls = "tok-type";
            else if (BUILTINS.has(word)) cls = "tok-bn";
            nodes.push(
              <span key={`${li}-${i}`} className={cls}>
                {word}
              </span>,
            );
            i = j;
            continue;
          }

          nodes.push(
            <span key={`${li}-${i}`} className="tok-op">
              {ch}
            </span>,
          );
          i++;
        }

        if (comment !== null) {
          nodes.push(
            <span key={`${li}-comment`} className="tok-com">
              {comment}
            </span>,
          );
        }

        return (
          <span key={li}>
            {nodes}
            {li < lines.length - 1 ? "\n" : null}
          </span>
        );
      })}
    </>
  );
}