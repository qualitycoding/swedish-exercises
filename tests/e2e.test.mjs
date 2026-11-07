// End-to-end tests in headless Chromium: every exercise reaches 10/10 with correct answers,
// wrong answers score low, scores persist across reloads, retry works, and navigation clicks through.
// Run: node --test tests/*.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serve } from "./server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "data/manifest.json"), "utf8"));
const themes = manifest.themes.map((f) => JSON.parse(readFileSync(join(root, "data", f), "utf8")));
const KINDS = ["lasa", "lyssna", "skriva", "tala"];

// Fake Web Speech API: synthesis is a no-op; recognition "hears" whatever window.__say holds.
const SPEECH_MOCK = `
  window.__spoken = [];
  class FakeUtterance { constructor(t){ this.text = t; } }
  window.SpeechSynthesisUtterance = FakeUtterance;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    getVoices: () => [{ name: "Teströst", lang: "sv-SE" }],
    speak: (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
    cancel: () => {}, addEventListener: () => {},
  }});
  class FakeRecognition {
    start() { setTimeout(() => {
      const say = window.__say || "";
      const alt = [{ transcript: say, confidence: 0.9 }];
      this.onresult && this.onresult({ results: [alt] });
      this.onend && this.onend();
    }, 5); }
    stop() {}
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
`;
const NO_RECOGNITION = `delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
  Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });`;

let browser;
let srv;
before(async () => {
  srv = await serve(root);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  srv?.server.close();
});

async function newPage(init = SPEECH_MOCK) {
  const context = await browser.newContext();
  await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return { context, page, errors };
}

async function open(page, hash) {
  await page.goto(`${srv.url}#${hash}`);
  await page.waitForSelector("html[data-ready='1']");
}

