import * as webllm from "https://esm.run/@mlc-ai/web-llm@0.2.84";

const $ = (id) => document.getElementById(id);
const ui = {
  checks: $("checks"), model: $("model"), modelInfo: $("modelInfo"), load: $("load"), unload: $("unload"),
  progressBox: $("progressBox"), bar: $("bar"), progressText: $("progressText"),
  log: $("log"), prompt: $("prompt"), send: $("send"), stop: $("stop"), clear: $("clear"), stats: $("stats"),
  examples: $("examples"), previewCard: $("previewCard"), preview: $("preview"), rerun: $("rerun"), copy: $("copy"),
};

// Kuratoitu lista: pienestä isoon. Pääte valitaan sen mukaan, tukeeko näytönohjain f16-varjostimia.
const WEBLLM_MODELS = [
  ["Qwen3-0.6B", "Pienin, nopea kokeilu"],
  ["Llama-3.2-1B-Instruct", "Yleismalli"],
  ["Qwen2.5-Coder-1.5B-Instruct", "Koodimalli, pieni"],
  ["Qwen3-1.7B", "Yleismalli"],
  ["Qwen2.5-Coder-3B-Instruct", "Koodimalli"],
  ["Phi-3.5-mini-instruct", "Yleismalli, 3.8B"],
  ["Qwen3-4B", "Yleismalli"],
  ["Qwen2.5-Coder-7B-Instruct", "Paras koodiin, raskas"],
];
const BUILTIN = "chrome-builtin";
const MOBILE = navigator.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
// Puhelimessa näytönohjain jakaa muistin muun järjestelmän kanssa: pienempi konteksti = pienempi KV-välimuisti.
const MOBILE_CONTEXT = 2048;
// Näin WebGPU kertoo, että laite hävisi alta (yleensä muisti loppui) — malli on silloin käyttökelvoton.
const GPU_LOST = /unmapped|device (was )?lost|mapAsync|GPUBuffer|out of memory|OOM|DXGI|instance reference/i;

const MODES = {
  chat: {
    system: "You are a helpful assistant. Answer in the user's language. Be concise.",
    placeholder: "Kirjoita viesti… (Ctrl+Enter lähettää)",
    examples: ["Kerro lyhyesti mikä on WebGPU.", "Kirjoita haiku JavaScriptistä.", "Selitä closure esimerkillä."],
  },
  game: {
    system: [
      "You write small, complete browser games.",
      "Reply with exactly ONE complete HTML document inside a single ```html code block.",
      "Put all CSS and JavaScript inline. Do not load any external files, fonts or libraries.",
      "Draw with a <canvas> that fills the window, and support both keyboard and touch input.",
      "Keep the whole file under 200 lines. After the code block, write at most two short sentences.",
      "When the user asks for a change, reply with the whole updated file again.",
    ].join(" "),
    placeholder: "Kuvaile peli tai pyydä muutosta… (Ctrl+Enter lähettää)",
    examples: ["Snake-peli nuolinäppäimillä", "Pong tietokonetta vastaan", "Tee pallosta nopeampi ja lisää pisteet"],
  },
};

const state = {
  gpu: null, f16: false, builtin: "unavailable",
  engine: null, session: null, kind: null, modelId: null,
  mode: "chat", history: [], busy: false, lastHtml: "",
};

// ---------- ympäristö ----------

function check(cls, text, small) {
  const li = document.createElement("li");
  li.className = cls;
  const dot = document.createElement("span");
  dot.className = "dot";
  li.append(dot, text);
  if (small) { const s = document.createElement("small"); s.textContent = " " + small; li.append(s); }
  return li;
}

