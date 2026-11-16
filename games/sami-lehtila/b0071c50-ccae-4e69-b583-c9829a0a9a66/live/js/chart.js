// A chart is a song's choreography; a Run is one attempt at it.
// The chart file's own "format" field describes the notes.

export const WINDOWS = { perfect: 0.08, good: 0.14, ok: 0.2 };   // seconds either side of the beat
const POINTS = { perfect: 100, good: 60, ok: 30 };
const LONG = 1;              // a note of at least this many beats has to be held to its end
const HOLD_POINTS = 50;      // for holding a long note all the way
const RELEASE_SLACK = 0.2;   // seconds before its end a long note may be let go
const WEIGHT = { perfect: 1, good: 0.6, ok: 0.3 };

export async function loadChart(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`chart: HTTP ${res.status}`);
  const chart = await res.json();
  chart.spb = 60 / chart.bpm;
  return chart;
}

export class Run {
  constructor(chart) {
    // One item per lane of every note: a two-key note is two presses.
    this.items = [];
    for (const [beat, lanes, hold] of chart.notes) {
      for (const lane of lanes) {
        // state: null waiting, 'held' a long note being held, 'hit' done,
        // 'miss' never pressed, 'dropped' a long note let go too early.
        this.items.push({
          beat, lane, hold, t: beat * chart.spb, end: (beat + hold) * chart.spb,
          long: hold >= LONG, state: null,
        });
      }
    }
    this.items.sort((a, b) => a.t - b.t);
    this.cursor = 0;        // first item that can still be hit
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, good: 0, ok: 0, miss: 0, stray: 0, held: 0, dropped: 0 };
    this.holding = {};      // lane -> the long note being held in it
    this.offsetSum = 0;     // of every press that hit a note, for the mean below
    this.onHit = null;      // fn(item, grade) whenever a note is hit or a long one held to its end
    this.last = null;       // { grade, t } of the latest judgement, for the display
  }

  // A fresh press of a lane at song time t.
  press(lane, t) {
    let best = null, bestGap = WINDOWS.ok;
    for (let i = this.cursor; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.t > t + WINDOWS.ok) break;
      if (it.state || it.lane !== lane) continue;
      const gap = Math.abs(it.t - t);
      if (gap <= bestGap) { best = it; bestGap = gap; }
    }
    if (!best) {
      // A press with no note near it breaks the combo, or mashing every key would hit everything.
      this.combo = 0;
      this.counts.stray++;
      this.last = { grade: 'stray', t };
      return;
    }
    const grade = bestGap <= WINDOWS.perfect ? 'perfect' : bestGap <= WINDOWS.good ? 'good' : 'ok';
    best.state = best.long ? 'held' : 'hit';
    if (best.long) this.holding[lane] = best;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(POINTS[grade] * (1 + Math.min(this.combo, 30) / 10));
    this.counts[grade]++;
    // Signed: negative is before the note, positive after it.
    const offset = t - best.t;
    this.offsetSum += offset;
    this.last = { grade, t, offset };
    if (this.onHit) this.onHit(best, grade);
  }

  // Letting go of a lane. A long note let go before its end is dropped.
  release(lane, t) {
    const it = this.holding[lane];
    if (!it) return;
    if (t >= it.end - RELEASE_SLACK) { this.complete(it, t); return; }
    delete this.holding[lane];
    it.state = 'dropped';
    this.counts.dropped++;
    this.combo = 0;
    this.last = { grade: 'dropped', t };
  }

  complete(it, t) {
    delete this.holding[it.lane];
    it.state = 'hit';
    this.counts.held++;
    this.score += Math.round(HOLD_POINTS * (1 + Math.min(this.combo, 30) / 10));
    this.last = { grade: 'held', t };
    if (this.onHit) this.onHit(it, 'held');
  }

  // Notes the song has passed without a press are misses; long notes held to their end are done.
  update(t) {
    for (const lane of Object.keys(this.holding)) {
      if (t >= this.holding[lane].end) this.complete(this.holding[lane], t);
    }
    while (this.cursor < this.items.length && this.items[this.cursor].t < t - WINDOWS.ok) {
      const it = this.items[this.cursor++];
      if (it.state) continue;
      it.state = 'miss';
      this.counts.miss++;
      this.combo = 0;
      this.last = { grade: 'miss', t };
    }
  }

  // Lanes with a note about to land, for lighting the pad.
  due(t) {
    const out = {};
    for (let i = this.cursor; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.t > t + 0.22) break;
      if (!it.state) out[it.lane] = true;
    }
    return out;
  }

  // The chart played by the machine: lanes held at this beat. Marks the notes hit.
  autoLanes(beat) {
    const out = {};
    for (const it of this.items) {
      if (it.beat > beat) break;
      const lasting = beat < it.beat + it.hold;
      if (lasting) out[it.lane] = true;
      if (it.state === null) {
        // The machine never misses: its streak only grows.
        this.combo++;
        if (this.onHit) this.onHit(it, 'perfect');
      }
      if (it.state === 'held' && !lasting && this.onHit) this.onHit(it, 'held');
      it.state = lasting && it.long ? 'held' : 'hit';
    }
    return out;
  }

  // Mean of how early (negative) or late (positive) the hits were, in seconds.
  get meanOffset() {
    const hits = this.counts.perfect + this.counts.good + this.counts.ok;
    return hits ? this.offsetSum / hits : 0;
  }

  get accuracy() {
    const c = this.counts;
    const got = c.perfect * WEIGHT.perfect + c.good * WEIGHT.good + c.ok * WEIGHT.ok;
    return this.items.length ? got / this.items.length : 0;
  }
}

