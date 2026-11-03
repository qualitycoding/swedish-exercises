import {
  normalize,
  scoreTyped,
  scoreOrder,
  scoreKeywords,
  scoreSimilarity,
  total,
  shuffle,
  parseMarkup,
  plain,
} from "./scoring.js";

const KINDS = ["lasa", "lyssna", "skriva", "tala"];
const KIND_NAMES = {
  lasa: "Läsförståelse",
  lyssna: "Hörförståelse",
  skriva: "Skrivande",
  tala: "Tala",
};
const LABEL_NAMES = { slang: "slang", vardagligt: "vardagligt", idiom: "idiom" };
const STORE_KEY = "svenska-ovningar:v1";
const MAX = 10;

const app = document.getElementById("app");
let themes = [];
let timerHandle = null;

/* ---------- storage ---------- */

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return { scores: data.scores || {}, drafts: data.drafts || {} };
  } catch {
    return { scores: {}, drafts: {} };
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

function recordScore(exId, score) {
  const store = loadStore();
  const prev = store.scores[exId] || { best: 0, last: null, attempts: 0, history: [] };
  const entry = {
    best: Math.max(prev.best, score),
    last: score,
    attempts: prev.attempts + 1,
    history: [...prev.history, { at: new Date().toISOString(), score }].slice(-20),
  };
  store.scores[exId] = entry;
  return { saved: saveStore(store), entry };
}

function saveDraft(exId, text) {
  const store = loadStore();
  store.drafts[exId] = text;
  saveStore(store);
}

/* ---------- helpers ---------- */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** append / replaceChildren that flatten arrays and skip null, undefined and false. */
function kids(list) {
  return list.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
}
function add(el, ...children) {
  el.append(...kids(children));
}
function fill(el, ...children) {
  el.replaceChildren(...kids(children));
}

function exId(themeId, kind) {
  return `${themeId}-${kind}`;
}

function sequence() {
  return themes.flatMap((t) => KINDS.map((k) => ({ theme: t, kind: k })));
}

function fmtScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

function badgeFor(id) {
  const s = loadStore().scores[id];
  if (!s) return h("span", { class: "badge", text: "–/10" });
  const cls = s.best >= MAX ? "badge done" : "badge part";
  return h("span", { class: cls, title: `Bästa ${fmtScore(s.best)}, senast ${fmtScore(s.last)}, ${s.attempts} försök` }, `${fmtScore(s.best)}/10`);
}

/** Render marked-up text: terms get a dotted underline, a register tag and a tap/hover gloss. */
function rich(text) {
  return parseMarkup(text).map((p) => {
    if (p.type === "text") return document.createTextNode(p.text);
    const cls = `term ${p.label || "ord"}`;
    const el = h(
      "span",
      { class: cls, tabindex: "0", "data-gloss": p.gloss, "data-label": p.label || "" },
      p.text,
      p.label ? h("span", { class: `tag ${p.label}`, text: LABEL_NAMES[p.label] || p.label }) : null,
      h("span", { class: "pop", role: "tooltip" }, p.gloss),
    );
    el.addEventListener("click", () => el.classList.toggle("open"));
    return el;
  });
}

function collectTerms(texts) {
  const seen = new Map();
  for (const t of texts) {
    for (const p of parseMarkup(t)) {
      if (p.type === "term" && !seen.has(p.text.toLowerCase())) seen.set(p.text.toLowerCase(), p);
    }
  }
  return [...seen.values()];
}

function glossaryList(terms) {
  if (!terms.length) return null;
  return h(
    "details",
    { class: "card", open: true },
    h("summary", {}, "Ordlista"),
    h(
      "ul",
      { class: "glossary" },
      terms.map((t) =>
        h(
          "li",
          {},
          h("strong", {}, t.text),
          t.label ? h("span", { class: `tag ${t.label}`, text: LABEL_NAMES[t.label] || t.label }) : null,
          " – ",
          t.gloss,
        ),
      ),
    ),
  );
}

function legend() {
  return h(
    "div",
    { class: "legend small" },
    h("span", {}, h("span", { class: "tag slang", text: "slang" }), " slang – informellt, ofta ungt eller gruppbundet"),
    h("span", {}, h("span", { class: "tag vardagligt", text: "vardagligt" }), " vardagligt talspråk"),
    h("span", {}, h("span", { class: "tag idiom", text: "idiom" }), " fast uttryck"),
    h("span", {}, h("span", { class: "tag ord", text: "ord" }), " ordförklaring"),
  );
}

function feedbackBox(points, note, explain) {
  const cls = points >= 1 ? "ok" : points > 0 ? "half" : "bad";
  return h(
    "div",
    { class: `feedback ${cls}`, "data-points": String(points) },
    `${note} (${fmtScore(points)} p)`,
    explain ? h("span", { class: "explain" }, explain) : null,
  );
}

/* ---------- speech ---------- */

const speech = {
  synth: typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null,
  Recognition:
    typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null,
  voice: null,
  rate: 0.9,
};

function pickVoice() {
  if (!speech.synth) return null;
  const voices = speech.synth.getVoices();
  speech.voice =
    voices.find((v) => v.lang === "sv-SE") ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("sv")) ||
    null;
  return speech.voice;
}
if (speech.synth) {
  pickVoice();
  speech.synth.addEventListener?.("voiceschanged", pickVoice);
}

