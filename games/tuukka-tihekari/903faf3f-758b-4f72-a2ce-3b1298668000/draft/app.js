(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const state = {
    tracks: [],
    current: -1,
    filtered: [],
    shuffle: false,
    repeat: false,
    catalog: null,
  };
  const els = Object.fromEntries(
    [
      "installer",
      "player",
      "install-status",
      "current-file",
      "install-note",
      "audio",
      "radio-audio",
      "seek",
      "volume",
      "mute",
      "prev",
      "play",
      "stop",
      "next",
      "shuffle",
      "repeat",
      "clock",
      "now-index",
      "now-title",
      "now-meta",
      "visualizer",
      "track-list",
      "library-count",
      "search",
      "genre",
      "artist",
      "sort",
      "track-info",
      "credits",
      "credits-list",
      "credits-open",
      "credits-close",
      "eq-enabled",
      "eq-reset",
      "eq-preset",
      "eq-bands",
    ].map((id) => [id, $("#" + id)]),
  );
  const fmtBytes = (n = 0) => {
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1000 && i < u.length - 1) {
      n /= 1000;
      i++;
    }
    return `${n.toFixed(i ? 2 : 0)} ${u[i]}`;
  };
  const fmtTime = (n = 0) => {
    if (!isFinite(n)) {
      return "--:--";
    }
    n = Math.max(0, Math.floor(n));
    return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  };
  function note(msg, error = true) {
    els["install-note"].hidden = false;
    els["install-note"].classList.toggle("error", error);
    els["install-note"].textContent = msg;
  }
  async function install() {
    const configResponse = await fetch("manifest.json", { cache: "no-store" });
    const config = await configResponse.json();
    const catalogResponse = await fetch(config.catalogApi || "/api/audio/catalog", {
      cache: "no-store",
    });
    if (!catalogResponse.ok) {
      throw Error(`Music catalog: HTTP ${catalogResponse.status}`);
    }
    const catalog = await catalogResponse.json();
    const minimumDuration = Math.max(60, Number(catalog.minDurationSeconds || 60));
    state.tracks = (catalog.tracks || []).filter(
      (track) => track.live || Number(track.durationSeconds || 0) >= minimumDuration,
    );
    state.catalog = {
      pageCount: 1,
      totalTracks: state.tracks.length,
      genres: [...new Set(state.tracks.flatMap(genresOf))],
      defaultGenre: "",
      errors: catalog.errors || [],
    };
    if (!state.tracks.length) {
      throw Error("Music catalog is empty");
    }
    unlock();
  }
  let ctx,
    source,
    analyser,
    filters = [];
  function initAudio() {
    if (ctx) {
      return;
    }
    ctx = new AudioContext();
    source = ctx.createMediaElementSource(els.audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    let node = source;
    const freqs = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
    filters = freqs.map((f, i) => {
      const q = ctx.createBiquadFilter();
      q.type = i === 0 ? "lowshelf" : i === freqs.length - 1 ? "highshelf" : "peaking";
      q.frequency.value = f;
      q.Q.value = 1;
      q.gain.value = +(localStorage.getItem("eq-" + f) || 0);
      node.connect(q);
      node = q;
      return q;
    });
    node.connect(analyser);
    analyser.connect(ctx.destination);
    buildEq(freqs);
    draw();
  }
  function buildEq(freqs) {
    els["eq-bands"].innerHTML = "";
    freqs.forEach((f, i) => {
      const d = document.createElement("label");
      d.className = "eq-band";
      d.innerHTML = `<input type="range" min="-12" max="12" step="1" value="${filters[i].gain.value}"><span>${f >= 1000 ? f / 1000 + "k" : f}</span>`;
      d.firstChild.oninput = (e) => {
        filters[i].gain.value = +e.target.value;
        localStorage.setItem("eq-" + f, e.target.value);
      };
      els["eq-bands"].append(d);
    });
  }
  function draw() {
    if (!analyser) {
      return;
    }
    requestAnimationFrame(draw);
    const c = els.visualizer,
      g = c.getContext("2d"),
      a = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(a);
    g.fillStyle = "#050704";
    g.fillRect(0, 0, c.width, c.height);
    const w = c.width / a.length;
    for (let i = 0; i < a.length; i++) {
      const h = (a[i] / 255) * c.height;
      g.fillStyle = `hsl(${85 + i / 5} 80% ${35 + a[i] / 9}%)`;
      g.fillRect(i * w, c.height - h, Math.max(1, w - 2), h);
    }
  }
  function unlock() {
    els.installer.hidden = true;
    els.player.hidden = false;
    state.filtered = [...state.tracks];
    populateFilters();
    render();
    showCredits();
    select(0, false);
  }
  const genresOf = (t) =>
    String(t.genre || "")
      .split(",")
      .map((x) => x.replaceAll("&amp;", "&").trim())
      .filter(Boolean);
  function populateFilters() {
    for (const [el, key, label] of [
      [els.genre, "genre", "All genres"],
      [els.artist, "artist", "All artists"],
    ]) {
      const selected = el.value;
      el.innerHTML = "";
      el.add(new Option(label, ""));
      const values =
        key === "genre"
          ? state.catalog.genres || state.tracks.flatMap(genresOf)
          : state.tracks.map((t) => t[key]).filter(Boolean);
      [...new Set(values)].sort().forEach((v) => el.add(new Option(v, v)));
      el.value = selected;
    }
  }
  function render() {
    const q = els.search.value.toLowerCase(),
      g = els.genre.value,
      a = els.artist.value,
      sort = els.sort.value;
    state.filtered = state.tracks
      .filter(
        (t) =>
          (!q || `${t.artist} ${t.title} ${t.album || ""}`.toLowerCase().includes(q)) &&
          (!g || genresOf(t).includes(g)) &&
          (!a || t.artist === a),
      )
      .sort((x, y) =>
        sort === "duration"
          ? x.durationSeconds - y.durationSeconds
          : sort === "size"
            ? x.bytes - y.bytes
            : String(x[sort] || "").localeCompare(String(y[sort] || "")),
      );
    els["library-count"].textContent = `${state.filtered.length} streams`;
    els["track-list"].innerHTML = "";
    const frag = document.createDocumentFragment();
    state.filtered.forEach((t, i) => {
      const d = document.createElement("div");
      d.className = "track" + (state.tracks[state.current]?.id === t.id ? " selected" : "");
      d.innerHTML = `<span>${String(i + 1).padStart(3, "0")}</span><span class="title">${escapeHtml(t.title)}<small>${escapeHtml(t.artist)} · ${escapeHtml(t.provider || "Remote")}</small></span><span>${escapeHtml(t.genre || "—")}</span><span>${t.live ? "LIVE" : fmtTime(t.durationSeconds)}</span><span>${t.live ? `${Math.round((t.bitrate || 0) / 1000)}k` : t.bytes ? fmtBytes(t.bytes) : "STREAM"}</span>`;
      d.ondblclick = () => select(state.tracks.indexOf(t), true);
      d.onclick = () => {
        const player = activeAudio();
        select(state.tracks.indexOf(t), !player.paused && !player.ended);
      };
      frag.append(d);
    });
    els["track-list"].append(frag);
  }
  const escapeHtml = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  async function select(i, autoplay = true) {
    if (i < 0 || i >= state.tracks.length) {
      return;
    }
    state.current = i;
    const t = state.tracks[i];
    els["now-index"].textContent = String(i + 1).padStart(3, "0");
    els["now-title"].textContent = `${t.artist} — ${t.title}`;
    els["now-meta"].textContent =
      `${t.album || "—"} · ${t.genre || "Music"} · ${t.live ? "LIVE" : fmtTime(t.durationSeconds)} · ${t.provider || "Remote"}`;
    els["track-info"].innerHTML =
      `<dt>Artist / station</dt><dd>${escapeHtml(t.artist)}</dd><dt>Title</dt><dd>${escapeHtml(t.title)}</dd><dt>Provider</dt><dd>${escapeHtml(t.provider || "Remote")}</dd><dt>License</dt><dd><a target="_blank" rel="noopener" href="${t.licenseUrl}">${escapeHtml(t.license)}</a></dd><dt>Source</dt><dd><a target="_blank" rel="noopener" href="${t.sourceUrl}">Original source</a></dd>`;
    render();
    const player = t.live ? els["radio-audio"] : els.audio;
    const otherPlayer = t.live ? els.audio : els["radio-audio"];
    otherPlayer.pause();
    player.src = t.url;
    if (autoplay) {
      if (!t.live) {
        initAudio();
        await ctx.resume();
      }
      await player.play();
    }
  }
  const activeAudio = () => (state.tracks[state.current]?.live ? els["radio-audio"] : els.audio);
  const move = (dir) => {
    if (!state.tracks.length) {
      return;
    }
    let i = state.shuffle
      ? Math.floor(Math.random() * state.tracks.length)
      : (state.current + dir + state.tracks.length) % state.tracks.length;
    select(i, true);
  };
  const syncPlayState = () => {
    const player = activeAudio();
    const playing = !player.paused && !player.ended;
    els.play.classList.toggle("primary", playing);
    els.play.setAttribute("aria-pressed", String(playing));
  };
  els.play.onclick = async () => {
    const player = activeAudio();
    if (!state.tracks[state.current]?.live) {
      initAudio();
      await ctx.resume();
    }
    if (player.paused) {
      await player.play();
    } else {
      player.pause();
    }
  };
  els.stop.onclick = () => {
    const player = activeAudio();
    player.pause();
    player.currentTime = 0;
  };
  els.prev.onclick = () => move(-1);
  els.next.onclick = () => move(1);
  els.shuffle.onclick = () => {
    state.shuffle = !state.shuffle;
    els.shuffle.setAttribute("aria-pressed", state.shuffle);
  };
  els.repeat.onclick = () => {
    state.repeat = !state.repeat;
    els.repeat.setAttribute("aria-pressed", state.repeat);
  };
  const onEnded = () => {
    syncPlayState();
    const player = activeAudio();
    state.repeat ? ((player.currentTime = 0), player.play()) : move(1);
  };
  const onTimeUpdate = () => {
    const player = activeAudio();
    els.clock.textContent = state.tracks[state.current]?.live
      ? "LIVE"
      : `${fmtTime(player.currentTime)} / ${fmtTime(player.duration)}`;
    els.seek.value = player.duration ? (player.currentTime / player.duration) * 1000 : 0;
  };
  [els.audio, els["radio-audio"]].forEach((player) => {
    player.onplay = syncPlayState;
    player.onpause = syncPlayState;
    player.onended = onEnded;
    player.onerror = syncPlayState;
    player.ontimeupdate = onTimeUpdate;
  });
  els.seek.oninput = () => {
    const player = activeAudio();
    if (player.duration) {
      player.currentTime = (els.seek.value / 1000) * player.duration;
    }
  };
  els.volume.oninput = () => {
    els.audio.volume = els.volume.value;
    els["radio-audio"].volume = els.volume.value;
  };
  els.audio.volume = els.volume.value;
  els["radio-audio"].volume = els.volume.value;
  els.mute.onclick = () => {
    const muted = !activeAudio().muted;
    els.audio.muted = muted;
    els["radio-audio"].muted = muted;
  };
  [els.search, els.genre, els.artist, els.sort].forEach((e) => (e.oninput = render));
  document.querySelectorAll(".tabs button").forEach(
    (b) =>
      (b.onclick = () => {
        document
          .querySelectorAll(".tabs button")
          .forEach((x) => x.classList.toggle("active", x === b));
        $("#info-tab").hidden = b.dataset.tab !== "info";
        $("#eq-tab").hidden = b.dataset.tab !== "eq";
      }),
  );
  els["eq-enabled"].onchange = () =>
    filters.forEach(
      (f) =>
        (f.gain.value = els["eq-enabled"].checked
          ? +(localStorage.getItem("eq-" + f.frequency.value) || 0)
          : 0),
    );
  els["eq-reset"].onclick = () =>
    document.querySelectorAll(".eq-band input").forEach((i) => {
      i.value = 0;
      i.dispatchEvent(new Event("input"));
    });
  els["eq-preset"].onchange = () => {
    const presets = {
        Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        "Bass lift": [8, 6, 3, 1, 0, 0, 0, 0, 0, 0],
        Smile: [6, 4, 1, -2, -3, -1, 1, 3, 5, 6],
        Club: [4, 3, 1, 2, 4, 3, 1, 0, 1, 2],
      },
      v = presets[els["eq-preset"].value];
    document.querySelectorAll(".eq-band input").forEach((i, n) => {
      i.value = v[n];
      i.dispatchEvent(new Event("input"));
    });
  };
  function showCredits() {
    els["credits-list"].innerHTML = state.tracks
      .map(
        (t) =>
          `<article class="credit"><strong>${escapeHtml(t.artist)} — ${escapeHtml(t.title)}</strong><p>${escapeHtml(t.attribution)}</p><p>${escapeHtml(t.provider || "Remote stream")}${t.live ? " · LIVE" : ` · ${fmtTime(t.durationSeconds)}`}</p><a target="_blank" rel="noopener" href="${t.licenseUrl}">${escapeHtml(t.license)}</a> · <a target="_blank" rel="noopener" href="${t.sourceUrl}">Source</a></article>`,
      )
      .join("");
  }
  els["credits-open"].onclick = () => els.credits.showModal();
  els["credits-close"].onclick = () => els.credits.close();
  els.credits.addEventListener("click", (event) => {
    if (event.target === els.credits) {
      els.credits.close();
    }
  });
  addEventListener("keydown", (e) => {
    if (/INPUT|SELECT/.test(e.target.tagName)) {
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      els.play.click();
    }
    if (e.code === "ArrowRight") {
      move(1);
    }
    if (e.code === "ArrowLeft") {
      move(-1);
    }
    if (e.key.toLowerCase() === "m") {
      els.mute.click();
    }
  });
  install().catch((e) => {
    els.installer.hidden = false;
    els.player.hidden = true;
    els["install-status"].textContent = "FAILED";
    note(String(e), true);
    els["current-file"].textContent = "Library preparation halted.";
  });
})();