/** Answer every item of the current exercise correctly (or deliberately wrong). */
async function answerAll(page, ex, kind, { wrong = false } = {}) {
  const items = kind === "skriva" || kind === "tala" ? ex.tasks : ex.questions;
  const qs = page.locator("#app .q");
  assert.equal(await qs.count(), items.length, "rendered item count");
  for (let i = 0; i < items.length; i += 1) {
    const q = items[i];
    const el = qs.nth(i);
    switch (q.type) {
      case "mc":
      case "tf":
        await el.locator(`label.option[data-correct='${wrong ? "0" : "1"}']`).first().click();
        break;
      case "gap":
        await el.locator("input").fill(wrong ? "xyz" : q.accept[0]);
        break;
      case "dictation":
        await el.locator("input").fill(wrong ? "helt fel mening här" : q.text);
        break;
      case "translate":
        await el.locator("textarea").fill(wrong ? "jag vet inte" : q.model);
        break;
      case "order": {
        const words = q.accept[0].replace(/[.!?]$/, "").split(" ");
        const seq = wrong ? words.slice().reverse() : words;
        for (const w of seq) await el.locator(".chips:not(.built) .chip:not([disabled])", { hasText: w }).filter({ hasText: new RegExp(`^${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }).first().click();
        break;
      }
      case "read":
      case "respond": {
        const say = wrong ? "banan" : q.type === "read" ? q.text.replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, "$1") : q.model;
        await page.evaluate((s) => (window.__say = s), say);
        await el.locator("button.rec").click();
        await el.locator(".transcript", { hasText: "Jag hörde" }).waitFor();
        break;
      }
      default:
        throw new Error(q.type);
    }
  }
  await page.click("#check");
  return Number(await page.locator("#score").getAttribute("data-score"));
}

test("index lists every theme with four exercise links", async () => {
  const { page, errors, context } = await newPage();
  await open(page, "/");
  for (const t of themes) {
    for (const k of KINDS) assert.equal(await page.locator(`a[data-ex='${t.id}-${k}']`).count(), 1, `${t.id}-${k} link`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

for (const t of themes) {
  for (const kind of KINDS) {
    test(`${t.id}/${kind}: correct answers score 10, wrong answers score ≤ 2`, async () => {
      const { page, errors, context } = await newPage();
      await open(page, `/ovning/${t.id}/${kind}`);
      assert.equal(await answerAll(page, t.exercises[kind], kind), 10);
      await page.click("#retry");
      assert.equal(await page.locator("#score").count(), 0, "retry clears the score");
      const low = await answerAll(page, t.exercises[kind], kind, { wrong: true });
      assert.ok(low <= 2, `wrong answers scored ${low}`);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("svenska-ovningar:v1")));
      const s = stored.scores[`${t.id}-${kind}`];
      assert.equal(s.best, 10);
      assert.equal(s.attempts, 2);
      assert.equal(s.last, low);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
}

test("scores persist across visits and show on the index", async () => {
  const { page, context } = await newPage();
  const t = themes[0];
  await open(page, `/ovning/${t.id}/lasa`);
  await answerAll(page, t.exercises.lasa, "lasa");
  await page.goto(srv.url);
  await page.reload();
  await page.waitForSelector("html[data-ready='1']");
  await page.locator(`a[data-ex='${t.id}-lasa'] .badge.done`, { hasText: "10/10" }).waitFor();
  assert.match(await page.locator("#total-best").textContent(), /^10 \//);
  await context.close();
});

test("next/previous links click through every exercise in order", async () => {
  const { page, context } = await newPage();
  await open(page, `/ovning/${themes[0].id}/lasa`);
  const order = themes.flatMap((t) => KINDS.map((k) => `#/ovning/${t.id}/${k}`));
  for (const hash of order.slice(1)) {
    await page.locator("a[data-nav='next']").first().click();
    await page.waitForFunction((h) => document.documentElement.dataset.route === h, hash);
  }
  const t = themes.at(-1);
  assert.match(page.url(), new RegExp(`#/ovning/${t.id}/tala$`));
  assert.equal(await page.locator("a[data-nav='next']").count(), 0);
  await page.locator("a[data-nav='prev']").first().click();
  await page.waitForFunction((h) => document.documentElement.dataset.route === h, `#/ovning/${t.id}/skriva`);
  await context.close();
});

test("speaking without speech recognition falls back to self-assessment", async () => {
  const { page, context, errors } = await newPage(SPEECH_MOCK + NO_RECOGNITION);
  const t = themes[0];
  await open(page, `/ovning/${t.id}/tala`);
  assert.equal(await page.locator("button.rec").count(), 0);
  const qs = page.locator("#app .q");
  for (let i = 0; i < 10; i += 1) await qs.nth(i).locator("input[value='1']").check();
  await page.click("#check");
  assert.equal(await page.locator("#score").getAttribute("data-score"), "10");
  assert.deepEqual(errors, []);
  await context.close();
});

test("a diacritic slip earns half a point", async () => {
  const { page, context } = await newPage();
  const t = themes[0];
  const gaps = t.exercises.skriva.tasks.map((q, i) => ({ q, i })).filter(({ q }) => q.type === "gap");
  const slip = gaps.find(({ q }) => /[åäö]/.test(q.accept[0]));
  assert.ok(slip, "theme has a gap answer with å/ä/ö");
  await open(page, `/ovning/${t.id}/skriva`);
  const folded = slip.q.accept[0].replace(/[åä]/g, "a").replace(/ö/g, "o");
  await page.locator("#app .q").nth(slip.i).locator("input").fill(folded);
  await page.click("#check");
  assert.equal(await page.locator("#app .q").nth(slip.i).locator(".feedback").getAttribute("data-points"), "0.5");
  await context.close();
});

test("listening plays the script through speech synthesis", async () => {
  const { page, context } = await newPage();
  const t = themes[0];
  await open(page, `/ovning/${t.id}/lyssna`);
  await page.click("#play");
  const spoken = await page.evaluate(() => window.__spoken);
  assert.ok(spoken.length >= t.exercises.lyssna.script.length, "script split into sentence utterances");
  assert.ok(spoken.every((s) => !s.includes("[[")), "markup is not read aloud");
  await context.close();
});

test("a data file served as HTML gives a diagnostic naming the URL and status", async () => {
  const { page, context } = await newPage();
  await page.route("**/data/manifest.json", (r) => r.fulfill({ status: 404, contentType: "text/html", body: "<!DOCTYPE html><html>Not found</html>" }));
  await page.goto(srv.url);
  await page.waitForSelector("html[data-ready='error']");
  const msg = await page.locator("#load-error").textContent();
  assert.match(msg, /data\/manifest\.json: HTTP 404, text\/html/);
  await context.close();
});

test("word explanations close on a second tap, a tap elsewhere and Escape; only one is open", async () => {
  const { page, context } = await newPage();
  await open(page, `/ovning/${themes[0].id}/lasa`);
  const terms = page.locator("article .term");
  const first = terms.nth(0);
  const second = terms.last();
  const pop = (t) => t.locator(".pop");
  await first.click();
  assert.ok(await pop(first).isVisible(), "opens on tap");
  await first.click();
  assert.ok(!(await pop(first).isVisible()), "second tap closes it although the term keeps focus");
  await first.click();
  await second.click();
  assert.ok(!(await pop(first).isVisible()) && (await pop(second).isVisible()), "only one open");
  await page.locator("h1").click();
  assert.ok(!(await pop(second).isVisible()), "tap elsewhere closes");
  await second.click();
  await page.keyboard.press("Escape");
  assert.ok(!(await pop(second).isVisible()), "Escape closes");
  await context.close();
});

test("on a touch phone a tapped explanation does not stay open after tapping elsewhere", async () => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  await context.addInitScript(SPEECH_MOCK);
  const page = await context.newPage();
  await open(page, `/ovning/${themes[0].id}/lasa`);
  const term = page.locator("article .term").first();
  await term.tap();
  assert.ok(await term.locator(".pop").isVisible());
  await page.locator("h1").tap();
  assert.ok(!(await term.locator(".pop").isVisible()));
  await context.close();
});

test("no page shows stringified objects, undefined or null", async () => {
  const { page, context } = await newPage();
  const hashes = ["/", "/om", ...themes.flatMap((t) => KINDS.map((k) => `/ovning/${t.id}/${k}`))];
  for (const hash of hashes) {
    await page.goto(`${srv.url}#${hash}`);
    await page.waitForFunction((h) => document.documentElement.dataset.route === h, `#${hash}`);
    const text = await page.locator("#app").evaluate((el) => el.textContent);
    assert.doesNotMatch(text, /\[object |\bundefined\b|(^|[^a-zåäö])null([^a-zåäö]|$)/i, `${hash} shows a stringified value`);
  }
  await context.close();
});