/** Speak text sentence by sentence (long utterances get cut off in some browsers). */
function speak(text, onEnd) {
  if (!speech.synth) {
    onEnd?.();
    return false;
  }
  speech.synth.cancel();
  const chunks = plain(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = "sv-SE";
    if (speech.voice) u.voice = speech.voice;
    u.rate = speech.rate;
    if (i === chunks.length - 1 && onEnd) u.onend = onEnd;
    speech.synth.speak(u);
  });
  return true;
}

function stopSpeaking() {
  speech.synth?.cancel();
}

function rateSelect() {
  const sel = h(
    "select",
    { "aria-label": "Talhastighet", style: "width:auto", onchange: (e) => (speech.rate = Number(e.target.value)) },
    [
      ["0.7", "Långsamt"],
      ["0.9", "Normalt"],
      ["1.05", "Snabbt"],
    ].map(([v, n]) => h("option", { value: v, selected: Number(v) === speech.rate }, n)),
  );
  return sel;
}

function voiceNotice() {
  if (!speech.synth) {
    return h("p", { class: "notice" }, "Din webbläsare saknar talsyntes. Du kan visa manuset i stället (se nedan).");
  }
  if (!pickVoice()) {
    return h(
      "p",
      { class: "notice" },
      "Ingen svensk röst hittades i webbläsaren – uppläsningen kan låta konstigt. På mobilen: installera en svensk röst under inställningar för tal/uppläsning. Du kan också visa manuset.",
    );
  }
  return h("p", { class: "muted small" }, `Röst: ${speech.voice.name} (${speech.voice.lang})`);
}

/** Listen once with the Web Speech API. Resolves with a list of transcript alternatives. */
function listenOnce() {
  return new Promise((resolve, reject) => {
    if (!speech.Recognition) {
      reject(new Error("unsupported"));
      return;
    }
    const rec = new speech.Recognition();
    rec.lang = "sv-SE";
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    let done = false;
    rec.onresult = (e) => {
      done = true;
      const res = e.results[0];
      const alts = [];
      for (let i = 0; i < res.length; i += 1) alts.push(res[i].transcript);
      resolve(alts);
    };
    rec.onerror = (e) => {
      if (!done) {
        done = true;
        reject(new Error(e.error || "error"));
      }
    };
    rec.onend = () => {
      if (!done) {
        done = true;
        resolve([]);
      }
    };
    rec.start();
  });
}

/* ---------- pages ---------- */

