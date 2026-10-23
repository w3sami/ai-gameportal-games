import { loadSlots, saveSlot, loadVotes, vote } from "./store.js";

const REFRESH_MS = 30000;
const app = document.getElementById("app");
const state = { name: readName(), prevName: "", seed: [], board: [], slots: [], votes: {}, editing: null, adding: false, status: "" };

const T = (x) => (typeof x === "string" ? { title: x } : x || {});
const byTime = (x, y) => (x.day + x.time).localeCompare(y.day + y.time);

async function loadSeed() {
  try {
    const r = await fetch("config/agenda.json", { cache: "no-store" });
    state.seed = (await r.json()).slots || [];
  } catch { state.seed = []; }
}

// Taululle tallennettu slotti voi olla vanhempi kuin kuvaukset: täydennetään desc agendasta, jos otsikko on sama.
const fillDesc = (t, o) => (t && typeof t === "object" && !t.desc && o?.desc && o.title === t.title ? { ...t, desc: o.desc } : t);

function merge() {
  const map = new Map(state.seed.map((s) => [s.id, s]));
  for (const s of state.board) {
    const seed = map.get(s.id);
    map.set(s.id, seed ? { ...s, a: fillDesc(s.a, seed.a), b: fillDesc(s.b, seed.b) } : s);
  }
  state.slots = [...map.values()].filter((s) => !s.deleted).sort(byTime);
}

function readName() { try { return localStorage.getItem("lv-name") || ""; } catch { return ""; } }
function writeName(n) { try { localStorage.setItem("lv-name", n); } catch {} }

const MSG = {
  offline: "Ei verkkoyhteyttä — yritetään uudelleen pian.",
  busy: "Liikaa pyyntöjä juuri nyt — yritä hetken päästä.",
  server: "Portaalilla on hetki menossa — yritä hetken päästä.",
  full: "Taulu on täynnä.",
};
const msg = (r) => (r ? MSG[r] || `Ei onnistunut (${r}).` : "");

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k.includes("-") || k === "role") el.setAttribute(k, v);
    else el[k] = v;
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const pad = (n) => String(n).padStart(2, "0");
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function dayLabel(day) {
  const d = new Date(day + "T12:00:00");
  return isNaN(d) ? day : d.toLocaleDateString("fi-FI", { weekday: "short", day: "numeric", month: "numeric" });
}
const formOpen = () => state.adding || state.editing;
const thumb = (img, px) => img + (img.includes("ctfassets") ? `?w=${px}&h=${px}&fit=thumb&f=face` : "");

async function refresh() {
  const { slots, reason } = await loadSlots();
  state.status = msg(reason);
  if (!reason) state.board = slots;
  merge();
  const results = await Promise.all(state.slots.map((s) => loadVotes(s.id)));
  state.slots.forEach((s, i) => { if (!results[i].reason) state.votes[s.id] = results[i].votes; });
  if (!formOpen()) render();
}

async function cast(slotId, lane) {
  const box = (state.votes[slotId] ||= {});
  const prev = box[state.name];
  if (lane === "none") delete box[state.name]; else box[state.name] = lane;
  render();
  const { kept, reason } = await vote(state.name, slotId, lane);
  if (!kept) {
    if (prev) box[state.name] = prev; else delete box[state.name];
    state.status = msg(reason);
    render();
  }
}

// Kuvaus modaalissa; dialog elää bodyssa, joten 30 s päivitys ei sulje sitä.
function showTalk(t, key, label) {
  const dlg = h("dialog", { class: "modal", "data-k": key,
    onclose: () => dlg.remove(),
    onclick: (e) => { if (e.target === dlg) dlg.close(); } },
    h("div", { class: "modal-body" },
      h("div", { class: "modal-head" },
        t.img ? h("img", { class: "face big", src: thumb(t.img, 160), alt: "" }) : null,
        h("div", { class: "talktext" },
          h("span", { class: "lane-label" }, label),
          h("h3", {}, t.title),
          t.speaker ? h("span", { class: "speaker" }, t.speaker) : null)),
      h("div", { class: "desc" }, (t.desc || "").split(/\n{2,}/).map((p) => h("p", {}, p))),
      h("div", { class: "actions" }, h("button", { class: "primary", onclick: () => dlg.close() }, "Sulje"))));
  document.body.append(dlg);
  dlg.showModal();
}

