(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const allowedWebHosts = new Set(['www.youtube.com','youtube.com','www.youtube-nocookie.com','developers.google.com','www.nasa.gov','www.dw.com','www.france24.com','www.aljazeera.com','www.euronews.com','www.trtworld.com','www3.nhk.or.jp','media.un.org','www.cgtn.com','www.africanews.com','www.abc.net.au','www.nbcnews.com']);
  const state = { channels: [], visible: [], selected: 0, previous: null, category: 'All', favoritesOnly: false, favorites: new Set(), player: null, playerReady: false, muted: true, volume: 55, retryCount: 0, retryTimer: null, numberBuffer: '', numberTimer: null, osdTimer: null };
  const els = ['clock','categoryTabs','channelList','guideRows','playerMount','signalCard','signalTitle','signalText','retryBtn','osdNumber','osdName','osdProgram','liveBadge','numberInput','statusDot','statusText','nowSource','nowMeta','guide','infoPanel','infoContent','guideBtn','favoritesFilter','favoriteBtn','muteBtn','volume'].reduce((o,id)=>(o[id]=$(id),o),{});

  function safeUrl(value, allowed = allowedWebHosts) {
    try { const url = new URL(value); return url.protocol === 'https:' && allowed.has(url.hostname) ? url.href : null; } catch { return null; }
  }
  function validChannel(c) {
    return c && Number.isInteger(c.number) && c.number > 0 && /^[a-z0-9-]+$/.test(c.id) && /^UC[A-Za-z0-9_-]{22}$/.test(c.providerChannelId) && typeof c.name === 'string' && c.name.length < 90 && safeUrl(c.streamUrl) && safeUrl(c.homepage) && safeUrl(c.source) && safeUrl(c.licenseUrl);
  }
  function loadPrefs() {
    try { state.favorites = new Set(JSON.parse(localStorage.getItem('bbtv:favorites') || '[]')); state.volume = Math.max(0,Math.min(100,Number(localStorage.getItem('bbtv:volume') || 55))); state.muted = localStorage.getItem('bbtv:muted') !== 'false'; } catch {}
    els.volume.value = state.volume; updateMuteButton();
  }
  function savePrefs() { try { localStorage.setItem('bbtv:favorites',JSON.stringify([...state.favorites])); localStorage.setItem('bbtv:volume',String(state.volume)); localStorage.setItem('bbtv:muted',String(state.muted)); } catch {} }
  function updateClock() { els.clock.textContent = new Intl.DateTimeFormat([], {hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()); }
  function channel() { return state.channels[state.selected]; }
  function showSignal(title, text, error=false) { els.signalTitle.textContent=title; els.signalText.textContent=text; els.signalCard.classList.remove('hidden'); els.signalCard.classList.toggle('error',error); }
  function hideSignal() { els.signalCard.classList.add('hidden'); els.signalCard.classList.remove('error'); }
  function setStatus(label, kind='wait') { els.statusText.textContent=label; els.statusDot.className='status-dot '+kind; els.liveBadge.textContent=label==='LIVE'?'LIVE':label; els.liveBadge.classList.toggle('live',label==='LIVE'); }
  function showOsd() { document.querySelector('.osd').classList.remove('idle'); clearTimeout(state.osdTimer); state.osdTimer=setTimeout(()=>document.querySelector('.osd').classList.add('idle'),4500); }

  function renderCategories() {
    const cats=['All',...new Set(state.channels.map(c=>c.category))]; els.categoryTabs.replaceChildren();
    cats.forEach(cat=>{ const b=document.createElement('button'); b.type='button'; b.className='category-tab'; b.role='tab'; b.textContent=cat; b.setAttribute('aria-selected',String(cat===state.category)); b.addEventListener('click',()=>{state.category=cat;renderCategories();renderChannels();}); els.categoryTabs.append(b); });
  }
  function renderChannels() {
    state.visible=state.channels.filter(c=>(state.category==='All'||c.category===state.category)&&(!state.favoritesOnly||state.favorites.has(c.id))); els.channelList.replaceChildren();
    if(!state.visible.length){const p=document.createElement('p');p.className='empty-list';p.textContent='No channels match this view.';els.channelList.append(p);return;}
    const template=$('channelTemplate'); state.visible.forEach(c=>{const node=template.content.firstElementChild.cloneNode(true);node.dataset.id=c.id;node.classList.toggle('active',channel()?.id===c.id);node.setAttribute('aria-label',`Channel ${c.number}, ${c.name}`);node.querySelector('.channel-num').textContent=String(c.number).padStart(2,'0');node.querySelector('.channel-monogram').textContent=c.monogram;node.querySelector('.channel-copy strong').textContent=c.name;node.querySelector('.channel-copy small').textContent=`${c.country} · ${c.category}`;node.querySelector('.channel-fav').textContent=state.favorites.has(c.id)?'★':'';node.addEventListener('click',()=>selectById(c.id));els.channelList.append(node);});
  }
  function renderGuide() {
    els.guideRows.replaceChildren(); state.channels.forEach(c=>{const row=document.createElement('div');row.className='guide-row'+(c.id===channel()?.id?' active':'');row.tabIndex=0;const ch=document.createElement('div');ch.className='guide-ch';ch.textContent=String(c.number).padStart(2,'0');const n=document.createElement('small');n.textContent=c.name;ch.append(n);const now=document.createElement('div');now.className='guide-program';const ns=document.createElement('strong');ns.textContent='LIVE CHANNEL';const nm=document.createElement('small');nm.textContent=c.testedTitle;now.append(ns,nm);const next=document.createElement('div');next.className='guide-program guide-next';const xs=document.createElement('strong');xs.textContent='SCHEDULE UNAVAILABLE';const xm=document.createElement('small');xm.textContent='No verified public EPG';next.append(xs,xm);row.append(ch,now,next);row.addEventListener('click',()=>{selectById(c.id);closeOverlay('guide');});row.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();row.click();}});els.guideRows.append(row);});
  }
  function renderInfo() {
    const c=channel(); if(!c)return; els.infoContent.replaceChildren(); const hero=document.createElement('div');hero.className='info-hero';const mono=document.createElement('div');mono.className='info-mono';mono.textContent=c.monogram;const copy=document.createElement('div');const h=document.createElement('h3');h.textContent=c.name;const p=document.createElement('p');p.textContent=`Channel ${String(c.number).padStart(2,'0')} · ${c.category}`;copy.append(h,p);hero.append(mono,copy);els.infoContent.append(hero);
    const fields=[['COUNTRY / LANGUAGE',`${c.country} / ${c.language}`],['STREAM TYPE','Official YouTube embeddable player'],['AUTHORIZATION',c.authorizationBasis],['EPG','No verified public EPG mapped'],['LOGO SOURCE',c.logoSource]];
    fields.forEach(([label,value])=>{const d=document.createElement('div');d.className='info-field';const s=document.createElement('small');s.textContent=label;const strong=document.createElement('strong');strong.textContent=value;d.append(s,strong);els.infoContent.append(d);});
    [['OFFICIAL HOMEPAGE',c.homepage],['LIVE SOURCE',c.source],['LICENSE / EMBED TERMS',c.licenseUrl]].forEach(([label,url])=>{const d=document.createElement('div');d.className='info-field';const s=document.createElement('small');s.textContent=label;const a=document.createElement('a');a.href=safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open verified source ↗';d.append(s,a);els.infoContent.append(d);});
  }
  function updateChrome() { const c=channel(); if(!c)return; els.osdNumber.textContent=String(c.number).padStart(2,'0');els.osdName.textContent=c.name;els.osdProgram.textContent=c.testedTitle;els.nowSource.textContent=`SOURCE ${c.country}`;els.nowMeta.textContent=`${c.language.toUpperCase()} · ${c.category.toUpperCase()} · AUTHORIZED EMBED`;els.favoriteBtn.textContent=state.favorites.has(c.id)?'★':'☆';els.favoriteBtn.setAttribute('aria-pressed',String(state.favorites.has(c.id)));renderChannels();renderGuide();renderInfo();showOsd(); }

  function buildPlayer() {
    const c=channel(); if(!c)return; clearTimeout(state.retryTimer); state.playerReady=false; state.attaching=false; setStatus('TUNING','wait'); showSignal('TUNING SIGNAL',`Connecting to ${c.name}…`); if(state.player&&typeof state.player.destroy==='function'){try{state.player.destroy();}catch{}}
    els.playerMount.replaceChildren(); const mount=document.createElement('div');mount.id='ytPlayer';els.playerMount.append(mount);
    if(window.YT&&window.YT.Player){attachPlayer();} else { setTimeout(()=>{if(window.YT&&window.YT.Player)attachPlayer();else failPlayer('The authorized player API did not load.');},2500); }
  }
  function attachPlayer() { const c=channel();if(!$('ytPlayer')||state.attaching||state.playerReady)return;state.attaching=true; try { state.player=new YT.Player('ytPlayer',{height:'100%',width:'100%',videoId:c.testedVideoId,host:'https://www.youtube.com',playerVars:{autoplay:1,mute:1,playsinline:1,controls:1,rel:0,origin:location.origin},events:{onReady:onPlayerReady,onStateChange:onPlayerState,onError:onPlayerError,onAutoplayBlocked:()=>{setStatus('READY','wait');showSignal('PRESS PLAY','Your browser paused autoplay. Select PLAY to begin.');}}}); } catch { state.attaching=false;failPlayer('Could not initialize the authorized player.'); } }
  function onPlayerReady(e) { state.playerReady=true; try{e.target.setVolume(state.volume);state.muted?e.target.mute():e.target.unMute();e.target.playVideo();}catch{} setTimeout(()=>{if(els.statusText.textContent==='TUNING'){setStatus('READY','wait');showSignal('PRESS PLAY','Signal ready. Select PLAY to begin.');}},3500); }
  function onPlayerState(e) { if(e.data===1){state.retryCount=0;hideSignal();setStatus('LIVE','live');try{localStorage.setItem('bbtv:lastChannel',channel().id);}catch{}} else if(e.data===3){setStatus('BUFFERING','wait');showSignal('BUFFERING','The source player is refilling its buffer…');} else if(e.data===2){setStatus('PAUSED','wait');} else if(e.data===0){failPlayer('The live broadcast ended.');} }
  function onPlayerError(e) { const messages={2:'The source rejected the channel request.',5:'This stream cannot play in HTML5.',100:'This live broadcast is unavailable.',101:'The publisher has disabled embedding.',150:'The publisher has disabled embedding.'}; failPlayer(messages[e.data]||'The source player reported an error.'); }
  function failPlayer(message) { setStatus('UNAVAILABLE','error');showSignal('SIGNAL UNAVAILABLE',message,true);if(state.retryCount<3){const delay=2000*Math.pow(2,state.retryCount++);clearTimeout(state.retryTimer);state.retryTimer=setTimeout(buildPlayer,delay);} }
  function selectById(id) { const index=state.channels.findIndex(c=>c.id===id);if(index<0||index===state.selected)return;if(channel())state.previous=state.selected;state.selected=index;state.retryCount=0;updateChrome();buildPlayer(); }
  function changeChannel(delta) { if(!state.channels.length)return;const next=(state.selected+delta+state.channels.length)%state.channels.length;selectById(state.channels[next].id); }
  function updateMuteButton(){els.muteBtn.textContent=state.muted?'MUTED':'SOUND';els.muteBtn.setAttribute('aria-pressed',String(state.muted));}
  function toggleMute(){state.muted=!state.muted;if(state.playerReady){try{state.muted?state.player.mute():state.player.unMute();}catch{}}updateMuteButton();savePrefs();}
  function toggleFavorite(){const c=channel();if(!c)return;state.favorites.has(c.id)?state.favorites.delete(c.id):state.favorites.add(c.id);savePrefs();updateChrome();}
  function openOverlay(id){renderGuide();renderInfo();$(id).hidden=false;if(id==='guide')els.guideBtn.setAttribute('aria-expanded','true');setTimeout(()=>$(id).querySelector('.close-btn')?.focus(),0);}
  function closeOverlay(id){$(id).hidden=true;if(id==='guide')els.guideBtn.setAttribute('aria-expanded','false');}
  function inputNumber(digit){state.numberBuffer=(state.numberBuffer+digit).slice(-2);els.numberInput.textContent=state.numberBuffer;els.numberInput.classList.add('visible');clearTimeout(state.numberTimer);state.numberTimer=setTimeout(()=>{const n=Number(state.numberBuffer);state.numberBuffer='';els.numberInput.classList.remove('visible');const c=state.channels.find(x=>x.number===n);if(c)selectById(c.id);},900);}

  $('upBtn').addEventListener('click',()=>changeChannel(1)); $('downBtn').addEventListener('click',()=>changeChannel(-1)); $('prevBtn').addEventListener('click',()=>{if(state.previous!==null)selectById(state.channels[state.previous].id);});
  $('playBtn').addEventListener('click',()=>{if(!state.playerReady){buildPlayer();return;}try{state.player.playVideo();}catch{buildPlayer();}}); els.retryBtn.addEventListener('click',()=>{state.retryCount=0;buildPlayer();});
  els.muteBtn.addEventListener('click',toggleMute); els.volume.addEventListener('input',e=>{state.volume=Number(e.target.value);if(state.playerReady){try{state.player.setVolume(state.volume);if(state.volume&&state.muted){state.muted=false;state.player.unMute();updateMuteButton();}}catch{}}savePrefs();});
  els.favoriteBtn.addEventListener('click',toggleFavorite); $('fullscreenBtn').addEventListener('click',()=>{const target=$('tvScreen');if(!document.fullscreenElement)target.requestFullscreen?.();else document.exitFullscreen?.();});
  els.guideBtn.addEventListener('click',()=>openOverlay('guide')); $('infoBtn').addEventListener('click',()=>openOverlay('infoPanel')); document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeOverlay(b.dataset.close)));
  els.favoritesFilter.addEventListener('click',()=>{state.favoritesOnly=!state.favoritesOnly;els.favoritesFilter.setAttribute('aria-pressed',String(state.favoritesOnly));renderChannels();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeOverlay('guide');closeOverlay('infoPanel');return;}if(!els.guide.hidden||!els.infoPanel.hidden)return;if(e.target instanceof HTMLInputElement)return;if(e.key==='ArrowUp'){e.preventDefault();changeChannel(1);}else if(e.key==='ArrowDown'){e.preventDefault();changeChannel(-1);}else if(e.key.toLowerCase()==='m'){toggleMute();}else if(e.key.toLowerCase()==='f'){$('fullscreenBtn').click();}else if(e.key==='Enter'){openOverlay('guide');}else if(/^\d$/.test(e.key)){inputNumber(e.key);}});
  document.addEventListener('mousemove',showOsd,{passive:true});
  window.onYouTubeIframeAPIReady=()=>{if(state.channels.length)attachPlayer();};

  async function init(){loadPrefs();updateClock();setInterval(updateClock,30000);try{const res=await fetch('channels.json',{cache:'no-store'});if(!res.ok)throw new Error('manifest');const data=await res.json();state.channels=data.channels.filter(validChannel).sort((a,b)=>a.number-b.number);if(state.channels.length<10)throw new Error(`catalog: ${state.channels.length} valid channels`);const last=localStorage.getItem('bbtv:lastChannel');const saved=state.channels.findIndex(c=>c.id===last);state.selected=saved>=0?saved:0;renderCategories();updateChrome();buildPlayer();}catch(error){console.error('Bigbools TV initialization failed:',error);showSignal('CATALOG UNAVAILABLE','The verified channel manifest could not be loaded.',true);setStatus('UNAVAILABLE','error');}}
  init();
})();