function setTitle(t) {
  document.title = t ? `${t} · Svenska på riktigt` : "Svenska på riktigt – övningar om aktuella händelser";
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function renderIndex() {
  setTitle("");
  const store = loadStore();
  const seq = sequence();
  const best = seq.reduce((acc, { theme, kind }) => acc + (store.scores[exId(theme.id, kind)]?.best || 0), 0);
  const done = seq.filter(({ theme, kind }) => store.scores[exId(theme.id, kind)]).length;
  const possible = seq.length * MAX;
  const firstUnfinished = seq.find(({ theme, kind }) => (store.scores[exId(theme.id, kind)]?.best || 0) < MAX);

  fill(app, 
    h("h1", {}, "Svenska på riktigt"),
    h(
      "p",
      { class: "lead" },
      "Läs, lyssna, skriv och tala om aktuella händelser i Sverige. Varje övning tar ungefär tio minuter, ger 0–10 poäng och kan göras om hur många gånger som helst. Dina resultat sparas i den här webbläsaren.",
    ),
    h(
      "div",
      { class: "card summary" },
      h("span", { class: "big", id: "total-best" }, `${fmtScore(best)} / ${possible}`),
      h("span", {}, `bästa poäng totalt · ${done} av ${seq.length} övningar påbörjade`),
      h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: `width:${(100 * best) / possible}%` })),
      firstUnfinished
        ? h(
            "a",
            { class: "btn primary", href: `#/ovning/${firstUnfinished.theme.id}/${firstUnfinished.kind}` },
            done ? "Fortsätt →" : "Börja här →",
          )
        : h("span", {}, "Alla övningar har full pott – snyggt jobbat!"),
    ),
    legend(),
    themes.map((t) =>
      h(
        "section",
        { class: "card theme-card" },
        h("header", {}, h("h2", {}, t.title), h("span", { class: "date" }, `Läget ${t.dateLabel} · nivå ${t.level}`)),
        h("p", { class: "muted", style: "margin:0.3rem 0 0" }, t.summary),
        h(
          "div",
          { class: "ex-links" },
          KINDS.map((k) =>
            h(
              "a",
              { class: "ex-link", href: `#/ovning/${t.id}/${k}`, "data-ex": exId(t.id, k) },
              h("span", {}, KIND_NAMES[k]),
              badgeFor(exId(t.id, k)),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderAbout() {
  setTitle("Om övningarna");
  const store = loadStore();
  const voices = speech.synth ? speech.synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("sv")) : [];
  const importInput = h("input", { type: "file", accept: "application/json", class: "visually-hidden", id: "import-file" });
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data.scores !== "object") throw new Error("format");
      saveStore({ scores: data.scores, drafts: data.drafts || {} });
      alertBox.textContent = "Resultaten är importerade.";
    } catch {
      alertBox.textContent = "Filen kunde inte läsas – är det en export härifrån?";
    }
  });
  const alertBox = h("p", { class: "muted", role: "status" });

  fill(app, 
    h("h1", {}, "Om övningarna"),
    h(
      "div",
      { class: "card" },
      h("h2", { style: "margin-top:0" }, "Så funkar det"),
      h(
        "ul",
        {},
        h("li", {}, h("strong", {}, "Läsförståelse: "), "en nyhetstext med ordlista och tio frågor."),
        h("li", {}, h("strong", {}, "Hörförståelse: "), "webbläsaren läser upp ett radioinslag; åtta frågor och två diktamensmeningar."),
        h("li", {}, h("strong", {}, "Skrivande: "), "böj ord, bygg meningar med rätt ordföljd och översätt. En fri skrivuppgift med modelltext finns som extra (ger inga poäng)."),
        h("li", {}, h("strong", {}, "Tala: "), "läs meningar högt och svara på frågor. Taligenkänningen jämför med målet; utan taligenkänning bedömer du dig själv."),
      ),
      h("p", {}, "Varje fråga ger 1, ½ eller 0 poäng. Halva poäng ges t.ex. när bara å, ä eller ö är fel."),
      legend(),
      h(
        "p",
        { class: "small muted" },
        "Texterna är skrivna för språkinlärning och bygger på nyhetsläget vid angivet datum. Källor finns längst ner i varje läsövning. Läget kan ha ändrats sedan dess.",
      ),
    ),
    h(
      "div",
      { class: "card" },
      h("h2", { style: "margin-top:0" }, "Din webbläsare"),
      h("p", {}, `Talsyntes: ${speech.synth ? "ja" : "nej"} · svenska röster: ${voices.length ? voices.map((v) => v.name).join(", ") : "inga hittade (ännu)"}`),
      h("p", {}, `Taligenkänning: ${speech.Recognition ? "ja (skickar ljud till webbläsarens taltjänst)" : "nej – Tala-övningarna använder självbedömning"}`),
    ),
    h(
      "div",
      { class: "card" },
      h("h2", { style: "margin-top:0" }, "Resultat"),
      h("p", {}, `Sparade resultat: ${Object.keys(store.scores).length} övningar. Resultaten sparas bara i den här webbläsaren – exportera dem om du vill flytta till en annan enhet.`),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              const blob = new Blob([JSON.stringify(loadStore(), null, 2)], { type: "application/json" });
              const a = h("a", { href: URL.createObjectURL(blob), download: "svenska-ovningar-resultat.json" });
              document.add(body, a);
              a.click();
              a.remove();
            },
          },
          "Exportera",
        ),
        h("label", { class: "btn", for: "import-file" }, "Importera"),
        importInput,
        h(
          "button",
          {
            class: "btn",
            onclick: (e) => {
              if (e.target.dataset.confirm !== "1") {
                e.target.dataset.confirm = "1";
                e.target.textContent = "Säker? Klicka igen";
                return;
              }
              saveStore({ scores: {}, drafts: {} });
              renderAbout();
            },
          },
          "Nollställ alla resultat",
        ),
      ),
      alertBox,
    ),
  );
}

