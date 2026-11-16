// Tracker music through chiptune3 (libopenmpt in an AudioWorklet), and the
// song clock every mode reads. time() is seconds into the song as heard.

import { ChiptuneJsPlayer } from '../lib/chiptune3.js';

export class Music {
  constructor() {
    this.player = null;
    this.buffer = null;
    this.playing = false;
    this.offset = null;     // audio-context time at which the song's second 0 was rendered
    this.onEnded = null;
    this.retry = 0;
    this.fresh = false;     // a position message of the current song has arrived
    this.latency = 0;       // output delay in seconds, read once per song so the clock does not wander
    this.extraDelay = 0;    // further delay in seconds between the browser's output and the player's ears
  }

  // Creates the audio context, so the first call has to come from a click or key.
  async init(url) {
    if (!this.player) {
      const player = new ChiptuneJsPlayer({ repeatCount: 0 });
      await new Promise((resolve) => player.onInitialized(resolve));
      player.onProgress((msg) => {
        if (!this.playing) return;
        // Messages from the song that was playing before this one are still in the queue.
        if (!this.fresh) {
          if (msg.pos > 0.3) return;
          this.fresh = true;
          this.latency = (player.context.outputLatency || 0) + (player.context.baseLatency || 0);
        }
        const offset = player.context.currentTime - msg.pos;
        // A jump means the song looped or restarted; otherwise smooth the jitter
        // of messages arriving one render quantum apart.
        if (this.offset === null || Math.abs(offset - this.offset) > 0.05) this.offset = offset;
        else this.offset += (offset - this.offset) * 0.05;
      });
      // The worklet repeats its end message every render quantum.
      player.onEnded(() => {
        if (!this.playing) return;
        this.stop();
        if (this.onEnded) this.onEnded();
      });
      this.player = player;
    }
    await this.player.context.resume();
    if (!this.buffer) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`song: HTTP ${res.status}`);
      this.buffer = await res.arrayBuffer();
    }
  }

  play(loop) {
    clearTimeout(this.retry);
    this.player.setRepeatCount(loop ? -1 : 0);
    this.offset = null;
    this.fresh = false;
    this.playing = true;
    // The worklet is registered before libopenmpt inside it has finished
    // loading, and a play sent in that gap is lost. Resend until the first
    // position message shows the song is running.
    const send = (tries) => {
      this.player.play(this.buffer);
      this.retry = setTimeout(() => {
        if (this.playing && this.offset === null && tries < 12) send(tries + 1);
      }, 500);
    };
    send(0);
  }

  stop() {
    clearTimeout(this.retry);
    this.playing = false;
    this.offset = null;
    if (this.player) this.player.stop();
  }

  setVolume(v) { if (this.player) this.player.setVol(v); }

  // Seconds into the song, or null while nothing is playing.
  time() {
    if (!this.playing || this.offset === null) return null;
    return this.player.context.currentTime - this.offset - this.latency - this.extraDelay;
  }
}