async function detect() {
  const items = [];
  if (!("gpu" in navigator)) {
    items.push(check("bad", "WebGPU puuttuu", "— WebLLM ei toimi tässä selaimessa. Kokeile Chromea, Edgeä tai uutta Safaria."));
  } else {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("no adapter");
      state.gpu = adapter;
      state.f16 = adapter.features.has("shader-f16");
      const info = adapter.info || {};
      const name = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || "tuntematon";
      items.push(check("ok", "WebGPU käytössä", `— ${name}`));
      items.push(state.f16
        ? check("ok", "shader-f16 tuettu", "— käytetään q4f16-malleja (pienempi lataus)")
        : check("warn", "shader-f16 ei tuettu", "— käytetään q4f32-malleja (isompi lataus)"));
      const maxBuf = adapter.limits?.maxBufferSize;
      if (maxBuf) items.push(check("ok", "Suurin puskuri", `— ${(maxBuf / 2 ** 20).toFixed(0)} Mt`));
    } catch {
      items.push(check("bad", "WebGPU-adapteria ei saatu", "— kehys tai selain voi estää sen."));
    }
  }
  if (navigator.deviceMemory) items.push(check("ok", "Muistia laitteessa", `— vähintään ${navigator.deviceMemory} Gt`));

  if ("LanguageModel" in self) {
    try {
      state.builtin = await LanguageModel.availability();
    } catch {
      state.builtin = "blocked";
    }
    const text = {
      available: ["ok", "Chromen sisäänrakennettu AI valmiina", "— Gemini Nano"],
      downloadable: ["warn", "Chromen sisäänrakennettu AI ladattavissa", "— lataus alkaa kun valitset sen"],
      downloading: ["warn", "Chromen sisäänrakennettu AI latautuu", ""],
      unavailable: ["bad", "Chromen sisäänrakennettu AI ei käytettävissä", "— laite ei täytä vaatimuksia"],
      blocked: ["bad", "Chromen sisäänrakennettu AI estetty", "— todennäköisesti kehyksen oikeudet (Permissions-Policy)"],
    }[state.builtin] || ["warn", "Chromen sisäänrakennettu AI", `— tila: ${state.builtin}`];
    items.push(check(...text));
  } else {
    items.push(check("warn", "Chromen sisäänrakennettu AI (Prompt API) puuttuu", "— vain uusi työpöytä-Chrome"));
  }
  ui.checks.replaceChildren(...items);
}

// ---------- mallit ----------

function recordFor(base) {
  const suffix = state.f16 ? "q4f16_1-MLC" : "q4f32_1-MLC";
  const id = `${base}-${suffix}`;
  return webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
}

// Välimuistikysely voi jumittaa (esim. kun selain ei anna Cache API:a), joten se ei saa pidätellä listaa.
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(false), ms))]);
function markCached(opts) {
  for (const o of opts) {
    if (o.value === BUILTIN || !o.value) continue;
    withTimeout(webllm.hasModelInCache(o.value), 3000)
      .then((yes) => { if (yes && !o.text.endsWith("✓")) o.text += " · ladattu ✓"; })
      .catch(() => {});
  }
}

async function fillModels() {
  const opts = [];
  if (state.gpu) {
    for (const [base, note] of WEBLLM_MODELS) {
      const rec = recordFor(base);
      if (!rec) continue;
      const mb = rec.vram_required_MB ? ` · muistia ~${(rec.vram_required_MB / 1024).toFixed(1)} Gt` : "";
      opts.push(new Option(`WebLLM · ${base} — ${note}${mb}`, rec.model_id));
    }
  }
  if (state.builtin !== "unavailable" && state.builtin !== "blocked" && "LanguageModel" in self) {
    opts.push(new Option("Chrome · Gemini Nano (sisäänrakennettu)", BUILTIN));
  }
  if (!opts.length) opts.push(new Option("Ei käytettävissä olevia malleja tässä selaimessa", ""));
  ui.model.replaceChildren(...opts);
  markCached(opts);
  // Oletukseksi pieni koodimalli: kelpaa molempiin tiloihin eikä lataus ole kohtuuton.
  // Puhelimessa muisti loppuu nopeammin, joten siellä aloitetaan pienimmästä.
  const pick = opts.find((o) => o.value.startsWith(MOBILE ? "Llama-3.2-1B" : "Qwen2.5-Coder-1.5B"));
  if (pick) ui.model.value = pick.value;
  ui.load.disabled = !ui.model.value;
  describeModel();
}

function describeModel() {
  const id = ui.model.value;
  if (!id) { ui.modelInfo.textContent = ""; return; }
  if (id === BUILTIN) {
    ui.modelInfo.textContent = "Chrome lataa mallin kerran ja jakaa sen kaikille sivuille. Ei sovi isoon koodiin, mutta on nopea.";
    return;
  }
  const rec = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === id);
  const ctx = MOBILE ? MOBILE_CONTEXT : rec?.overrides?.context_window_size;
  ui.modelInfo.textContent = `${id}${ctx ? ` · konteksti ${ctx} tokenia` : ""}. Ensimmäinen lataus voi kestää minuutteja; sen jälkeen malli on selaimen välimuistissa.`;
}