function renderExercise(themeId, kind) {
  const theme = themes.find((t) => t.id === themeId);
  const ex = theme?.exercises?.[kind];
  if (!theme || !ex) {
    fill(app, h("h1", {}, "Övningen finns inte"), h("a", { href: "#/" }, "Till startsidan"));
    return;
  }
  const id = exId(themeId, kind);
  setTitle(`${KIND_NAMES[kind]}: ${theme.title}`);
  const seq = sequence();
  const pos = seq.findIndex((s) => s.theme.id === themeId && s.kind === kind);
  const prev = seq[pos - 1];
  const next = seq[pos + 1];
  const seed = Math.floor(Math.random() * 2 ** 31);

  const started = Date.now();
  const timerEl = h("span", { class: "timer", "aria-live": "off" }, "0:00 · mål ca 10 min");
  stopTimer();
  timerHandle = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · mål ca 10 min`;
  }, 1000);

  const pager = () =>
    h(
      "nav",
      { class: "pager", "aria-label": "Bläddra mellan övningar" },
      prev
        ? h("a", { class: "btn small", href: `#/ovning/${prev.theme.id}/${prev.kind}`, "data-nav": "prev" }, `← ${KIND_NAMES[prev.kind]}: ${prev.theme.short}`)
        : h("a", { class: "btn small", href: "#/" }, "← Start"),
      next
        ? h("a", { class: "btn small", href: `#/ovning/${next.theme.id}/${next.kind}`, "data-nav": "next" }, `${KIND_NAMES[next.kind]}: ${next.theme.short} →`)
        : h("a", { class: "btn small", href: "#/" }, "Klart! Till start →"),
    );

  const body = h("div", {});
  const resultBar = h("div", { class: "result", id: "result" });
  const builders = { lasa: buildReading, lyssna: buildListening, skriva: buildWriting, tala: buildSpeaking };
  const items = builders[kind](ex, theme, body, seed, id);

  const store = loadStore();
  const prevScore = store.scores[id];
  const checkBtn = h("button", { class: "btn primary", id: "check" }, "Rätta");
  const status = h("span", {}, prevScore ? `Bästa hittills: ${fmtScore(prevScore.best)}/10 (${prevScore.attempts} försök)` : "Svara på alla frågor och tryck Rätta.");
  add(resultBar, status, checkBtn);

  checkBtn.addEventListener("click", () => {
    stopTimer();
    stopSpeaking();
    const points = items.map((it) => it.check());
    const score = total(points, MAX);
    const { saved, entry } = recordScore(id, score);
    body.querySelectorAll("input, textarea, select, .chip, button.lock").forEach((el) => {
      if (!el.closest(".keep-enabled")) el.disabled = true;
    });
    fill(resultBar, 
      h("span", {}, h("span", { class: "score", id: "score", "data-score": String(score) }, `${fmtScore(score)}/10`), " ", h("span", { class: "muted small" }, `bästa ${fmtScore(entry.best)} · ${entry.attempts} försök${saved ? "" : " · kunde inte spara!"}`)),
      h("span", { class: "row", style: "margin:0" },
        h("button", { class: "btn", id: "retry", onclick: () => renderExercise(themeId, kind) }, "Försök igen"),
        next ? h("a", { class: "btn primary", href: `#/ovning/${next.theme.id}/${next.kind}` }, "Nästa →") : h("a", { class: "btn primary", href: "#/" }, "Till start"),
      ),
    );
    resultBar.scrollIntoView({ block: "nearest" });
  });

  fill(app, 
    pager(),
    h("div", { class: "ex-top" }, h("span", { class: "kind" }, `${KIND_NAMES[kind]} · ${theme.title}`), timerEl),
    h("h1", {}, ex.title),
    ex.intro ? h("p", { class: "lead" }, ex.intro) : null,
    body,
    resultBar,
    pager(),
  );
  window.scrollTo(0, 0);
}

/* ---------- question widgets ---------- */

