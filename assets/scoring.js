// Pure scoring helpers. No DOM access, so they run in the browser and under node --test.

const PUNCT = /[.,!?;:"'”“„«»()\[\]{}…–—\-]/g;

/** Lower-case, strip punctuation, collapse whitespace. Keeps å, ä, ö. */
export function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Like normalize, but also folds å/ä→a, ö→o, é→e: used to spot diacritic-only slips. */
export function fold(text) {
  return normalize(text)
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[éè]/g, "e")
    .replace(/ü/g, "u");
}

export function tokens(text) {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

/** Classic Levenshtein distance over any two sequences (strings or arrays). */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Word-level similarity in [0, 1]: 1 - wordEditDistance / max(wordCount). */
export function wordSimilarity(heard, target) {
  const h = tokens(heard);
  const t = tokens(target);
  if (t.length === 0) return h.length === 0 ? 1 : 0;
  return Math.max(0, 1 - levenshtein(h, t) / Math.max(h.length, t.length));
}

/**
 * Score a typed short answer against accepted alternatives.
 * 1 = exact (after normalisation); 0.5 = only å/ä/ö differ, or one typo in a word of 6+ letters; 0 otherwise.
 */
export function scoreTyped(input, accepted) {
  const given = normalize(input);
  if (!given) return { points: 0, note: "Inget svar." };
  const list = accepted.map(normalize);
  if (list.includes(given)) return { points: 1, note: "Rätt!" };
  if (list.some((a) => fold(a) === fold(given))) {
    return { points: 0.5, note: "Nästan – kolla å, ä och ö." };
  }
  if (list.some((a) => a.length >= 6 && levenshtein(a, given) === 1)) {
    return { points: 0.5, note: "Nästan – ett stavfel." };
  }
  return { points: 0, note: "Inte riktigt." };
}

/** Word-order task: the built sentence must equal one accepted order (punctuation and case ignored). */
export function scoreOrder(builtWords, accepted) {
  const built = normalize(builtWords.join(" "));
  return accepted.map(normalize).includes(built)
    ? { points: 1, note: "Rätt ordföljd!" }
    : { points: 0, note: "Fel ordföljd." };
}

/**
 * Keyword task (translations, spoken answers). Each keyword group is a list of acceptable stems;
 * a group matches when any word of the answer starts with one of its stems (diacritics strict).
 * All groups → 1, at least half → 0.5, else 0.
 */
export function scoreKeywords(answer, groups) {
  const words = tokens(answer);
  const joined = ` ${words.join(" ")} `;
  const hit = groups.map((stems) =>
    stems.some((stem) => {
      const s = normalize(stem);
      return s.includes(" ") ? joined.includes(` ${s}`) : words.some((w) => w.startsWith(s));
    }),
  );
  const found = hit.filter(Boolean).length;
  const missing = groups.filter((_, i) => !hit[i]).map((g) => g[0]);
  if (found === groups.length) return { points: 1, note: "Alla nyckelord finns med!", missing };
  if (found * 2 >= groups.length) return { points: 0.5, note: "Delvis rätt.", missing };
  return { points: 0, note: "För många nyckelord saknas.", missing };
}

/** Dictation / read-aloud: ≥ 0.9 word similarity → 1, ≥ 0.7 → 0.5, else 0. */
export function scoreSimilarity(heard, target, full = 0.9, half = 0.7) {
  const sim = wordSimilarity(heard, target);
  if (sim >= full) return { points: 1, sim, note: "Mycket bra!" };
  if (sim >= half) return { points: 0.5, sim, note: "Nästan." };
  return { points: 0, sim, note: "Försök igen." };
}

/** Sum points and clamp to [0, max], rounding to the nearest half point. */
export function total(pointsList, max = 10) {
  const sum = pointsList.reduce((acc, p) => acc + p, 0);
  return Math.min(max, Math.max(0, Math.round(sum * 2) / 2));
}

/** Deterministic Fisher–Yates shuffle driven by a numeric seed (mulberry32). */
export function shuffle(items, seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Inline markup for glossed words: [[shown text|gloss|label]] where label is
 * "slang", "vardagligt", "idiom" or empty. Returns a list of text / term parts.
 */
export function parseMarkup(text) {
  const parts = [];
  const re = /\[\[([^|\]]+)\|([^|\]]+)(?:\|([^\]]*))?\]\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", text: text.slice(last, m.index) });
    parts.push({ type: "term", text: m[1], gloss: m[2], label: (m[3] || "").trim() });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

/** Plain text of marked-up text (used for speech synthesis and dictation targets). */
export function plain(text) {
  return parseMarkup(text)
    .map((p) => p.text)
    .join("");
}