async function loadModel() {
  const id = ui.model.value;
  if (!id) return;
  await unloadModel();
  setBusy(true);
  ui.progressBox.hidden = false;
  progress(0, "Aloitetaan…");
  try {
    if (id === BUILTIN) {
      state.session = await createBuiltinSession();
      state.kind = "builtin";
    } else {
      const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      state.engine = await webllm.CreateWebWorkerMLCEngine(worker, id, {
        initProgressCallback: (r) => progress(r.progress, r.text),
      }, MOBILE ? { context_window_size: MOBILE_CONTEXT } : undefined);
      state.kind = "webllm";
    }
    state.modelId = id;
    progress(1, "Valmis.");
    ui.unload.hidden = false;
    fillModels().then(() => { ui.model.value = id; });
  } catch (err) {
    progress(0, "Lataus epäonnistui: " + (err?.message || err));
    state.kind = null;
  } finally {
    setBusy(false);
  }
}

async function createBuiltinSession() {
  return LanguageModel.create({
    initialPrompts: [{ role: "system", content: MODES[state.mode].system }],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => progress(e.loaded, `Ladataan Gemini Nanoa… ${(e.loaded * 100).toFixed(0)} %`));
    },
  });
}

async function unloadModel() {
  try { await state.engine?.unload(); } catch {}
  try { state.session?.destroy(); } catch {}
  state.engine = state.session = state.kind = state.modelId = null;
  ui.unload.hidden = true;
  setBusy(false);
}

function progress(p, text) {
  ui.bar.style.width = `${Math.round((p || 0) * 100)}%`;
  ui.progressText.textContent = text || "";
}

// ---------- viestit ----------