function mcQuestion(q, n, seed) {
  const name = `q${n}-${seed}`;
  const order = shuffle(q.options.map((_, i) => i), seed + n * 7919);
  const labels = [];
  const box = h("div", { class: "options" });
  for (const i of order) {
    const input = h("input", { type: "radio", name, value: String(i) });
    const label = h("label", { class: "option", "data-correct": i === q.answer ? "1" : "0" }, input, h("span", {}, rich(q.options[i])));
    labels.push(label);
    box.append(label);
  }
  const fb = h("div", {});
  const el = h("div", { class: "q", "data-type": "mc" }, h("p", { class: "prompt" }, h("span", { class: "num" }, `${n}.`), rich(q.q)), box, fb);
  return {
    el,
    check() {
      const chosen = el.querySelector("input:checked");
      const ok = chosen && Number(chosen.value) === q.answer;
      labels.forEach((l) => {
        if (l.dataset.correct === "1") l.classList.add("correct");
        else if (l.contains(chosen)) l.classList.add("wrong");
      });
      fb.replaceChildren(feedbackBox(ok ? 1 : 0, ok ? "Rätt!" : chosen ? "Fel." : "Inget svar.", q.explain));
      return ok ? 1 : 0;
    },
  };
}

function tfQuestion(q, n, seed) {
  const name = `q${n}-${seed}`;
  const mk = (val, text) =>
    h("label", { class: "option", "data-correct": val === q.answer ? "1" : "0" }, h("input", { type: "radio", name, value: String(val) }), text);
  const t = mk(true, "Sant");
  const f = mk(false, "Falskt");
  const fb = h("div", {});
  const el = h("div", { class: "q", "data-type": "tf" }, h("p", { class: "prompt" }, h("span", { class: "num" }, `${n}.`), rich(q.q)), h("div", { class: "tf" }, t, f), fb);
  return {
    el,
    check() {
      const chosen = el.querySelector("input:checked");
      const ok = chosen && (chosen.value === "true") === q.answer;
      [t, f].forEach((l) => {
        if (l.dataset.correct === "1") l.classList.add("correct");
        else if (l.contains(chosen)) l.classList.add("wrong");
      });
      fb.replaceChildren(feedbackBox(ok ? 1 : 0, ok ? "Rätt!" : chosen ? "Fel." : "Inget svar.", q.explain));
      return ok ? 1 : 0;
    },
  };
}

