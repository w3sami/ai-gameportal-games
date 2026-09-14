(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const cfg = { concurrency: 12, force: false, retryDelays: [1000, 2000, 5000, 10000] };
  const state = { manifest:null, tracks:[], done:0, bytes:0, active:0, retries:0, failed:[], paused:false, started:0, current:-1, filtered:[], shuffle:false, repeat:false, objectUrls:new Map() };
  const els = Object.fromEntries(['installer','player','install-status','track-progress','byte-progress','progress-bar','percent','speed','eta','active-count','retry-count','elapsed','storage','current-file','install-note','pause','resume','retry','audio','seek','volume','mute','prev','play','stop','next','shuffle','repeat','clock','now-index','now-title','now-meta','visualizer','track-list','library-count','search','genre','artist','sort','track-info','credits','credits-list','credits-open','eq-enabled','eq-reset','eq-preset','eq-bands'].map(id=>[id,$('#'+id)]));
  const fmtBytes = (n=0) => { const u=['B','KB','MB','GB','TB']; let i=0; while(n>=1000&&i<u.length-1){n/=1000;i++} return `${n.toFixed(i?2:0)} ${u[i]}` };
  const fmtTime = (n=0) => { if(!isFinite(n)) return '--:--'; n=Math.max(0,Math.floor(n)); return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}` };
  const sleep = ms => new Promise(r=>setTimeout(r,ms));

  let db;
  const openDb = () => new Promise((resolve,reject)=>{ const r=indexedDB.open('bigbools-amp',2); r.onupgradeneeded=()=>{ const d=r.result; if(!d.objectStoreNames.contains('meta'))d.createObjectStore('meta'); if(!d.objectStoreNames.contains('tracks'))d.createObjectStore('tracks'); }; r.onsuccess=()=>resolve(db=r.result); r.onerror=()=>reject(r.error) });
  const idb = (store,mode,fn) => new Promise((resolve,reject)=>{ const tx=db.transaction(store,mode), os=tx.objectStore(store); let result; try{result=fn(os)}catch(e){reject(e)} tx.oncomplete=()=>resolve(result?.result); tx.onerror=()=>reject(tx.error) });
  const getMeta = k => idb('meta','readonly',s=>s.get(k));
  const setMeta = (k,v) => idb('meta','readwrite',s=>s.put(v,k));
  const hasTrack = async t => { const m=await idb('tracks','readonly',s=>s.get(t.id)); return m && m.bytes===t.bytes && m.sha256===t.sha256 };
  const putTrackMeta = t => idb('tracks','readwrite',s=>s.put({bytes:t.bytes,sha256:t.sha256},t.id));

  async function opfsRoot(){ return navigator.storage?.getDirectory ? navigator.storage.getDirectory() : null }
  async function removeLocal(id){ try{ const root=await opfsRoot(); if(root)await root.removeEntry(id) }catch{} }
  async function persistBlob(track, blob){ const root=await opfsRoot(); if(!root) return false; const h=await root.getFileHandle(track.id,{create:true}); const w=await h.createWritable(); await w.write(blob); await w.close(); await putTrackMeta(track); return true }
  async function localUrl(track){ if(state.objectUrls.has(track.id))return state.objectUrls.get(track.id); try{ const root=await opfsRoot(), h=await root.getFileHandle(track.id), f=await h.getFile(); if(f.size!==track.bytes)return null; const u=URL.createObjectURL(f); state.objectUrls.set(track.id,u); return u }catch{return null} }
  async function sha256(blob){ const b=await blob.arrayBuffer(), hash=await crypto.subtle.digest('SHA-256',b); return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('') }

  async function inspectStorage(total){
    try{ const e=await navigator.storage.estimate(); const free=(e.quota||0)-(e.usage||0); els.storage.textContent=fmtBytes(free)+' FREE'; if(navigator.storage.persist)await navigator.storage.persist(); if(free<total){ note(`Browser storage reports ${fmtBytes(free)} free for a ${fmtBytes(total)} library. The full network transfer will still be attempted, but some files may remain session-only.`,false) } }catch{ els.storage.textContent='UNKNOWN' }
  }
  function note(msg,error=true){ els['install-note'].hidden=false; els['install-note'].classList.toggle('error',error); els['install-note'].textContent=msg }
  function updateInstall(){
    const m=state.manifest||{trackCount:0,totalBytes:0}, elapsed=(Date.now()-state.started)/1000, speed=elapsed?state.bytes/elapsed:0, remain=Math.max(0,m.totalBytes-state.bytes);
    els['track-progress'].textContent=`${state.done} / ${m.trackCount} tracks`; els['byte-progress'].textContent=`${fmtBytes(state.bytes)} / ${fmtBytes(m.totalBytes)}`;
    const p=m.totalBytes?state.bytes/m.totalBytes*100:0; els['progress-bar'].style.width=Math.min(100,p)+'%'; els.percent.textContent=p.toFixed(1)+'%'; els.speed.textContent=fmtBytes(speed)+'/s'; els.eta.textContent='ETA '+(speed?fmtTime(remain/speed):'--:--'); els['active-count'].textContent=state.active; els['retry-count'].textContent=state.retries; els.elapsed.textContent=fmtTime(elapsed);
  }
  async function download(track){
    if(!cfg.force && await hasTrack(track)){ state.done++; state.bytes+=track.bytes; updateInstall(); return }
    if(cfg.force)await removeLocal(track.id);
    for(let attempt=0;attempt<=cfg.retryDelays.length;attempt++){
      while(state.paused)await sleep(250);
      try{
        state.active++; els['current-file'].textContent=`${track.artist} — ${track.title}`; updateInstall();
        const res=await fetch(track.url,{cache:cfg.force?'reload':'default'}); if(!res.ok)throw Error(`HTTP ${res.status}`);
        const blob=await res.blob(); if(blob.size!==track.bytes)throw Error(`size ${blob.size}, expected ${track.bytes}`);
        const hash=await sha256(blob); if(!track.sha256 || hash.toLowerCase()!==track.sha256.toLowerCase())throw Error('SHA-256 mismatch');
        await persistBlob(track,blob).catch(()=>false); state.done++; state.bytes+=blob.size; state.active--; updateInstall(); return;
      }catch(err){ state.active=Math.max(0,state.active-1); if(attempt===cfg.retryDelays.length){state.failed.push({track,error:String(err)});updateInstall();return} state.retries++;updateInstall();await sleep(cfg.retryDelays[attempt]); }
    }
  }
  async function install(){
    state.started=Date.now(); const configRes=await fetch('manifest.json',{cache:'no-store'}),c=await configRes.json();
    const manifestRes=await fetch(c.libraryManifest||'music/library-manifest.json',{cache:'no-store'}),m=state.manifest=await manifestRes.json(); cfg.concurrency=c.downloadConcurrency||12; cfg.force=!!c.forceFullRedownloadOnStart; cfg.retryDelays=c.retryDelaysMs||cfg.retryDelays;
    if(m.deploymentBlocked){ els['install-status'].textContent='STORAGE BLOCKED'; els['current-file'].textContent='No audio payload was substituted.'; note(m.blockedReason,true); els.pause.disabled=true; return }
    if(!m.tracks?.length || m.trackCount!==m.tracks.length || m.totalBytes!==m.tracks.reduce((a,t)=>a+t.bytes,0)){throw Error('Manifest totals are invalid')}
    await openDb(); await inspectStorage(m.totalBytes); const old=await getMeta('manifestVersion'); if(old!==m.version){await setMeta('manifestVersion',m.version)}
    state.tracks=m.tracks; let cursor=0; const workers=Array.from({length:cfg.concurrency},async()=>{while(cursor<m.tracks.length)await download(m.tracks[cursor++])}); await Promise.all(workers);
    if(state.failed.length){els['install-status'].textContent='INCOMPLETE';els.retry.disabled=false;note(`${state.failed.length} files failed integrity checks. The player remains locked.`,true);return}
    if(state.done!==m.trackCount||state.bytes!==m.totalBytes){throw Error('Final installed totals do not match the manifest')}
    await setMeta('readyVersion',m.version); unlock();
  }
  els.pause.onclick=()=>{state.paused=true;els.pause.disabled=true;els.resume.disabled=false;els['install-status'].textContent='PAUSED'};
  els.resume.onclick=()=>{state.paused=false;els.pause.disabled=false;els.resume.disabled=true;els['install-status'].textContent='INSTALLING'};
  els.retry.onclick=async()=>{const failed=state.failed.splice(0);els.retry.disabled=true;await Promise.all(failed.map(x=>download(x.track)));if(!state.failed.length&&state.done===state.manifest.trackCount&&state.bytes===state.manifest.totalBytes)unlock()};

  let ctx,source,analyser,filters=[];
  function initAudio(){ if(ctx)return; ctx=new AudioContext(); source=ctx.createMediaElementSource(els.audio); analyser=ctx.createAnalyser(); analyser.fftSize=256; let node=source; const freqs=[60,170,310,600,1000,3000,6000,12000,14000,16000]; filters=freqs.map((f,i)=>{const q=ctx.createBiquadFilter();q.type=i===0?'lowshelf':i===freqs.length-1?'highshelf':'peaking';q.frequency.value=f;q.Q.value=1;q.gain.value=+(localStorage.getItem('eq-'+f)||0);node.connect(q);node=q;return q}); node.connect(analyser);analyser.connect(ctx.destination); buildEq(freqs); draw() }
  function buildEq(freqs){els['eq-bands'].innerHTML='';freqs.forEach((f,i)=>{const d=document.createElement('label');d.className='eq-band';d.innerHTML=`<input type="range" min="-12" max="12" step="1" value="${filters[i].gain.value}"><span>${f>=1000?f/1000+'k':f}</span>`;d.firstChild.oninput=e=>{filters[i].gain.value=+e.target.value;localStorage.setItem('eq-'+f,e.target.value)};els['eq-bands'].append(d)})}
  function draw(){ if(!analyser)return;requestAnimationFrame(draw);const c=els.visualizer,g=c.getContext('2d'),a=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(a);g.fillStyle='#050704';g.fillRect(0,0,c.width,c.height);const w=c.width/a.length;for(let i=0;i<a.length;i++){const h=a[i]/255*c.height;g.fillStyle=`hsl(${85+i/5} 80% ${35+a[i]/9}%)`;g.fillRect(i*w,c.height-h,Math.max(1,w-2),h)}}
  function unlock(){els.installer.hidden=true;els.player.hidden=false;state.filtered=[...state.tracks];populateFilters();render();showCredits();select(0,false)}
  function populateFilters(){for(const [el,key] of [[els.genre,'genre'],[els.artist,'artist']]){[...new Set(state.tracks.map(t=>t[key]).filter(Boolean))].sort().forEach(v=>el.add(new Option(v,v)))}}
  function render(){const q=els.search.value.toLowerCase(),g=els.genre.value,a=els.artist.value,sort=els.sort.value;state.filtered=state.tracks.filter(t=>(!q||`${t.artist} ${t.title} ${t.album||''}`.toLowerCase().includes(q))&&(!g||t.genre===g)&&(!a||t.artist===a)).sort((x,y)=>sort==='duration'?x.durationSeconds-y.durationSeconds:sort==='size'?x.bytes-y.bytes:String(x[sort]||'').localeCompare(String(y[sort]||'')));els['library-count'].textContent=`${state.filtered.length} tracks`;els['track-list'].innerHTML='';const frag=document.createDocumentFragment();state.filtered.forEach((t,i)=>{const d=document.createElement('div');d.className='track'+(state.tracks[state.current]?.id===t.id?' selected':'');d.innerHTML=`<span>${String(i+1).padStart(3,'0')}</span><span class="title">${escapeHtml(t.title)}<small>${escapeHtml(t.artist)}</small></span><span>${escapeHtml(t.genre||'—')}</span><span>${fmtTime(t.durationSeconds)}</span><span>${fmtBytes(t.bytes)}</span>`;d.ondblclick=()=>select(state.tracks.indexOf(t),true);d.onclick=()=>select(state.tracks.indexOf(t),false);frag.append(d)});els['track-list'].append(frag)}
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function select(i,autoplay=true){if(i<0||i>=state.tracks.length)return;state.current=i;const t=state.tracks[i];els['now-index'].textContent=String(i+1).padStart(3,'0');els['now-title'].textContent=`${t.artist} — ${t.title}`;els['now-meta'].textContent=`${t.album||'—'} · ${t.genre||'Electronic'} · ${Math.round((t.bitrate||0)/1000)} kbps`;els['track-info'].innerHTML=`<dt>Artist</dt><dd>${escapeHtml(t.artist)}</dd><dt>Title</dt><dd>${escapeHtml(t.title)}</dd><dt>License</dt><dd><a target="_blank" rel="noopener" href="${t.licenseUrl}">${escapeHtml(t.license)}</a></dd><dt>Source</dt><dd><a target="_blank" rel="noopener" href="${t.sourceUrl}">Original release</a></dd>`;render(); const u=await localUrl(t); if(!u){note('A verified local copy is missing. Playback remains unavailable.',true);return}els.audio.src=u;if(autoplay){initAudio();await ctx.resume();await els.audio.play()}}
  const move=dir=>{if(!state.tracks.length)return;let i=state.shuffle?Math.floor(Math.random()*state.tracks.length):(state.current+dir+state.tracks.length)%state.tracks.length;select(i,true)};
  els.play.onclick=async()=>{initAudio();await ctx.resume();if(els.audio.paused)els.audio.play();else els.audio.pause()};els.stop.onclick=()=>{els.audio.pause();els.audio.currentTime=0};els.prev.onclick=()=>move(-1);els.next.onclick=()=>move(1);els.shuffle.onclick=()=>{state.shuffle=!state.shuffle;els.shuffle.setAttribute('aria-pressed',state.shuffle)};els.repeat.onclick=()=>{state.repeat=!state.repeat;els.repeat.setAttribute('aria-pressed',state.repeat)};els.audio.onended=()=>state.repeat?(els.audio.currentTime=0,els.audio.play()):move(1);els.audio.ontimeupdate=()=>{els.clock.textContent=`${fmtTime(els.audio.currentTime)} / ${fmtTime(els.audio.duration)}`;els.seek.value=els.audio.duration?els.audio.currentTime/els.audio.duration*1000:0};els.seek.oninput=()=>{if(els.audio.duration)els.audio.currentTime=els.seek.value/1000*els.audio.duration};els.volume.oninput=()=>els.audio.volume=els.volume.value;els.audio.volume=els.volume.value;els.mute.onclick=()=>els.audio.muted=!els.audio.muted;
  [els.search,els.genre,els.artist,els.sort].forEach(e=>e.oninput=render);document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===b));$('#info-tab').hidden=b.dataset.tab!=='info';$('#eq-tab').hidden=b.dataset.tab!=='eq'});els['eq-enabled'].onchange=()=>filters.forEach(f=>f.gain.value=els['eq-enabled'].checked?+(localStorage.getItem('eq-'+f.frequency.value)||0):0);els['eq-reset'].onclick=()=>document.querySelectorAll('.eq-band input').forEach(i=>{i.value=0;i.dispatchEvent(new Event('input'))});els['eq-preset'].onchange=()=>{const presets={Flat:[0,0,0,0,0,0,0,0,0,0],'Bass lift':[8,6,3,1,0,0,0,0,0,0],Smile:[6,4,1,-2,-3,-1,1,3,5,6],Club:[4,3,1,2,4,3,1,0,1,2]},v=presets[els['eq-preset'].value];document.querySelectorAll('.eq-band input').forEach((i,n)=>{i.value=v[n];i.dispatchEvent(new Event('input'))})};
  function showCredits(){els['credits-list'].innerHTML=state.tracks.map(t=>`<article class="credit"><strong>${escapeHtml(t.artist)} — ${escapeHtml(t.title)}</strong><p>${escapeHtml(t.attribution)}</p><a target="_blank" rel="noopener" href="${t.licenseUrl}">${escapeHtml(t.license)}</a> · <a target="_blank" rel="noopener" href="${t.sourceUrl}">Source</a></article>`).join('')};els['credits-open'].onclick=()=>els.credits.showModal();
  addEventListener('keydown',e=>{if(/INPUT|SELECT/.test(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();els.play.click()}if(e.code==='ArrowRight')move(1);if(e.code==='ArrowLeft')move(-1);if(e.key.toLowerCase()==='m')els.mute.click()});
  setInterval(()=>state.started&&updateInstall(),1000);install().catch(e=>{els['install-status'].textContent='FAILED';note(String(e),true);els['current-file'].textContent='Installation halted; the player remains locked.'});
})();
