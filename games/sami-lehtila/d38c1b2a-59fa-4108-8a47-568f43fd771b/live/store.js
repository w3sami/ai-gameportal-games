// Äänet ja slotit asuvat portaalin tulostauluissa, ei omaa backendiä.
//   board "slots": yksi rivi per tallennus, data = { id, day: "YYYY-MM-DD", time: "HH:MM", a, b, deleted? }
//                  a/b = { title, speaker?, img? } tai pelkkä merkkijono. Sama id kuin
//                  config/agenda.jsonissa korvaa sen slotin.
//                  uusin rivi (score = unix-sekunnit) per id voittaa.
//   board "votes": level = slotin id, name = äänestäjä, data = { lane: "a" | "b" | "none" }
//                  uusin rivi per nimi voittaa; "none" = ääni peruttu.
import { submit, top, setName } from "https://plugins.game.bigbools.fi/leaderboard/1.1.1/index.js";

const now = () => Math.floor(Date.now() / 1000);
const newer = (e, cur) =>
  e.score > cur.score || (e.score === cur.score && (e.id ?? 0) > (cur.id ?? 0));

function latestBy(entries, keyOf) {
  const map = new Map();
  for (const e of entries) {
    const k = keyOf(e);
    if (k == null) continue;
    const cur = map.get(k);
    if (!cur || newer(e, cur)) map.set(k, e);
  }
  return map;
}

export async function loadSlots() {
  const { entries = [], reason } = await top({ board: "slots", limit: 100 });
  // Palauttaa myös poistetut, jotta poisto voi peittää config/agenda.jsonin slotin.
  const slots = [...latestBy(entries, (e) => e.data?.id).values()].map((e) => e.data);
  return { slots, reason };
}

export async function saveSlot(name, slot) {
  setName(name);
  return submit({ board: "slots", score: now(), data: slot });
}

export async function loadVotes(slotId) {
  const { entries = [], reason } = await top({ board: "votes", level: slotId, limit: 100 });
  const votes = {};
  for (const [name, e] of latestBy(entries, (e) => e.name)) {
    const lane = e.data?.lane;
    if (lane === "a" || lane === "b") votes[name] = lane;
  }
  return { votes, reason };
}

export async function vote(name, slotId, lane) {
  setName(name);
  return submit({ board: "votes", level: slotId, score: now(), data: { lane } });
}