function gapQuestion(q, n) {
  const input = h("input", { type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": `Svar ${n}` });
  const fb = h("div", {});
  const el = h(
    "div",
    { class: "q", "data-type": "gap" },
    h("p", { class: "prompt" }, h("span", { class: "num" }, `${n}.`), rich(q.q)),
    q.hint ? h("p", { class: "hint" }, q.hint) : null,
    input,
    fb,
  );
  return {
    el,
    check() {
      const r = scoreTyped(input.value, q.accept);
      fb.replaceChildren(feedbackBox(r.points, r.note, r.points < 1 ? `Rätt svar: ${q.accept[0]}. ${q.explain || ""}` : q.explain));
      return r.points;
    },
  };
}

function orderQuestion(q, n, seed) {
  const words = q.accept[0].replace(/[.!?]$/, "").split(" ");
  const pool = h("div", { class: "chips" });
  const built = h("div", { class: "chips built", "aria-label": "Din mening" });
  const chosen = [];
  const redraw = () => {
    fill(built,
      chosen.map((c, idx) =>
        h("button", {
          type: "button",
          class: "chip",
          onclick: () => {
            chosen.splice(idx, 1);
            c.btn.disabled = false;
            redraw();
          },
        }, c.word),
      ),
    );
  };
  shuffle(words.map((w, i) => ({ w, i })), seed + n * 104729).forEach(({ w }) => {
    const btn = h("button", { type: "button", class: "chip", "data-word": w }, w);
    btn.addEventListener("click", () => {
      chosen.push({ word: w, btn });
      btn.disabled = true;
      redraw();
    });
    pool.append(btn);
  });
  const fb = h("div", {});
  const el = h(
    "div",
    { class: "q", "data-type": "order" },
    h("p", { class: "prompt" }, h("span", { class: "num" }, `${n}.`), "Bygg meningen: ", h("em", {}, q.en)),
    pool,
    built,
    fb,
  );
  return {
    el,
    check() {
      const r = scoreOrder(chosen.map((c) => c.word), q.accept);
      fb.replaceChildren(feedbackBox(r.points, r.note, r.points < 1 ? `Rätt: ${q.accept[0]} ${q.explain || ""}` : q.explain));
      return r.points;
    },
  };
}

function translateQuestion(q, n) {
  const input = h("textarea", { rows: "2", style: "min-height:4rem", autocapitalize: "sentences", spellcheck: "false", "aria-label": `Översättning ${n}` });
  const fb = h("div", {});
  const el = h(
    "div",
    { class: "q", "data-type": "translate" },
    h("p", { class: "prompt" }, h("span", { class: "num" }, `${n}.`), "Översätt till svenska: ", h("em", {}, q.en)),
    input,
    fb,
  );
  return {
    el,
    check() {
      const r = scoreKeywords(input.value, q.keywords);
      const miss = r.missing.length ? ` Saknas: ${r.missing.join(", ")}.` : "";
      fb.replaceChildren(feedbackBox(r.points, r.note + miss, `Förslag: ${q.model}`));
      return r.points;
    },
  };
}

function dictationQuestion(q, n) {
  const input = h("input", { type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": `Diktamen ${n}` });
  const fb = h("div", {});
  const el = h(
    "div",
    { class: "q", "data-type": "dictation" },
    h("p", { class: "prompt" }, h("span", { class: "num" }, `${n}.`), "Diktamen: lyssna och skriv meningen."),
    h("div", { class: "row keep-enabled" }, h("button", { type: "button", class: "btn small", onclick: () => speak(q.text) }, "▶ Lyssna"), h("button", { type: "button", class: "btn small", onclick: () => { const r = speech.rate; speech.rate = 0.65; speak(q.text); speech.rate = r; } }, "▶ Långsamt")),
    input,
    fb,
  );
  return {
    el,
    check() {
      const r = scoreSimilarity(input.value, q.text);
      fb.replaceChildren(feedbackBox(r.points, `${r.note} ${Math.round(r.sim * 100)} % av orden rätt.`, `Meningen: ${q.text}`));
      return r.points;
    },
  };
}

function questionWidget(q, n, seed) {
  switch (q.type) {
    case "mc":
      return mcQuestion(q, n, seed);
    case "tf":
      return tfQuestion(q, n, seed);
    case "gap":
      return gapQuestion(q, n);
    case "order":
      return orderQuestion(q, n, seed);
    case "translate":
      return translateQuestion(q, n);
    case "dictation":
      return dictationQuestion(q, n);
    case "read":
    case "respond":
      return speakingTask(q, n);
    default:
      throw new Error(`Unknown question type ${q.type}`);
  }
}

/* ---------- exercise builders ---------- */

function sourcesBlock(theme) {
  if (!theme.sources?.length) return null;
  return h(
    "details",
    { class: "card small" },
    h("summary", {}, "Källor och datum"),
    h("p", { class: "muted" }, `Texten är skriven för språkinlärning utifrån nyhetsläget ${theme.dateLabel}. Läget kan ha ändrats.`),
    h("ul", { class: "sources" }, theme.sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.title)))),
  );
}

function buildReading(ex, theme, body, seed) {
  const article = h("article", { class: "card article" }, ex.text.map((p) => h("p", {}, rich(p))));
  const widgets = ex.questions.map((q, i) => questionWidget(q, i + 1, seed));
  add(body, 
    legend(),
    article,
    glossaryList(collectTerms(ex.text)),
    h("section", { class: "card" }, h("h2", { style: "margin-top:0" }, "Frågor"), widgets.map((w) => w.el)),
    sourcesBlock(theme),
  );
  return widgets;
}

function buildListening(ex, theme, body, seed) {
  const script = ex.script.join(" ");
  const playAll = h("button", { type: "button", class: "btn primary", id: "play" }, "▶ Spela upp inslaget");
  playAll.addEventListener("click", () => speak(script));
  const parts = ex.script.map((p, i) => h("button", { type: "button", class: "btn small", onclick: () => speak(p) }, `Del ${i + 1}`));
  const transcript = h(
    "details",
    { class: "card keep-enabled", id: "transcript" },
    h("summary", {}, "Visa manus (först efter att du lyssnat!)"),
    ex.script.map((p) => h("p", { class: "article" }, rich(p))),
    glossaryList(collectTerms(ex.script)),
  );
  const widgets = ex.questions.map((q, i) => questionWidget(q, i + 1, seed));
  add(body, 
    h(
      "section",
      { class: "card keep-enabled" },
      voiceNotice(),
      h("div", { class: "row" }, playAll, h("button", { type: "button", class: "btn", onclick: stopSpeaking }, "■ Stopp"), rateSelect()),
      h("div", { class: "row" }, h("span", { class: "muted small" }, "Lyssna på en del i taget:"), parts),
      ex.vocab?.length
        ? h("p", { class: "small" }, "Bra att kunna: ", ex.vocab.map((v, i) => [i ? " · " : "", rich(v)]))
        : null,
    ),
    h("section", { class: "card" }, h("h2", { style: "margin-top:0" }, "Frågor"), widgets.map((w) => w.el)),
    transcript,
  );
  return widgets;
}

function buildWriting(ex, theme, body, seed, id) {
  const widgets = ex.tasks.map((q, i) => questionWidget(q, i + 1, seed));
  const sections = [];
  let current = null;
  ex.tasks.forEach((q, i) => {
    const heading = { gap: "Böj och fyll i", order: "Ordföljd", translate: "Översätt" }[q.type];
    if (!current || current.type !== q.type) {
      current = { type: q.type, el: h("section", { class: "card" }, h("h2", { style: "margin-top:0" }, heading)) };
      sections.push(current);
    }
    current.el.append(widgets[i].el);
  });
  add(body, legend(), sections.map((s) => s.el));

  if (ex.free) {
    const drafts = loadStore().drafts;
    const ta = h("textarea", { class: "keep-enabled", "aria-label": "Fri skrivning" });
    ta.value = drafts[id] || "";
    const count = h("span", { class: "muted small" });
    const upd = () => {
      const n = normalize(ta.value) ? normalize(ta.value).split(" ").length : 0;
      count.textContent = `${n} ord (mål ${ex.free.words})`;
    };
    ta.addEventListener("input", () => {
      upd();
      saveDraft(id, ta.value);
    });
    upd();
    add(body, 
      h(
        "section",
        { class: "card keep-enabled" },
        h("h2", { style: "margin-top:0" }, "Extra: fri skrivning (inga poäng)"),
        h("p", {}, rich(ex.free.prompt)),
        h("ul", { class: "small" }, ex.free.checklist.map((c) => h("li", {}, rich(c)))),
        ta,
        h("div", { class: "row" }, count, h("span", { class: "muted small" }, "· sparas automatiskt")),
        h("details", {}, h("summary", {}, "Visa modelltext"), h("p", { class: "article" }, rich(ex.free.model))),
      ),
    );
  }
  return widgets;
}

function speakingTask(q, n) {
  const target = q.type === "read" ? plain(q.text) : null;
  let best = 0;
  let tries = 0;
  let selfMode = !speech.Recognition;
  const fb = h("div", {});
  const heard = h("p", { class: "transcript muted small" });
  const recBtn = h("button", { type: "button", class: "btn rec lock" }, "🎤 Tala");
  const selfBox = h("div", { class: "selfscore", hidden: !selfMode });
  const name = `self-${n}-${Math.random().toString(36).slice(2)}`;
  [
    ["0", "Gick inte"],
    ["0.5", "Nästan"],
    ["1", "Bra!"],
  ].forEach(([v, t]) => selfBox.append(h("label", {}, h("input", { type: "radio", name, value: v }), ` ${t}`)));

  const score = (alts) => {
    const results = alts.map((a) =>
      q.type === "read" ? { ...scoreSimilarity(a, target, 0.85, 0.6), text: a } : { ...scoreKeywords(a, q.keywords), text: a },
    );
    return results.sort((a, b) => b.points - a.points)[0];
  };

  recBtn.addEventListener("click", async () => {
    if (tries >= 3) return;
    stopSpeaking();
    recBtn.classList.add("on");
    recBtn.textContent = "Lyssnar…";
    try {
      const alts = await listenOnce();
      tries += 1;
      if (!alts.length) {
        heard.textContent = "Jag hörde ingenting – försök igen.";
      } else {
        const r = score(alts);
        best = Math.max(best, r.points);
        heard.textContent = `Jag hörde: ”${r.text}” → ${fmtScore(r.points)} p (bästa ${fmtScore(best)} p, försök ${tries}/3)`;
      }
    } catch (err) {
      heard.textContent = `Taligenkänningen fungerade inte (${err.message}). Använd självbedömning.`;
      selfMode = true;
      selfBox.hidden = false;
    } finally {
      recBtn.classList.remove("on");
      recBtn.textContent = tries >= 3 ? "Inga fler försök" : "🎤 Tala igen";
      if (tries >= 3) recBtn.disabled = true;
    }
  });

  const toggle = h("button", { type: "button", class: "btn small lock" }, "Bedöm mig själv i stället");
  toggle.addEventListener("click", () => {
    selfMode = true;
    selfBox.hidden = false;
    toggle.hidden = true;
  });

  const el = h(
    "div",
    { class: "q", "data-type": q.type },
    h(
      "p",
      { class: "prompt" },
      h("span", { class: "num" }, `${n}.`),
      q.type === "read" ? ["Läs högt: ", h("strong", {}, rich(q.text))] : ["Svara med en hel mening: ", h("strong", {}, rich(q.q))],
    ),
    q.type === "respond" && q.hint ? h("p", { class: "hint" }, q.hint) : null,
    h(
      "div",
      { class: "row" },
      h("button", { type: "button", class: "btn small keep-enabled", onclick: () => speak(q.type === "read" ? q.text : q.q) }, q.type === "read" ? "▶ Hör förebilden" : "▶ Hör frågan"),
      speech.Recognition ? recBtn : null,
      speech.Recognition ? toggle : null,
    ),
    heard,
    selfBox,
    fb,
  );
  return {
    el,
    check() {
      let pts = best;
      let note = tries ? "Taligenkänning" : "Inte inspelat";
      if (selfMode && best === 0) {
        const chosen = selfBox.querySelector("input:checked");
        pts = chosen ? Number(chosen.value) : 0;
        note = chosen ? "Självbedömning" : "Ingen bedömning";
      }
      const model = q.type === "read" ? null : `Exempel: ${q.model}`;
      fb.replaceChildren(feedbackBox(pts, note, model));
      return pts;
    },
  };
}

function buildSpeaking(ex, theme, body, seed) {
  const widgets = ex.tasks.map((q, i) => questionWidget(q, i + 1, seed));
  add(body, 
    h(
      "section",
      { class: "card" },
      speech.Recognition
        ? h("p", { class: "notice" }, "Tryck 🎤 och tala tydligt. Du har tre försök per uppgift; det bästa räknas. Webbläsaren frågar om lov att använda mikrofonen. Funkar inte igenkänningen kan du bedöma dig själv.")
        : h("p", { class: "notice" }, "Din webbläsare saknar taligenkänning (prova Chrome, Edge eller Safari). Lyssna på förebilden, säg meningen högt och bedöm dig själv ärligt."),
      h("div", { class: "row keep-enabled" }, h("span", { class: "muted small" }, "Uppläsningens hastighet:"), rateSelect()),
      legend(),
    ),
    h("section", { class: "card" }, h("h2", { style: "margin-top:0" }, "Uppgifter"), widgets.map((w) => w.el)),
  );
  return widgets;
}

/* ---------- router ---------- */

function route() {
  stopTimer();
  stopSpeaking();
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "ovning" && parts.length === 3) renderExercise(parts[1], parts[2]);
  else if (parts[0] === "om") renderAbout();
  else renderIndex();
  document.documentElement.dataset.route = location.hash || "#/";
}

