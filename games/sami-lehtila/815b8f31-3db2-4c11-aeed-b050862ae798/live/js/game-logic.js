"use strict";
/* ============================================================
   game-logic.js — vuorot, pisteiden merkintä, asetukset ja
   tallennus. Käyttää Dice3D:tä nopan heittoon/lukitukseen ja
   Scoring:ia pisteiden laskentaan, UI:ta piirtoon.
   Tämä on YKSINPELIN (offline) sääntömoottori.
   ============================================================ */
window.GameLogic = (function () {
  const S = () => window.Scoring;
  const D3 = () => window.Dice3D;

  const state = {
    players: [], current: 0, rollsUsed: 0, gameOver: true,
    gameCols: 1, lastMove: null, celebratedCats: new Set(),
    armed: false,
    settings: { nudge:false, sound:true, shakeRoll:false, devUpper:true, bank:false, parkHeld:true, twoCol:false, sixDice:false },
  };

  /* ---------- Tallennuskerros: window.storage → localStorage → muisti ---------- */
  const memStore={};
  const store={
    async get(key){
      try{ const r=await window.storage.get(key); if(r && r.value!==undefined && r.value!==null) return r.value; }catch(e){}
      try{ const v=localStorage.getItem(key); if(v!==null) return v; }catch(e){}
      return memStore[key];
    },
    async set(key,val){
      try{ await window.storage.set(key,val); }catch(e){}
      try{ localStorage.setItem(key,val); }catch(e){}
      memStore[key]=val;
    },
    async del(key){
      try{ await window.storage.delete(key); }catch(e){}
      try{ localStorage.removeItem(key); }catch(e){}
      delete memStore[key];
    }
  };

  async function loadSettings(){
    try{
      const v = await store.get('yatzy-settings');
      if(v) Object.assign(state.settings, JSON.parse(v));
    }catch(e){}
    if(!state.settings._m2){
      state.settings.nudge=false; state.settings.devUpper=true; state.settings._m2=true;
      saveSettings();
    }
    window.UI.applySettingsUI(state.settings);
    D3().configure({nudge:state.settings.nudge, parkHeld:state.settings.parkHeld, sound:state.settings.sound});
    if(state.settings.shakeRoll) enableMotion(false);
  }
  async function saveSettings(){ await store.set('yatzy-settings', JSON.stringify(state.settings)); }

  let savedGame=null;
  async function saveGame(){
    try{
      if(state.gameOver || !state.players.length){ await store.del('yatzy-game'); return; }
      const g={
        v:1, ts:Date.now(), current:state.current, gameCols:state.gameCols, gameSix:S().getSixMode(),
        players:state.players.map(p=>({name:p.name, color:p.color, bank:p.bank||0, scs:p.scs,
                                 hideUsed:!!p.hideUsed, ownCols:!!p.ownCols}))
      };
      await store.set('yatzy-game', JSON.stringify(g));
    }catch(e){}
  }
  async function loadSavedGame(){
    try{
      const v=await store.get('yatzy-game');
      if(v){ const g=JSON.parse(v); if(g && g.players && g.players.length) savedGame=g; }
    }catch(e){}
    const resumeBtn=document.getElementById('resumeBtn');
    if(savedGame){
      const names=savedGame.players.map(p=>p.name).join(' vs ');
      resumeBtn.textContent='▶ Jatka tallennettua peliä ('+names+')';
      resumeBtn.classList.add('show');
    }
  }
  function resumeGame(){
    if(!savedGame) return;
    state.gameCols=savedGame.gameCols||1;
    S().setSixMode(!!savedGame.gameSix);
    D3().setActiveDiceCount(S().getSixMode()?6:5);
    state.players=savedGame.players.map(p=>({
      name:p.name, color:p.color||'#ffffff', bank:p.bank||0,
      scs:p.scs.map(sc=>({...sc})), flash:null,
      hideUsed:!!p.hideUsed, ownCols:!!p.ownCols
    }));
    state.current=Math.min(savedGame.current||0, state.players.length-1);
    state.rollsUsed=0; state.gameOver=false; state.lastMove=null;
    state.celebratedCats=new Set();
    D3().applyColor(state.players[state.current].color);
    document.getElementById('cancelStart').classList.remove('show');
    document.getElementById('startOverlay').style.display='none';
    document.getElementById('winnerOverlay').style.display='none';
    refresh();
  }

  function refresh(){
    window.UI.updateControls();
    window.UI.renderTable(pickCategory);
    window.UI.setHint(pickCategory);
  }

  function bankAvailable(){
    return state.settings.bank && state.players[state.current] && (state.players[state.current].bank||0)>0;
  }
  function canRoll(){
    return !D3().isRolling() && !state.gameOver && !(state.rollsUsed>=3 && !bankAvailable()) && state.players.length;
  }

  function doThrow(power){
    if(!canRoll()) return;
    const useBank = state.rollsUsed>=3;
    if(useBank && !bankAvailable()) return;
    disarmShake();
    state.lastMove=null;
    if(useBank) state.players[state.current].bank--; else state.rollsUsed++;
    refresh();
    D3().throwDice(power);
  }

  let celebComboIds = ['yatzy','large','small','full','four'];
  function onSettled(diceValues){
    refresh();
    const p=state.players[state.current];
    if(!p) return;
    const open=id=>p.scs.some(sc=>sc[id]===undefined);
    const bankBoost = state.settings.bank ? Math.max(0,3-state.rollsUsed)*10 : 0;
    const comboIds = S().getSixMode()
      ? ['yatzy6','yatzy','straight6','large','small','bighouse','full','twotriples','threepairs','four']
      : ['yatzy','large','small','full','four'];
    const hits = comboIds
      .map(id=>({id, pts:S().scoreCat(id,diceValues)}))
      .filter(h=>h.pts>0 && open(h.id) && !state.celebratedCats.has(h.id));
    if(!hits.length) return;
    hits.forEach(h=>state.celebratedCats.add(h.id));
    const best=Math.max(...hits.map(h=>h.pts));
    const eff=best+bankBoost;
    const UI=window.UI;
    if(hits.some(h=>h.id==='yatzy6')){
      UI.showBanner('SUUR-YATZY!'); UI.sndYatzy();
      UI.burst(Math.min(200+eff, 320), true); D3().shakeCamera(18);
    } else if(hits.some(h=>h.id==='yatzy')){
      UI.showBanner('YATZY!'); UI.sndYatzy();
      UI.burst(Math.min(140+eff, 260), true); D3().shakeCamera(14);
    } else {
      UI.burst(Math.min(25+eff*1.6, 130), false);
      if(eff>=45) UI.sndYatzy(); else if(eff>=25) UI.sndBig(); else UI.sndScore();
      D3().shakeCamera(Math.min(4+eff/8, 10));
    }
  }

  function pickCategory(id, col, td){
    if(!D3().isSettled() || state.gameOver) return;
    const p=state.players[state.current];
    const sc=p.scs[col];
    if(!sc || sc[id]!==undefined) return;
    const diceValues=D3().getValues();
    const pts=S().scoreCat(id,diceValues);
    const UI=window.UI;
    const bankAdded = state.settings.bank ? Math.max(0, 3-state.rollsUsed) : 0;
    p.bank = (p.bank||0) + bankAdded;
    state.lastMove={ pi:state.current, col, cat:id, rolls:state.rollsUsed, bankAdded,
               dv:[...diceValues], held:Array.from({length:diceValues.length},(_,i)=>D3().getHeld(i)) };
    sc[id]=pts;
    p.flash=col+':'+id;
    if(bankAdded>0 && td){
      const r0=td.getBoundingClientRect();
      UI.popScore('💰+'+bankAdded, r0.left+r0.width/2, r0.top-34);
    }
    if(td){
      const r=td.getBoundingClientRect();
      if(pts>0){
        UI.popScore('+'+pts, r.left+r.width/2, r.top);
        const eff=pts+bankAdded*10;
        if(id==='yatzy6'&&pts===100){ UI.showBanner('SUUR-YATZY! +100'); UI.sndYatzy(); UI.burst(Math.min(200+eff,320),true); D3().shakeCamera(18); }
        else if(id==='yatzy'&&pts>=50){ UI.showBanner('YATZY! +50'); UI.sndYatzy(); UI.burst(Math.min(140+eff,260),true); D3().shakeCamera(14); }
        else if(eff>=20){ UI.sndBig(); UI.burst(Math.min(15+eff,110),false); }
        else UI.sndScore();
      }
    }
    nextTurn();
  }

  function nextTurn(){
    state.celebratedCats=new Set();
    D3().resetHeld();
    const done=state.players.every(p=>p.scs.every(sc=>S().scFull(sc)));
    if(done){ endGame(); return; }
    do { state.current=(state.current+1)%state.players.length; }
    while(state.players[state.current].scs.every(sc=>S().scFull(sc)));
    state.rollsUsed=0;
    D3().applyColor(state.players[state.current].color);
    refresh();
    saveGame();
    setTimeout(()=>{ state.players.forEach(p=>p.flash=null); },1100);
  }

  function endGame(){
    state.gameOver=true;
    refresh();
    const ranked=[...state.players].sort((a,b)=>S().playerTotal(b)-S().playerTotal(a));
    document.getElementById('winnerName').textContent=ranked[0].name;
    document.getElementById('winnerScore').textContent=S().playerTotal(ranked[0])+' pistettä';
    let listHtml;
    const esc=window.UI.esc;
    if(state.gameCols===2){
      let best={t:-1};
      state.players.forEach(p=>p.scs.forEach((sc,ci)=>{
        const t=S().totalOf(sc);
        if(t>best.t) best={t, name:p.name, ci};
      }));
      listHtml=`🏅 Paras sarake: <b>${esc(best.name)} ${best.ci===0?'I':'II'}</b> — ${best.t} p<br><br>`;
      listHtml+=ranked.map((p,i)=>
        `${i+1}. ${esc(p.name)} — <b>${S().playerTotal(p)}</b> (${S().totalOf(p.scs[0])} + ${S().totalOf(p.scs[1])})`
      ).join('<br>');
    } else {
      listHtml=ranked.map((p,i)=>`${i+1}. ${esc(p.name)} — <b>${S().playerTotal(p)}</b>`).join('<br>');
    }
    document.getElementById('finalList').innerHTML=listHtml;
    document.getElementById('winnerOverlay').style.display='flex';
    saveGame();
    window.UI.sndYatzy(); window.UI.burst(160,true);
  }

  /* ---------- Aloitus ---------- */
  let chosenCount=2;
  let chosenColors=['#ffffff','#ff6b5e','#6ea8ff','#ffd94d'];
  function buildStart(){
    window.UI.buildStartScreen(chosenCount, chosenColors,
      (n)=>{ chosenCount=n; buildStart(); },
      (i,col)=>{ chosenColors[i]=col; });
  }

  function startGame(){
    state.gameCols = state.settings.twoCol ? 2 : 1;
    const names = window.UI.nameInputValues();
    state.players = names.map((val,i)=>({
      name:val.trim()||('Pelaaja '+(i+1)), flash:null,
      scs:Array.from({length:state.gameCols},()=>({})),
      color:chosenColors[i]||'#ffffff', bank:0
    }));
    state.current=0; state.rollsUsed=0; state.gameOver=false;
    state.lastMove=null;
    document.getElementById('cancelStart').classList.remove('show');
    S().setSixMode(state.settings.sixDice);
    D3().setActiveDiceCount(state.settings.sixDice ? 6 : 5);
    state.celebratedCats=new Set();
    document.getElementById('resumeBtn').classList.remove('show');
    D3().applyColor(state.players[0].color);
    document.getElementById('startOverlay').style.display='none';
    document.getElementById('winnerOverlay').style.display='none';
    refresh();
    saveGame();
  }

  /* ---------- Peru edellinen merkintä ---------- */
  function undo(){
    if(!state.lastMove || D3().isRolling() || D3().isCharging()) return;
    const m=state.lastMove; state.lastMove=null;
    delete state.players[m.pi].scs[m.col][m.cat];
    state.players[m.pi].flash=null;
    state.players[m.pi].bank = Math.max(0, (state.players[m.pi].bank||0) - (m.bankAdded||0));
    state.current=m.pi; state.rollsUsed=m.rolls; state.gameOver=false;
    D3().applyColor(state.players[state.current].color);
    m.held.forEach((hh,i)=>{ if(D3().getHeld(i)!==hh) D3().toggleHeld(i); });
    document.getElementById('winnerOverlay').style.display='none';
    state.celebratedCats=new Set(
      ['yatzy6','yatzy','straight6','large','small','bighouse','full','twotriples','threepairs','four']
        .filter(id=>S().scoreCat(id,m.dv)>0)
    );
    window.UI.sndHold();
    refresh();
    saveGame();
  }

  /* ---------- Ravistusheitto (kiihtyvyysanturi) ---------- */
  let motionEnabled=false, shakeSamples=[], shakePeakAcc=0;
  function armShake(){
    state.armed=true;
    shakeSamples=[]; shakePeakAcc=0;
    document.getElementById('shakePrompt').classList.add('show');
    if(!motionEnabled) enableMotion(true);
    window.UI.updateControls();
  }
  function disarmShake(){
    if(!state.armed) return;
    state.armed=false;
    document.getElementById('shakePrompt').classList.remove('show');
  }
  function onMotion(e){
    if(!state.settings.shakeRoll || !state.armed) return;
    const a=e.accelerationIncludingGravity;
    if(!a || a.x===null) return;
    const mag=Math.sqrt(a.x*a.x+a.y*a.y+a.z*a.z);
    const excess=Math.abs(mag-9.81);
    if(excess>8){
      const now=Date.now();
      shakeSamples.push(now);
      shakePeakAcc=Math.max(shakePeakAcc, excess);
      shakeSamples=shakeSamples.filter(t=>now-t<900);
      window.UI.clack(excess/3);
      if(shakeSamples.length>=2){
        const power=1+Math.min(shakePeakAcc/25,1.2);
        shakeSamples=[]; shakePeakAcc=0;
        doThrow(power);
      }
    }
  }
  function enableMotion(fromGesture){
    const motionStatus=document.getElementById('motionStatus');
    if(motionEnabled){ motionStatus.textContent='Liikeanturi käytössä ✓'; return; }
    if(typeof DeviceMotionEvent==='undefined'){ motionStatus.textContent='Laite ei tue liikeanturia.'; return; }
    if(typeof DeviceMotionEvent.requestPermission==='function'){
      if(!fromGesture){ motionStatus.textContent='Napauta Ravistusheitto-kytkintä salliaksesi anturin.'; return; }
      DeviceMotionEvent.requestPermission().then(state2=>{
        if(state2==='granted'){
          addEventListener('devicemotion', onMotion);
          motionEnabled=true;
          motionStatus.textContent='Liikeanturi käytössä ✓ — ravista puhelinta heittääksesi!';
        } else motionStatus.textContent='Lupa anturiin evättiin.';
      }).catch(()=>{ motionStatus.textContent='Anturi estetty tässä ympäristössä — avaa tiedosto suoraan selaimessa.'; });
    } else {
      addEventListener('devicemotion', onMotion);
      motionEnabled=true;
      motionStatus.textContent='Liikeanturi käytössä ✓ — ravista puhelinta heittääksesi!';
    }
  }

  /* ---------- DOM-kytkennät ---------- */
  function wireDom(){
    const rollBtn=document.getElementById('rollBtn');
    rollBtn.addEventListener('pointerdown', ev=>{
      ev.preventDefault();
      if(state.settings.shakeRoll && !state.armed) return;
      if(!canRoll() || D3().isCharging()) return;
      D3().startCharge();
      window.UI.updateControls();
    });
    addEventListener('pointerup', ()=>{
      if(!D3().isCharging()) return;
      const useBank = state.rollsUsed>=3;
      if(useBank && !bankAvailable()){ D3().cancelCharge(); return; }
      disarmShake();
      state.lastMove=null;
      if(useBank) state.players[state.current].bank--; else state.rollsUsed++;
      refresh();
      D3().releaseCharge();
    });
    addEventListener('pointercancel', ()=>D3().cancelCharge());
    rollBtn.addEventListener('contextmenu', ev=>ev.preventDefault());
    rollBtn.addEventListener('click', ()=>{
      if(D3().isRolling() || D3().isCharging() || state.gameOver) return;
      if(state.rollsUsed>=3 && !bankAvailable()) return;
      if(state.settings.shakeRoll && !state.armed){ armShake(); return; }
    });

    document.getElementById('shakePrompt').addEventListener('click', ()=>doThrow(1));

    D3().onSettle(onSettled);

    /* nopan lukitus + tälli-napautus (kanvas) */
    document.querySelector('#canvasWrap canvas') || null; /* renderer canvas luodaan Dice3D.init:ssä */
    document.getElementById('canvasWrap').addEventListener('pointerdown', ev=>{
      if(D3().isCharging()) return;
      if(D3().isRolling()){
        if(!state.settings.nudge || !D3().isNudgeAvailable() || state.gameOver) return;
        if(D3().nudgeAt(ev.clientX, ev.clientY)){
          window.UI.popScore('TÄLLI!', ev.clientX, ev.clientY);
          D3().shakeCamera(5); window.UI.clack(6);
          window.UI.setHint(pickCategory);
        }
        return;
      }
      if(!D3().isSettled() || state.gameOver || state.rollsUsed===0 || (state.rollsUsed>=3 && !bankAvailable())) return;
      const i=D3().hitTestDie(ev.clientX, ev.clientY);
      if(i<0) return;
      D3().toggleHeld(i);
      window.UI.sndHold();
    });

    document.getElementById('undoBtn').addEventListener('click', undo);

    const newBtn=document.getElementById('newBtn');
    const cancelStart=document.getElementById('cancelStart');
    let confirmTimer=null;
    function resetNewBtn(){ newBtn.classList.remove('confirm'); newBtn.textContent='⟳'; }
    newBtn.addEventListener('click', ()=>{
      if(D3().isRolling() || D3().isCharging()) return;
      if(!state.gameOver && state.players.length && !newBtn.classList.contains('confirm')){
        newBtn.classList.add('confirm');
        newBtn.textContent='Uusi peli?';
        confirmTimer=setTimeout(resetNewBtn, 3000);
        return;
      }
      clearTimeout(confirmTimer);
      resetNewBtn();
      disarmShake();
      const inProgress = !state.gameOver && state.players.length;
      state.gameOver=true; window.UI.updateControls();
      cancelStart.classList.toggle('show', !!inProgress);
      document.getElementById('startOverlay').style.display='flex';
    });
    cancelStart.addEventListener('click', ()=>{
      document.getElementById('startOverlay').style.display='none';
      cancelStart.classList.remove('show');
      state.gameOver=false;
      refresh();
    });
    document.getElementById('resumeBtn').addEventListener('click', resumeGame);
    document.getElementById('closeWin').addEventListener('click', ()=>{
      document.getElementById('winnerOverlay').style.display='none';
    });
    document.getElementById('startBtn').addEventListener('click', startGame);
    document.getElementById('againBtn').addEventListener('click', ()=>{
      document.getElementById('winnerOverlay').style.display='none';
      document.getElementById('startOverlay').style.display='flex';
    });

    /* asetukset */
    const settingsOverlay=document.getElementById('settingsOverlay');
    document.getElementById('gearBtn').addEventListener('click', ()=>{
      window.UI.applySettingsUI(state.settings);
      settingsOverlay.style.display='flex';
    });
    document.getElementById('closeSettings').addEventListener('click', ()=>{ settingsOverlay.style.display='none'; });
    const bind=(id,key,after)=>document.getElementById(id).addEventListener('click', ()=>{
      state.settings[key]=!state.settings[key];
      window.UI.applySettingsUI(state.settings);
      saveSettings();
      if(after) after();
    });
    bind('swNudge','nudge', ()=>D3().configure({nudge:state.settings.nudge}));
    bind('swSound','sound', ()=>D3().configure({sound:state.settings.sound}));
    bind('swDev','devUpper', ()=>window.UI.renderTable(pickCategory));
    bind('swBank','bank', refresh);
    bind('swPark','parkHeld', ()=>D3().configure({parkHeld:state.settings.parkHeld}));
    bind('swTwoCol','twoCol');
    bind('swSix','sixDice');
    document.getElementById('swShake').addEventListener('click', ()=>{
      state.settings.shakeRoll=!state.settings.shakeRoll;
      window.UI.applySettingsUI(state.settings);
      saveSettings();
      if(state.settings.shakeRoll) enableMotion(true);
      else { document.getElementById('motionStatus').textContent=''; disarmShake(); window.UI.updateControls(); }
    });

    buildStart();
  }

  return {
    state, wireDom, loadSettings, loadSavedGame, saveGame, startGame, pickCategory, undo,
  };
})();