// Fullscreen koko sivulle; webkit-etuliite vanhemmille Safareille. Nappi piiloon, jos kehys ei salli.
const root = document.documentElement;
const canFs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const fsLabel = () => (isFs() ? "⤡ Pienennä" : "⤢ Koko näyttö");
function toggleFs() {
  const p = isFs()
    ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
    : (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
  p?.catch?.(() => {});
}
// Päivitetään vain napin teksti, ettei render() nollaa auki olevaa lomaketta.
for (const ev of ["fullscreenchange", "webkitfullscreenchange"])
  document.addEventListener(ev, () => { const b = document.querySelector(".fs"); if (b) b.textContent = fsLabel(); });

function header() {
  return h("header", {},
    h("div", {}, h("h1", {}, "Lane-äänestys"), h("p", { class: "sub" }, "Kuka menee mihinkin — CityJS Athens")),
    h("div", { class: "tools" },
      canFs ? h("button", { class: "me fs", onclick: toggleFs }, fsLabel()) : null,
      state.name ? h("button", { class: "me", onclick: () => { state.prevName = state.name; state.name = ""; render(); } }, "👤 " + state.name) : null));
}

function nameCard() {
  const input = h("input", { type: "text", placeholder: "Nimesi", maxLength: 24, value: state.prevName });
  const go = () => {
    const n = input.value.trim();
    if (!n) return input.focus();
    state.name = n; writeName(n); render();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  setTimeout(() => input.focus(), 0);
  return h("div", { class: "card" },
    h("label", {}, "Kuka äänestää? Nimi näkyy muille.", input),
    h("div", { class: "actions" }, h("button", { class: "primary", onclick: go }, "Jatka")));
}

// Lane on div eikä button, jotta sen sisällä voi olla oma kuvausnappi.
// Klikkaus kytkee tämän lanen päälle/pois; molemmat päällä = "ab", kumpikaan = "none".
function laneButton(slot, key, label, voters, mine) {
  const t = T(slot[key]);
  const on = !!mine?.includes(key);
  const cls = ["lane", on && "mine"].filter(Boolean).join(" ");
  const pick = () => {
    const next = ["a", "b"].filter((k) => (k === key ? !on : !!mine?.includes(k))).join("");
    cast(slot.id, next || "none");
  };
  return h("div", { class: cls, "data-k": key, role: "button", tabIndex: 0, onclick: pick,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } } },
    h("span", { class: "lane-label" }, label),
    h("span", { class: "count" }, String(voters.length)),
    h("span", { class: "talkbox" },
      t.img ? h("img", { class: "face", src: thumb(t.img, 96), alt: "", loading: "lazy" }) : null,
      h("span", { class: "talktext" },
        h("span", { class: "talk" }, t.title || "? — täydennä ✎"),
        t.speaker ? h("span", { class: "speaker" }, t.speaker) : null,
        t.desc ? h("button", { class: "info",
          onclick: (e) => { e.stopPropagation(); showTalk(t, key, label); },
          onkeydown: (e) => e.stopPropagation() }, "Kuvaus ›") : null)),
    h("span", { class: "who" }, voters.join(", ")));
}

function slotCard(slot) {
  const v = state.votes[slot.id] || {};
  const voters = { a: [], b: [] };
  for (const [name, lane] of Object.entries(v)) for (const k of lane) voters[k]?.push(name);
  const mine = v[state.name];
  // Piilota lane, jolla ei ole puhetta — paitsi tyhjässä slotissa, jota ollaan vasta täyttämässä.
  const keys = [slot.a && "a", slot.b && "b"].filter(Boolean);
  const shown = keys.length ? keys : ["a", "b"];
  return h("section", { class: "slot" },
    h("div", { class: "slot-head" },
      h("span", { class: "time" }, slot.time),
      h("button", { class: "edit", "aria-label": "Muokkaa slottia", onclick: () => { state.editing = slot.id; render(); } }, "✎")),
    h("div", { class: shown.length === 1 ? "lanes single" : "lanes" },
      shown.map((k) => laneButton(slot, k, k === "a" ? "Track 1" : "Track 2", voters[k], mine))));
}

function slotForm(slot) {
  const day = h("input", { type: "date", value: slot?.day || today() });
  const time = h("input", { type: "time", value: slot?.time || "" });
  const a = h("input", { type: "text", placeholder: "Puhe / puhuja", maxLength: 200, value: T(slot?.a).title || "" });
  const b = h("input", { type: "text", placeholder: "Puhe / puhuja", maxLength: 200, value: T(slot?.b).title || "" });
  const close = () => { state.adding = false; state.editing = null; render(); };
  const store = async (data) => {
    const { kept, reason } = await saveSlot(state.name, data);
    if (!kept) { state.status = msg(reason); render(); return false; }
    state.board = state.board.filter((s) => s.id !== data.id).concat(data);
    merge();
    state.status = "";
    close();
    return true;
  };
  const save = () => {
    if (!time.value) return time.focus();
    const talk = (old, v) => { const o = T(old); v = v.trim(); return !v ? null : v === o.title ? o : { title: v }; };
    store({ id: slot?.id || newId(), day: day.value || today(), time: time.value, a: talk(slot?.a, a.value), b: talk(slot?.b, b.value) });
  };
  let armed = false;
  const del = slot && h("button", { class: "danger", onclick: () => {
    if (!armed) { armed = true; del.textContent = "Varmasti?"; return; }
    store({ ...slot, deleted: true });
  } }, "Poista");
  setTimeout(() => (slot ? a : time).focus(), 0);
  return h("div", { class: "card" },
    h("div", { class: "row" }, h("label", {}, "Päivä", day), h("label", {}, "Aika", time)),
    h("label", {}, "Track 1", a),
    h("label", {}, "Track 2", b),
    h("div", { class: "actions" },
      h("button", { class: "primary", onclick: save }, "Tallenna"),
      h("button", { class: "ghost", onclick: close }, "Peru"),
      del));
}

function slotList() {
  if (!state.slots.length && !state.adding)
    return h("p", { class: "empty" }, "Ei vielä slotteja. Lisää ensimmäinen: aika ja kummankin lanen puhe.");
  const out = [];
  let lastDay = null;
  for (const slot of state.slots) {
    if (slot.day !== lastDay) { out.push(h("h2", { class: "day" }, dayLabel(slot.day))); lastDay = slot.day; }
    out.push(state.editing === slot.id ? slotForm(slot) : slotCard(slot));
  }
  return out;
}

function render() {
  app.replaceChildren(...[
    header(),
    state.status && h("p", { class: "status" }, state.status),
    !state.name ? nameCard() : [
      slotList(),
      state.adding ? slotForm(null)
        : !state.editing && h("button", { class: "add", onclick: () => { state.adding = true; render(); } }, "+ Lisää slotti"),
    ],
  ].flat(2).filter(Boolean));
}

render();
loadSeed().then(refresh);
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
