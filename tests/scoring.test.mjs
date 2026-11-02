import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalize,
  scoreTyped,
  scoreOrder,
  scoreKeywords,
  scoreSimilarity,
  wordSimilarity,
  total,
  shuffle,
  parseMarkup,
  plain,
} from "../assets/scoring.js";

test("normalize strips punctuation and case but keeps å ä ö", () => {
  assert.equal(normalize("  Hej, Åsa!  Är DU där? "), "hej åsa är du där");
});

test("typed answers: exact, diacritic slip, typo, wrong, empty", () => {
  assert.equal(scoreTyped("Röstade", ["röstade"]).points, 1);
  assert.equal(scoreTyped("rostade", ["röstade"]).points, 0.5);
  assert.equal(scoreTyped("röstadd", ["röstade"]).points, 0.5);
  assert.equal(scoreTyped("röst", ["röstade"]).points, 0);
  assert.equal(scoreTyped("", ["röstade"]).points, 0);
  assert.equal(scoreTyped("ta", ["tar"]).points, 0, "no typo allowance for short words");
});

test("word order ignores case and final punctuation only", () => {
  assert.equal(scoreOrder(["På", "tisdag", "röstar", "riksdagen", "igen"], ["På tisdag röstar riksdagen igen."]).points, 1);
  assert.equal(scoreOrder(["På", "tisdag", "riksdagen", "röstar", "igen"], ["På tisdag röstar riksdagen igen."]).points, 0);
});

test("keyword scoring: all, half, too few; multi-word stems", () => {
  const groups = [["sverige"], ["fortfarande", "än"], ["ingen", "inte någon"], ["regering"]];
  assert.equal(scoreKeywords("Sverige har fortfarande ingen regering", groups).points, 1);
  assert.equal(scoreKeywords("Sverige har inte någon regering", groups).points, 0.5);
  assert.equal(scoreKeywords("Hej", groups).points, 0);
  assert.deepEqual(scoreKeywords("Sverige har inte någon regering", groups).missing, ["fortfarande"]);
});

test("similarity thresholds", () => {
  assert.equal(wordSimilarity("talmannen pratar med alla partier", "Talmannen pratar med alla partier."), 1);
  assert.equal(scoreSimilarity("talmannen pratar med partier", "Talmannen pratar med alla partier.").points, 0.5);
  assert.equal(scoreSimilarity("något helt annat", "Talmannen pratar med alla partier.").points, 0);
});

test("total clamps and rounds to halves", () => {
  assert.equal(total([1, 1, 0.5, 0.5]), 3);
  assert.equal(total(Array(12).fill(1)), 10);
  assert.equal(total([0.25]), 0.5);
});

test("shuffle is deterministic per seed and a permutation", () => {
  const a = shuffle([1, 2, 3, 4, 5], 42);
  assert.deepEqual(a, shuffle([1, 2, 3, 4, 5], 42));
  assert.deepEqual(a.slice().sort(), [1, 2, 3, 4, 5]);
});

test("markup parsing and plain text", () => {
  const parts = parseMarkup("Det är [[sjukt|väldigt|slang]] dyrt och [[ordet|förklaring]].");
  assert.equal(parts.filter((p) => p.type === "term").length, 2);
  assert.equal(parts[1].label, "slang");
  assert.equal(parts[3].label, "");
  assert.equal(plain("Det är [[sjukt|väldigt|slang]] dyrt."), "Det är sjukt dyrt.");
});
