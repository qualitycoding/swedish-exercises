// Validates every theme file: structure, exactly 10 scored items per exercise, answer indices,
// markup syntax, register labels, and that word-order and keyword items are self-consistent.
// Usage: node tools/validate.mjs   (exit status 0 = all valid)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkup, scoreKeywords, scoreOrder, scoreTyped, plain } from "../assets/scoring.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABELS = new Set(["", "slang", "vardagligt", "idiom"]);
const KINDS = ["lasa", "lyssna", "skriva", "tala"];
const ALLOWED = {
  lasa: new Set(["mc", "tf"]),
  lyssna: new Set(["mc", "tf", "dictation"]),
  skriva: new Set(["gap", "order", "translate"]),
  tala: new Set(["read", "respond"]),
};
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

function checkMarkup(where, text) {
  if (typeof text !== "string") return fail(where, "text is not a string");
  const opens = (text.match(/\[\[/g) || []).length;
  const closes = (text.match(/\]\]/g) || []).length;
  const terms = parseMarkup(text).filter((p) => p.type === "term");
  if (opens !== closes || opens !== terms.length) fail(where, `malformed [[…]] markup (${opens} open, ${closes} close, ${terms.length} parsed)`);
  for (const t of terms) if (!LABELS.has(t.label)) fail(where, `unknown label '${t.label}' on '${t.text}'`);
  return terms;
}

const manifest = JSON.parse(readFileSync(join(root, "data/manifest.json"), "utf8"));
const ids = new Set();
let exerciseCount = 0;
let slangCount = 0;

for (const file of manifest.themes) {
  const theme = JSON.parse(readFileSync(join(root, "data", file), "utf8"));
  const w = file;
  for (const f of ["id", "title", "short", "dateLabel", "level", "summary", "sources", "exercises"]) {
    if (!(f in theme)) fail(w, `missing field ${f}`);
  }
  if (ids.has(theme.id)) fail(w, `duplicate theme id ${theme.id}`);
  ids.add(theme.id);
  if (!Array.isArray(theme.sources) || theme.sources.length === 0) fail(w, "no sources");
  for (const s of theme.sources || []) if (!/^https:\/\//.test(s.url)) fail(w, `source url not https: ${s.url}`);

  for (const kind of KINDS) {
    const ex = theme.exercises?.[kind];
    const where = `${w}#${kind}`;
    if (!ex) {
      fail(where, "missing exercise");
      continue;
    }
    exerciseCount += 1;
    if (!ex.title) fail(where, "missing title");
    const items = kind === "skriva" || kind === "tala" ? ex.tasks : ex.questions;
    if (!Array.isArray(items) || items.length !== 10) fail(where, `expected 10 scored items, found ${items?.length}`);
    const texts = [...(ex.text || []), ...(ex.script || []), ...(ex.vocab || [])];
    const terms = texts.flatMap((t, i) => checkMarkup(`${where} text[${i}]`, t));
    slangCount += terms.filter((t) => t.label === "slang").length;
    if (kind === "lasa") {
      if (!terms.some((t) => t.label === "slang")) fail(where, "reading text has no term labelled slang");
      const words = plain(ex.text.join(" ")).split(/\s+/).length;
      if (words < 200 || words > 450) fail(where, `reading text is ${words} words (expected 200–450 for ~10 minutes)`);
    }
    if (kind === "lyssna") {
      const words = plain(ex.script.join(" ")).split(/\s+/).length;
      if (words < 120 || words > 320) fail(where, `listening script is ${words} words (expected 120–320)`);
    }
    (items || []).forEach((q, i) => {
      const at = `${where} item ${i + 1}`;
      if (!ALLOWED[kind].has(q.type)) fail(at, `type '${q.type}' not allowed in ${kind}`);
      for (const k of ["q", "text"]) if (q[k]) checkMarkup(at, q[k]);
      if (q.type === "mc") {
        if (!Array.isArray(q.options) || q.options.length < 3) fail(at, "mc needs ≥3 options");
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) fail(at, "mc answer index out of range");
        if (new Set(q.options).size !== q.options.length) fail(at, "duplicate mc options");
      }
      if (q.type === "tf" && typeof q.answer !== "boolean") fail(at, "tf answer must be boolean");
      if (q.type === "gap") {
        if (!q.q.includes("___")) fail(at, "gap question has no ___");
        if (!q.accept?.length) fail(at, "gap needs accept list");
        else if (scoreTyped(q.accept[0], q.accept).points !== 1) fail(at, "first accepted gap answer does not score 1");
      }
      if (q.type === "order") {
        if (!q.accept?.length || !q.en) fail(at, "order needs accept and en");
        else {
          const words = q.accept[0].replace(/[.!?]$/, "").split(" ");
          if (scoreOrder(words, q.accept).points !== 1) fail(at, "order: canonical sentence does not score 1");
          for (const alt of q.accept.slice(1)) {
            const a = alt.replace(/[.!?]$/, "").split(" ").sort().join(" ");
            if (a !== words.slice().sort().join(" ") && alt.split(" ").length === words.length) fail(at, `order: alternative '${alt}' uses different words`);
          }
        }
      }
      if (q.type === "translate" || q.type === "respond") {
        if (!q.keywords?.length || !q.model) fail(at, "needs keywords and model");
        else {
          if (q.keywords.some((g) => g.some((s) => s.trim().length < 2))) fail(at, "keyword stem shorter than 2 letters matches too much");
          if (scoreKeywords(q.model, q.keywords).points !== 1) fail(at, `model answer '${q.model}' does not hit every keyword group`);
        }
      }
      if ((q.type === "dictation" || q.type === "read") && /\d/.test(q.text)) fail(at, "digits in a spoken target (recognisers write numbers inconsistently)");
      if (q.type === "respond" && !q.q) fail(at, "respond needs q");
    });
    if (kind === "skriva" && ex.free) {
      for (const f of ["prompt", "checklist", "model", "words"]) if (!ex.free[f]) fail(where, `free writing missing ${f}`);
      checkMarkup(`${where} free`, ex.free.prompt);
      ex.free.checklist?.forEach((c, i) => checkMarkup(`${where} checklist ${i}`, c));
      checkMarkup(`${where} model`, ex.free.model);
    }
  }
}

console.log(problems.join("\n") || `all ${exerciseCount} exercises valid (${manifest.themes.length} themes, ${slangCount} slang terms)`);
process.exit(problems.length ? 1 : 0);
