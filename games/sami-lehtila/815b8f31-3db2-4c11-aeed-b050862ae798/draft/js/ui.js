"use strict";
/* ============================================================
   ui.js — tehosteet: banneri, konfetti, ponnahtavat pisteet ja äänet.
   Pistetaulukko ja ohjaimet ovat js/mp-ui.js:ssä.
   ============================================================ */
window.UI = (function () {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s){ return s.replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

  /* ---------- Äänet (WebAudio-syntetisointi) ---------- */
  let AC=null;
  let soundEnabled=true; /* asetuksista, ks. js/mp-settings.js */
  function setSoundEnabled(v){ soundEnabled=!!v; }
  function audio(){ if(!AC){ try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){} } return AC; }
  function soundOn(){ return soundEnabled; }
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
  return {
    esc, clack, chime, sndScore, sndBig, sndYatzy, sndHold, setSoundEnabled,
    showBanner, burst, drawFx, popScore,
    PALETTE: window.RoomRules.PALETTE,
  };
})();