/** Fetch JSON, bypassing stale caches, and say exactly what came back when it is not JSON. */
async function fetchJson(path) {
  const url = new URL(path, document.baseURI).href;
  let res;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch (err) {
    throw new Error(`${url}: nätverksfel (${err.message})`);
  }
  const text = await res.text();
  try {
    if (!res.ok) throw new Error("status");
    return JSON.parse(text);
  } catch {
    const start = text.replace(/\s+/g, " ").trim().slice(0, 80);
    throw new Error(`${url}: HTTP ${res.status}, ${res.headers.get("content-type") || "okänd typ"}, började med ”${start}”`);
  }
}

async function boot() {
  try {
    const manifest = await fetchJson("data/manifest.json");
    themes = await Promise.all(manifest.themes.map((f) => fetchJson(`data/${f}`)));
  } catch (err) {
    fill(
      app,
      h("h1", {}, "Kunde inte ladda övningarna"),
      h("p", { id: "load-error" }, err.message),
      h("p", {}, "Ladda om sidan (Ctrl+Shift+R / Cmd+Shift+R). Om felet finns kvar: öppna adressen ovan direkt – visar den en varnings- eller inloggningssida kan ett nätverksfilter (t.ex. på jobbet) blockera JSON-filer."),
    );
    document.documentElement.dataset.ready = "error";
    return;
  }
  window.addEventListener("hashchange", route);
  route();
  document.documentElement.dataset.ready = "1";
}

boot();
