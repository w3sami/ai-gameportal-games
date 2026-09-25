"use strict";
/* ============================================================
   ui.js — DOM-esitys: pistetaulukko, ohjaimet, ylivalinnat,
   banneri, konfetti ja äänet. Ei pelisääntöjä eikä fysiikkaa —
   lukee tilan GameLogic.state / Dice3D:stä ja piirtää sen.
   ============================================================ */
window.UI = (function () {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s){ return s.replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  /* ---------- Äänet (WebAudio-syntetisointi) ---------- */
  let AC=null;
  let soundEnabledFallback=true; /* käytössä kun GameLogic-moduulia ei ole (moninpeli) */
  function setSoundEnabled(v){ soundEnabledFallback=!!v; }
  function audio(){ if(!AC){ try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){} } return AC; }
  function soundOn(){ const gl=window.GameLogic; return gl ? gl.state.settings.sound : soundEnabledFallback; }
  let lastClick=0;
  function clack(strength){
    if(!soundOn()) return;
    const ctx=audio(); if(!ctx) return;
    const now=performance.now(); if(now-lastClick<40) return; lastClick=now;
    const t=ctx.currentTime;
    const o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
    o.type='triangle'; o.frequency.value=180+Math.random()*160;
    f.type='lowpass'; f.frequency.value=900;
    const v=Math.min(.22, strength*.05);
    g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(.0001,t+.09);
    o.connect(f); f.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t+.1);
  }
  function chime(freqs, dur=.5, vol=.15){
    if(!soundOn()) return;
    const ctx=audio(); if(!ctx) return;
    const t0=ctx.currentTime;
    freqs.forEach((fr,i)=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type='sine'; o.frequency.value=fr;
      const t=t0+i*.09;
      g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(vol,t+.02);
      g.gain.exponentialRampToValueAtTime(.0001,t+dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t+dur+.05);
    });
  }
  const sndScore  = ()=>chime([660,880],.35,.12);
  const sndBig    = ()=>chime([523,659,784,1047],.6,.16);
  const sndYatzy  = ()=>chime([523,659,784,1047,1319,1568],.9,.18);
  const sndHold   = ()=>chime([440],.15,.08);

  /* ---------- Banneri, tärinä, konfetti ---------- */
  const banner=document.getElementById('banner');
  function showBanner(t){
    document.getElementById('bannerText').textContent=t;
    banner.classList.remove('show'); void banner.offsetWidth;
    banner.classList.add('show');
    setTimeout(()=>banner.classList.remove('show'),2200);
  }
  const fxC=document.getElementById('fx'), fxG=fxC.getContext('2d');
  let parts=[];
  function burst(n, gold){
    if(REDUCED) n=Math.floor(n/4);
    const cols = gold ? ['#ffd66b','#e0a93d','#fff2c8','#f5efe0','#ffb347']
                      : ['#ffd66b','#7fc98f','#f5efe0'];
    for(let i=0;i<n;i++){
      parts.push({
        x:fxC.width/2+(Math.random()-.5)*fxC.width*.35,
        y:fxC.height*.42,
        vx:(Math.random()-.5)*11,
        vy:-4-Math.random()*9,
        g:.22+Math.random()*.1,
        s:3+Math.random()*5,
        r:Math.random()*6.3, vr:(Math.random()-.5)*.4,
        c:cols[Math.random()*cols.length|0],
        life:1, decay:.006+Math.random()*.008,
        shape:Math.random()<.5?0:1
      });
    }
  }
  function drawFx(){
    fxG.clearRect(0,0,fxC.width,fxC.height);
    parts=parts.filter(p=>p.life>0);
    parts.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vy+=p.g; p.vx*=.99; p.r+=p.vr; p.life-=p.decay;
      fxG.save();
      fxG.globalAlpha=Math.max(0,p.life);
      fxG.translate(p.x,p.y); fxG.rotate(p.r);
      fxG.fillStyle=p.c;
      if(p.shape) fxG.fillRect(-p.s/2,-p.s/2,p.s,p.s*.6);
      else { fxG.beginPath(); fxG.arc(0,0,p.s*.4,0,6.3); fxG.fill(); }
      fxG.restore();
    });
  }
  function popScore(txt,x,y){
    const el=document.createElement('div');
    el.className='popScore'; el.textContent=txt;
    el.style.left=(x-30)+'px'; el.style.top=(y-30)+'px';
    document.body.appendChild(el);
    setTimeout(()=>el.remove(),1500);
  }

  /* ---------- Pistetaulukko ---------- */
  const tableEl=document.getElementById('scoreTable');
  function renderTable(onPickCategory){
    const S = window.Scoring, GL = window.GameLogic.state, D3 = window.Dice3D;
    const players = GL.players, current = GL.current, gameOver = GL.gameOver, gameCols = GL.gameCols;
    if(!players.length) return;
    const settled = D3.isSettled(), diceValues = D3.getValues();
    const me=players[current]||{};
    const hideUsedNow = !gameOver && !!me.hideUsed;
    const ownMode     = !gameOver && !!me.ownCols;
    const entries=[];
    players.forEach((p,pi)=>{
      if(ownMode && pi!==current) return;
      p.scs.forEach((sc,ci)=>entries.push({p,pi,sc,ci}));
    });
    const sgn=x=>(x>0?'+':'')+x;
    const B=S.upperBase();
    const devTot=sc=>S.UPPER.reduce((a,u)=>a+(sc[u.id]!==undefined ? sc[u.id]-B*u.n : 0),0);

    const hdrBtns = gameOver ? '' :
      `<div class="hdrBtns">
        <button class="hdrBtn ${me.hideUsed?'on':''}" id="btnHideUsed" title="Piilota käytetyt rivit (pelaajakohtainen)">🙈</button>
        <button class="hdrBtn ${me.ownCols?'on':''}" id="btnOwnCols" title="Näytä vain omat sarakkeet (pelaajakohtainen)">👤</button>
      </div>`;

    let h='<thead>';
    const useTwoRows = gameCols===2;
    if(!useTwoRows){
      h+=`<tr><th>${hdrBtns}</th>`;
      entries.forEach(e=>{
        const p=e.p;
        const bankTag = GL.settings.bank && (p.bank||0)>0 ? ` <span class="devTag pos">💰${p.bank}</span>` : '';
        h+=`<th class="${e.pi===current&&!gameOver?'cur':''}"><span class="pdot" style="background:${p.color||'#fff'}"></span>${esc(p.name)}${bankTag}</th>`;
      });
      h+='</tr>';
    } else {
      const seen=new Set();
      h+=`<tr><th rowspan="2">${hdrBtns}</th>`;
      entries.forEach(e=>{
        if(seen.has(e.pi)) return; seen.add(e.pi);
        const p=e.p;
        const bankTag = GL.settings.bank && (p.bank||0)>0 ? ` <span class="devTag pos">💰${p.bank}</span>` : '';
        h+=`<th colspan="2" class="${e.pi===current&&!gameOver?'cur':''}"><span class="pdot" style="background:${p.color||'#fff'}"></span>${esc(p.name)}${bankTag}</th>`;
      });
      h+='</tr><tr>';
      entries.forEach(e=>{
        h+=`<th class="colHead ${e.pi===current&&!gameOver?'cur':''}">${e.ci===0?'I':'II'}</th>`;
      });
      h+='</tr>';
    }
    h+='</thead><tbody>';

    const cell=(e,cat,devMode)=>{
      const v=e.sc[cat.id];
      if(v!==undefined){
        const disp = devMode ? sgn(v-B*cat.n) : (v===0?'—':v);
        const flashed = e.p.flash===(e.ci+':'+cat.id);
        const fade = hideUsedNow && e.pi===current ? ' fadeUsed' : '';
        return `<td class="filled ${v===0&&!devMode?'zero':''} ${flashed?'justScored':''}${fade}">${disp}</td>`;
      } else if(e.pi===current && settled && !gameOver){
        const pot=S.scoreCat(cat.id,diceValues);
        const disp = devMode ? sgn(pot-B*cat.n) : (pot>0?pot:'');
        const cls = cat.n
          ? (pot-B*cat.n>=0 ? 'avail' : 'availzero')
          : (pot>=15 ? 'avail hot' : pot>0 ? 'avail' : 'availzero');
        return `<td class="${cls}" data-cat="${cat.id}" data-col="${e.ci}">${disp}</td>`;
      }
      return '<td></td>';
    };
    const row=(cat)=>{
      if(hideUsedNow && players[current].scs.every(sc=>sc[cat.id]!==undefined)) return '';
      const devMode = GL.settings.devUpper && !!cat.n;
      return `<tr><td>${cat.name}</td>${entries.map(e=>cell(e,cat,devMode)).join('')}</tr>`;
    };

    h+=`<tr class="section"><th>Yläkerta</th>${entries.map(()=>'<td></td>').join('')}</tr>`;
    if(ownMode){
      const grids=entries.map(e=>{
        const done=S.UPPER.every(u=>e.sc[u.id]!==undefined);
        if(hideUsedNow && done) return '';
        const tag = gameCols===2 ? `<div class="ucColTag">${e.ci===0?'I':'II'}</div>` : '';
        const cells=S.UPPER.map(u=>{
          const v=e.sc[u.id];
          const devMode=GL.settings.devUpper;
          if(v!==undefined){
            const t=devMode ? sgn(v-B*u.n) : (v===0?'—':v);
            return `<div class="ug filled${hideUsedNow?' fadeUsed':''}"><span class="n">${u.n}:</span><span>${t}</span></div>`;
          } else if(e.pi===current && settled && !gameOver){
            const pot=S.scoreCat(u.id,diceValues);
            const t=devMode ? sgn(pot-B*u.n) : (pot>0?pot:'');
            const cls = pot-B*u.n>=0 ? 'avail' : 'availzero';
            return `<div class="ug ${cls}" data-cat="${u.id}" data-col="${e.ci}"><span class="n">${u.n}:</span><span>${t}</span></div>`;
          }
          return `<div class="ug dim"><span class="n">${u.n}:</span></div>`;
        }).join('');
        return tag+`<div class="ucGrid">${cells}</div>`;
      }).join('');
      if(grids) h+=`<tr><td class="ucWrap" colspan="${entries.length+1}">${grids}</td></tr>`;
    } else {
      S.UPPER.forEach(c=>h+=row(c));
    }
    h+=`<tr class="sumRow"><td>Summa</td>${entries.map(e=>`<td>${S.upperSum(e.sc)} / ${S.bonusLimit()}</td>`).join('')}</tr>`;
    h+=`<tr class="bonusRow"><td>Bonus (+50)</td>${entries.map(e=>{
      const d=devTot(e.sc);
      const dTag=`<span class="devTag ${d>=0?'pos':'neg'}">${sgn(d)}</span>`;
      return `<td>${S.bonusOf(e.sc)||'–'} ${dTag}</td>`;
    }).join('')}</tr>`;
    h+=`<tr class="section"><th>Alakerta</th>${entries.map(()=>'<td></td>').join('')}</tr>`;
    S.lowerCats().forEach(c=>h+=row(c));
    h+=`<tr class="totalRow"><td>YHTEENSÄ</td>${entries.map(e=>`<td>${S.totalOf(e.sc)}</td>`).join('')}</tr>`;
    if(gameCols===2 && !ownMode){
      h+=`<tr class="totalRow"><td>YHT. I+II</td>${players.map(p=>`<td colspan="2">${S.playerTotal(p)}</td>`).join('')}</tr>`;
    }
    if(ownMode && gameCols===2){
      h+=`<tr class="totalRow"><td>YHT. I+II</td><td colspan="2">${S.playerTotal(players[current])}</td></tr>`;
    }
    if(ownMode && players.length>1){
      h+=`<tr class="section"><th>Kaikki pelaajat</th>${entries.map(()=>'<td></td>').join('')}</tr>`;
      players.forEach((p,pi)=>{
        h+=`<tr class="allTot"><td><span class="pdot" style="background:${p.color||'#fff'}"></span>${esc(p.name)}</td><td colspan="${entries.length}"><b>${S.playerTotal(p)}</b>${pi===current?' · vuorossa':''}</td></tr>`;
      });
    }
    h+='</tbody>';
    tableEl.innerHTML=h;
    tableEl.querySelectorAll('[data-cat]').forEach(el=>{
      el.addEventListener('click',()=>onPickCategory(el.dataset.cat, parseInt(el.dataset.col||'0',10), el));
    });
    const bh=document.getElementById('btnHideUsed');
    const bo=document.getElementById('btnOwnCols');
    if(bh) bh.addEventListener('click',()=>{ me.hideUsed=!me.hideUsed; renderTable(onPickCategory); window.GameLogic.saveGame(); });
    if(bo) bo.addEventListener('click',()=>{ me.ownCols=!me.ownCols; renderTable(onPickCategory); window.GameLogic.saveGame(); });
  }

  /* ---------- Pikavalinnat ---------- */
  const hintEl=document.getElementById('hint');
  const qpEl=document.getElementById('quickPicks');
  function renderQuickPicks(onPickCategory){
    const S = window.Scoring, GL = window.GameLogic.state, D3 = window.Dice3D;
    qpEl.innerHTML='';
    qpEl.classList.remove('show');
    hintEl.style.display='';
    const settled=D3.isSettled(), diceValues=D3.getValues();
    if(!settled || D3.isRolling() || D3.isCharging() || GL.gameOver || !GL.players.length) return;
    const p=GL.players[GL.current];
    const B=S.upperBase();
    const cands=[];
    const lowerOrder={}; S.lowerCats().forEach((c,i)=>lowerOrder[c.id]=100+i);
    const ord=id=> id==='yatzy6'?0 : id==='yatzy'?1 : lowerOrder[id];
    S.lowerCats().forEach(c=>{
      if(c.id==='chance') return;
      const pts=S.scoreCat(c.id,diceValues);
      if(pts<=0) return;
      p.scs.forEach((sc,ci)=>{
        if(sc[c.id]!==undefined) return;
        cands.push({id:c.id, label:c.name+' '+pts, pts, ci, ord:ord(c.id), blinkExtra:false});
      });
    });
    S.UPPER.forEach(u=>{
      const pts=S.scoreCat(u.id,diceValues);
      const d=pts-B*u.n;
      if(pts<=0 || d<0) return;
      const val = GL.settings.devUpper ? (d>0?'+':'')+d : pts;
      p.scs.forEach((sc,ci)=>{
        if(sc[u.id]!==undefined) return;
        cands.push({id:u.id, label:u.n+': '+val, pts, ci, ord:10+u.n, blinkExtra:d>0});
      });
    });
    cands.sort((a,b)=>a.ord-b.ord || a.ci-b.ci);
    const top=cands;
    if(!top.length) return;
    const FULLUSE=new Set(['small','large','straight6','full','bighouse','twotriples','threepairs','yatzy','yatzy6']);
    top.forEach(c=>{
      const el=document.createElement('button');
      const blink = FULLUSE.has(c.id) || c.pts>=20 || c.blinkExtra;
      el.className='qp'+(blink?' blink':'');
      el.textContent=c.label;
      if(GL.gameCols===2){
        const sup=document.createElement('span');
        sup.className='colSup';
        sup.textContent=c.ci===0?'I':'II';
        el.appendChild(sup);
      }
      el.addEventListener('click',()=>onPickCategory(c.id, c.ci, el));
      qpEl.appendChild(el);
    });
    qpEl.classList.add('show');
    hintEl.style.display='none';
  }

  function setHint(onPickCategory){
    const D3=window.Dice3D, GL=window.GameLogic.state;
    if(D3.isRolling() && D3.isNudgeAvailable() && GL.settings.nudge){
      hintEl.textContent='Napauta pöytää — tälli käytettävissä!';
      hintEl.classList.add('nudge');
    } else {
      hintEl.textContent='Heitä nopat • napauta noppaa lukitaksesi sen';
      hintEl.classList.remove('nudge');
    }
    renderQuickPicks(onPickCategory);
  }

  /* ---------- Ohjaimet ---------- */
  const rollBtn=document.getElementById('rollBtn');
  const rollsEl=document.getElementById('rollsLeft');
  const badge=document.getElementById('turnBadge');
  function updateControls(){
    const D3=window.Dice3D, GL=window.GameLogic.state;
    const bank = GL.settings.bank && GL.players[GL.current] && (GL.players[GL.current].bank||0)>0;
    const rollsUsed = GL.rollsUsed;
    rollBtn.disabled = D3.isRolling() || GL.gameOver || (rollsUsed>=3 && !bank);
    rollBtn.textContent = D3.isRolling() ? '…' :
      GL.armed ? 'RAVISTA! 🎲' :
      rollsUsed===0 ? 'HEITÄ NOPAT' :
      rollsUsed>=3 ? (bank ? `PANKKIHEITTO 💰${GL.players[GL.current].bank}` : 'VALITSE RIVI') :
      'HEITÄ UUDELLEEN';
    rollsEl.innerHTML='';
    for(let i=0;i<3;i++){
      const dot=document.createElement('div');
      dot.className='rollDot'+(i<rollsUsed?' used':'');
      rollsEl.appendChild(dot);
    }
    badge.textContent = GL.players.length ? (GL.gameOver?'Peli päättyi':esc(GL.players[GL.current].name)+' vuorossa') : '–';
    document.getElementById('undoBtn').classList.toggle('show', !!GL.lastMove && !D3.isRolling() && !D3.isCharging());
  }

  /* ---------- Aloitusruutu: pelaajamäärä, nimet, värit ---------- */
  const PALETTE=['#ffffff','#ff6b5e','#ffab4d','#ffd94d','#7fd98f','#5fd6d0','#6ea8ff','#c58bff'];
  function buildStartScreen(chosenCount, chosenColors, onCountChange, onColorChange){
    const segs=document.getElementById('playerCountSegs');
    const nameBox=document.getElementById('nameInputs');
    segs.innerHTML='';
    for(let n=1;n<=4;n++){
      const b=document.createElement('button');
      b.textContent=n;
      b.className=n===chosenCount?'on':'';
      b.addEventListener('click',()=>onCountChange(n));
      segs.appendChild(b);
    }
    const old=[...nameBox.querySelectorAll('input')].map(i=>i.value);
    nameBox.innerHTML='';
    for(let i=0;i<chosenCount;i++){
      const inp=document.createElement('input');
      inp.placeholder='Pelaaja '+(i+1);
      inp.value=old[i]||'';
      inp.maxLength=12;
      nameBox.appendChild(inp);
      const row=document.createElement('div');
      row.className='swatches';
      PALETTE.forEach(col=>{
        const s=document.createElement('div');
        s.className='sw'+(chosenColors[i]===col?' on':'');
        s.style.background=col;
        s.title=col;
        s.addEventListener('click',()=>{
          onColorChange(i,col);
          row.querySelectorAll('.sw').forEach(x=>x.classList.toggle('on', x===s));
        });
        row.appendChild(s);
      });
      nameBox.appendChild(row);
    }
  }
  function nameInputValues(){
    return [...document.getElementById('nameInputs').querySelectorAll('input')].map(i=>i.value);
  }

  /* ---------- Asetusvalikko ---------- */
  function applySettingsUI(settings){
    document.getElementById('swNudge').classList.toggle('on', settings.nudge);
    document.getElementById('swSound').classList.toggle('on', settings.sound);
    document.getElementById('swShake').classList.toggle('on', settings.shakeRoll);
    document.getElementById('swDev').classList.toggle('on', settings.devUpper);
    document.getElementById('swBank').classList.toggle('on', settings.bank);
    document.getElementById('swPark').classList.toggle('on', settings.parkHeld);
    document.getElementById('swTwoCol').classList.toggle('on', settings.twoCol);
    document.getElementById('swSix').classList.toggle('on', settings.sixDice);
  }

  return {
    esc, clack, chime, sndScore, sndBig, sndYatzy, sndHold, setSoundEnabled,
    showBanner, burst, drawFx, popScore,
    renderTable, renderQuickPicks, setHint, updateControls,
    buildStartScreen, nameInputValues, applySettingsUI,
    PALETTE,
  };
})();