// Records a dance as it is played and turns it into a chart's notes.
export class Recorder {
  constructor(spb) {
    this.spb = spb;
    this.items = [];      // { beat, lane, hold } exactly as played, for the board
    this.open = {};       // lane -> its item while the lane is still down
  }

  press(lane, t) {
    if (this.open[lane]) return;
    const it = { beat: t / this.spb, lane, hold: 0 };
    this.open[lane] = it;
    this.items.push(it);
  }

  release(lane, t) {
    const it = this.open[lane];
    if (!it) return;
    it.hold = Math.max(0, t / this.spb - it.beat);
    delete this.open[lane];
  }

  // Lanes still down grow with the song.
  update(t) {
    for (const lane in this.open) this.open[lane].hold = Math.max(0, t / this.spb - this.open[lane].beat);
  }

  finish(t) {
    for (const lane of Object.keys(this.open)) this.release(lane, t);
  }

  // The take snapped to a grid of half beats, as chart notes [beat, [lanes], hold].
  // A press shorter than three quarters of a beat is a tap; a longer one keeps
  // its length. A note ends a quarter beat before the next one in its lane at
  // the latest, so that the key comes up in between.
  notes(grid = 0.5) {
    const byLane = {};
    for (const it of this.items) {
      const beat = Math.round(it.beat / grid) * grid;
      const hold = it.hold < 0.75 ? 0.5 : Math.max(1, Math.round(it.hold / grid) * grid);
      (byLane[it.lane] = byLane[it.lane] || new Map()).set(beat, hold);
    }
    const groups = new Map();
    for (const lane in byLane) {
      const beats = [...byLane[lane].keys()].sort((a, b) => a - b);
      beats.forEach((beat, i) => {
        let hold = byLane[lane].get(beat);
        if (i + 1 < beats.length) hold = Math.max(0.25, Math.min(hold, beats[i + 1] - beat - 0.25));
        const key = `${beat}/${hold}`;
        if (!groups.has(key)) groups.set(key, [beat, [], hold]);
        groups.get(key)[1].push(lane);
      });
    }
    return [...groups.values()].sort((a, b) => a[0] - b[0]);
  }
}