// Mallin teksti piirretään DOM-solmuina, ei innerHTML:nä: se on mallin keksimää.
function renderText(el, text) {
  el.replaceChildren();
  let rest = text;
  const think = rest.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (think) {
    const t = document.createElement("div");
    t.className = "think";
    t.textContent = think[1].trim() || "…";
    el.append(t);
    rest = rest.slice(think[0].length);
  }
  const parts = rest.split(/```[a-zA-Z]*\n?/);
  parts.forEach((p, i) => {
    if (!p) return;
    if (i % 2) { const pre = document.createElement("pre"); pre.textContent = p; el.append(pre); }
    else el.append(p.replace(/^\n+|\n+$/g, ""));
  });
}

function addMsg(role, text = "") {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  renderText(el, text);
  ui.log.append(el);
  ui.log.scrollTop = ui.log.scrollHeight;
  return el;
}

function extractHtml(text) {
  const blocks = [...text.matchAll(/```(?:html)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fromBlock = blocks.reverse().find((b) => /<html|<body|<canvas|<script/i.test(b));
  if (fromBlock) return fromBlock.trim();
  const doc = text.match(/<!doctype html[\s\S]*<\/html>/i) || text.match(/<html[\s\S]*<\/html>/i);
  return doc ? doc[0] : "";
}

function showPreview(html) {
  if (!html) return;
  state.lastHtml = html;
  ui.previewCard.hidden = false;
  ui.preview.srcdoc = html;
}

function messagesFor(text) {
  const sys = { role: "system", content: MODES[state.mode].system };
  if (state.mode === "game") {
    // Pieni konteksti: lähetetään vain edellinen versio ja uusi pyyntö, ei koko historiaa.
    const prev = state.lastHtml ? [{ role: "assistant", content: "```html\n" + state.lastHtml + "\n```" }] : [];
    return [sys, ...prev, { role: "user", content: text }];
  }
  return [sys, ...state.history, { role: "user", content: text }];
}

async function send() {
  const text = ui.prompt.value.trim();
  if (!text || state.busy || !state.kind) return;
  ui.prompt.value = "";
  addMsg("user", text);
  const out = addMsg("ai", "…");
  setBusy(true, true);
  const t0 = performance.now();
  let first = 0, reply = "", tokens = 0;
  const tick = () => {
    const now = performance.now();
    const gen = (now - (first || now)) / 1000;
    const tps = gen > 0 && tokens ? (tokens / gen).toFixed(1) : "–";
    ui.stats.textContent = `ensimmäinen ${first ? ((first - t0) / 1000).toFixed(1) : "–"} s · ${tokens} tok · ${tps} tok/s`;
  };
  try {
    if (state.kind === "webllm") {
      const thinking = state.modelId.startsWith("Qwen3") ? { extra_body: { enable_thinking: false } } : {};
      const stream = await state.engine.chat.completions.create({
        messages: messagesFor(text), stream: true, stream_options: { include_usage: true },
        temperature: state.mode === "game" ? 0.4 : 0.7, max_tokens: state.mode === "game" ? 3000 : 800, ...thinking,
      });
      for await (const chunk of stream) {
        const d = chunk.choices?.[0]?.delta?.content;
        if (d) { if (!first) first = performance.now(); reply += d; tokens++; renderText(out, reply); tick(); }
        if (chunk.usage) tokens = chunk.usage.completion_tokens;
      }
    } else {
      state.abort = new AbortController();
      // Gemini Nanon istunto muistaa historian itse; pelitilassa liitetään edellinen versio pyyntöön.
      const ask = state.mode === "game" && state.lastHtml
        ? `Current game:\n\`\`\`html\n${state.lastHtml}\n\`\`\`\n\n${text}` : text;
      for await (const d of state.session.promptStreaming(ask, { signal: state.abort.signal })) {
        if (!first) first = performance.now();
        reply += d; tokens += Math.max(1, Math.round(d.length / 4));
        renderText(out, reply); tick();
      }
    }
    tick();
    state.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
    if (state.mode === "game") {
      const html = extractHtml(reply);
      if (html) showPreview(html);
      else addMsg("err", "Vastauksesta ei löytynyt HTML-tiedostoa. Pyydä uudelleen tai kokeile isompaa mallia.");
    }
  } catch (err) {
    const m = String(err?.message || err);
    if (GPU_LOST.test(m)) {
      addMsg("err", `Näytönohjain keskeytti laskennan (${m}). Yleensä muisti loppui. ` +
        "Malli vapautettiin — lataa se uudelleen tai valitse pienempi, esim. Llama-3.2-1B.");
      await unloadModel();
      progress(0, "Malli vapautettu GPU-virheen jälkeen.");
    } else if (err?.name !== "AbortError") addMsg("err", "Virhe: " + m);
  } finally {
    setBusy(false);
    ui.log.scrollTop = ui.log.scrollHeight;
  }
}

async function stop() {
  try { await state.engine?.interruptGenerate(); } catch {}
  state.abort?.abort();
}

async function clearChat() {
  state.history = [];
  state.lastHtml = "";
  ui.log.replaceChildren();
  ui.stats.textContent = "";
  ui.previewCard.hidden = true;
  ui.preview.srcdoc = "";
  try { await state.engine?.resetChat(); } catch {}
  if (state.kind === "builtin") {
    try { state.session.destroy(); } catch {}
    state.session = await createBuiltinSession();
  }
}

function setBusy(busy, generating = false) {
  state.busy = busy;
  const ready = !!state.kind && !busy;
  ui.prompt.disabled = !ready;
  ui.send.disabled = !ready;
  ui.load.disabled = busy || !ui.model.value;
  ui.model.disabled = busy;
  ui.stop.hidden = !generating;
  if (ready) ui.prompt.focus();
}

function setMode(mode) {
  state.mode = mode;
  for (const t of document.querySelectorAll(".tab")) {
    const on = t.dataset.mode === mode;
    t.classList.toggle("on", on);
    t.setAttribute("aria-selected", String(on));
  }
  ui.prompt.placeholder = MODES[mode].placeholder;
  ui.examples.replaceChildren(...MODES[mode].examples.map((ex) => {
    const b = document.createElement("button");
    b.textContent = ex;
    b.onclick = () => { ui.prompt.value = ex; ui.prompt.focus(); };
    return b;
  }));
  clearChat();
}

// ---------- kytkennät ----------

ui.model.onchange = describeModel;
ui.load.onclick = loadModel;
ui.unload.onclick = unloadModel;
ui.send.onclick = send;
ui.stop.onclick = stop;
ui.clear.onclick = clearChat;
ui.rerun.onclick = () => showPreview(state.lastHtml);
ui.copy.onclick = async () => {
  try { await navigator.clipboard.writeText(state.lastHtml); ui.copy.textContent = "Kopioitu ✓"; }
  catch { ui.copy.textContent = "Ei onnistunut"; }
  setTimeout(() => (ui.copy.textContent = "Kopioi HTML"), 1500);
};
ui.prompt.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
for (const t of document.querySelectorAll(".tab")) t.onclick = () => setMode(t.dataset.mode);

setMode("chat");
await detect();
await fillModels();
