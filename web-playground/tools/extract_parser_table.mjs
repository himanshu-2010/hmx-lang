#!/usr/bin/env node
// Extract bison LALR tables from the generated build/parser.cpp into
// src/compiler/tables/tables.json so the TS generic LR driver can drive the
// exact grammar (6 shift/reduce conflicts included).
//
// Usage: node tools/extract_parser_table.mjs [path/to/parser.cpp]
// Defaults to ../../build/parser.cpp relative to this file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pcpp = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(here, "../../build/parser.cpp");

if (!fs.existsSync(pcpp)) {
  console.error(`Cannot find generated parser at ${pcpp}`);
  console.error("Run `cmake --build build` first.");
  process.exit(1);
}

const src = fs.readFileSync(pcpp, "utf8");

const CONST_RE = /^#define\s+(YYFINAL|YYLAST|YYNTOKENS|YYNNTS|YYNRULES|YYNSTATES|YYMAXUTOK)\s+(\d+)/mg;
const NINF_RE = /^#define\s+(YYPACT_NINF)\s+\((-?\d+)\)/m;

function grabConstants() {
  const out = {};
  for (const m of src.matchAll(CONST_RE)) out[m[1]] = Number(m[2]);
  const ninf = src.match(NINF_RE);
  if (ninf) out[ninf[1]] = Number(ninf[2]);
  return out;
}

function grabArray(name) {
  const marker = new RegExp(`static const [^{]+\\b${name}\\[\\]\\s*=\\s*\\{`, "m");
  const m = marker.exec(src);
  if (!m) throw new Error(`array ${name} not found`);
  const start = src.indexOf("{", m.index) + 1;
  // Find the matching closing brace (nesting-aware, string-literal-aware).
  let depth = 1;
  let i = start;
  let inStr = false;
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    }
  }
  const body = src.slice(start, i - 1);
  const values = body
    .split(/[,\n\r\t ]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => {
      if (t.startsWith('"')) return t; // string kept raw
      const n = Number(t);
      if (Number.isNaN(n)) throw new Error(`bad table value '${t}' in ${name}`);
      return n;
    });
  return values;
}

function grabStringArray(name) {
  const marker = new RegExp(`static const char \\*const\\s+${name}\\[\\]\\s*=\\s*\\{`, "m");
  const m = marker.exec(src);
  if (!m) throw new Error(`string array ${name} not found`);
  const start = src.indexOf("{", m.index) + 1;
  let i = start;
  let inStr = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "}") {
      break;
    }
  }
  const body = src.slice(start, i);
  // Strings may contain escapes; parse C-string literals separated by commas.
  const items = [];
  let j = 0;
  while (j < body.length) {
    while (j < body.length && (body[j] === "," || /[\s\n\r\t]/.test(body[j]))) j++;
    if (j >= body.length) break;
    if (body[j] !== '"') break; // trailing sentinel like YY_NULLPTR
    j++;
    let s = "";
    while (j < body.length) {
      const c = body[j];
      if (c === "\\") {
        const e = body[j + 1];
        const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "0": "\0" };
        s += e in map ? map[e] : e;
        j += 2;
      } else if (c === '"') {
        j++;
        break;
      } else {
        s += c;
        j++;
      }
    }
    items.push(s);
  }
  return items;
}

const constants = grabConstants();
const tables = {
  constants,
  yytranslate: grabArray("yytranslate"),
  yyrline: grabArray("yyrline"),
  yytname: grabStringArray("yytname"),
  yypact: grabArray("yypact"),
  yydefact: grabArray("yydefact"),
  yypgoto: grabArray("yypgoto"),
  yydefgoto: grabArray("yydefgoto"),
  yytable: grabArray("yytable"),
  yycheck: grabArray("yycheck"),
  yystos: grabArray("yystos"),
  yyr1: grabArray("yyr1"),
  yyr2: grabArray("yyr2"),
};

// Sanity: sizes.
const sizes = {
  yypact: constants.YYNSTATES,
  yydefact: constants.YYNSTATES,
  yypgoto: constants.YYNNTS,
  yydefgoto: constants.YYNNTS,
  yystos: constants.YYNSTATES,
  yyr1: constants.YYNRULES + 1,
  yyr2: constants.YYNRULES + 1,
  yytname: constants.YYNTOKENS + constants.YYNNTS, // excludes trailing NULL sentinel
};
for (const [name, size] of Object.entries(sizes)) {
  if (tables[name].length !== size) {
    console.error(
      `Size mismatch: ${name} has ${tables[name].length}, expected ${size}.` +
        " The generic driver or this extractor's expectations are stale."
    );
    process.exit(1);
  }
}

// Rule metadata for actions: LHS symbol name + RHS length, indexed by rule.
const ntok = constants.YYNTOKENS;
const rules = [];
for (let r = 0; r <= constants.YYNRULES; r++) {
  const lhsSym = tables.yyr1[r];
  rules.push({
    lhs: tables.yytname[lhsSym],
    len: tables.yyr2[r],
  });
}

const outPath = path.resolve(here, "../src/compiler/tables/tables.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify({ ...tables, rules }, null, 1) + "\n"
);
console.log(`Wrote ${outPath}`);
console.log(`  tokens=${constants.YYNTOKENS} nonterms=${constants.YYNNTS} ` +
            `states=${constants.YYNSTATES} rules=${constants.YYNRULES}`);