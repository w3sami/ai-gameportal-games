"use strict";
/* ============================================================
   scoring.js — Yatzy-pisteytys (pohjoismainen)
   Puhdas moduuli: ei DOM-riippuvuuksia, ei fysiikkaa.
   Käytössä sekä selaimessa (globaali <script>) että
   palvelimella (require()) — palvelin laskee pisteet itse
   eikä luota asiakkaan lähettämiin lukuihin.
   ============================================================ */
(function (root) {

  /* ---------- Kategoriat ---------- */
  const UPPER = [
    {id:'ones',   name:'Ykköset',  n:1},
    {id:'twos',   name:'Kakkoset', n:2},
    {id:'threes', name:'Kolmoset', n:3},
    {id:'fours',  name:'Neloset',  n:4},
    {id:'fives',  name:'Viitoset', n:5},
    {id:'sixes',  name:'Kuutoset', n:6},
  ];
  const LOWER = [
    {id:'pair',     name:'Pari'},
    {id:'twopairs', name:'Kaksi paria'},
    {id:'three',    name:'Kolme samaa'},
    {id:'four',     name:'Neljä samaa'},
    {id:'small',    name:'Pieni suora'},
    {id:'large',    name:'Suuri suora'},
    {id:'full',     name:'Täyskäsi'},
    {id:'chance',   name:'Sattuma'},
    {id:'yatzy',    name:'YATZY'},
  ];
  /* 6 nopan variantin voittoluokat */
  const LOWER6 = [
    {id:'pair',       name:'Pari'},
    {id:'twopairs',   name:'Kaksi paria'},
    {id:'threepairs', name:'3× pari'},
    {id:'three',      name:'Kolme samaa'},
    {id:'twotriples', name:'2× kolme samaa'},
    {id:'four',       name:'Neljä samaa'},
    {id:'small',      name:'Pieni suora'},
    {id:'large',      name:'Suuri suora'},
    {id:'straight6',  name:'Täyssuora 1–6'},
    {id:'full',       name:'Täyskäsi'},
    {id:'bighouse',   name:'Iso mökki (4+2)'},
    {id:'chance',     name:'Sattuma'},
    {id:'yatzy',      name:'YATZY (5)'},
    {id:'yatzy6',     name:'SUUR-YATZY (6)'},
  ];

  /* moduulin sisäinen tila: kumpi variantti on voimassa OLETUKSENA.
     Yksinpeli (selain) kutsuu näitä funktioita ilman parametria ja nojaa
     tähän jaettuun tilaan (game-logic.js: setSixMode/getSixMode).
     Palvelin (rooms.js) sen sijaan välittää `six`-parametrin EKSPLISIITTISESTI
     joka kutsussa, koska sama Node-prosessi ajaa useita huoneita YHTÄAIKAA,
     joilla voi olla eri variantti — jaettuun moduulitilaan ei silloin voi
     luottaa (se aiheuttaisi huoneiden välistä sääntövuotoa). `six ?? sixMode`
     tekee tästä taaksepäin yhteensopivan: parametri voitettaessa jaettu tila. */
  let sixMode = false;
  function setSixMode(v) { sixMode = !!v; }
  function getSixMode() { return sixMode; }

  const lowerCats = (six) => (six ?? sixMode) ? LOWER6 : LOWER;
  const allCats   = (six) => [...UPPER, ...lowerCats(six)];
  const upperBase = (six) => (six ?? sixMode) ? 4 : 3;   /* 0-pohjaisen pari: montako samaa = 0 */
  const bonusLimit= (six) => (six ?? sixMode) ? 84 : 63; /* 4×(1+…+6)=84 */

  function counts(d) { const c = [0,0,0,0,0,0,0]; d.forEach(v=>c[v]++); return c; }

  function scoreCat(id, dice) {
    const c = counts(dice), sum = dice.reduce((a,b)=>a+b,0);
    const up = UPPER.find(u=>u.id===id);
    if (up) return c[up.n]*up.n;
    switch(id){
      case 'pair': for(let v=6;v>=1;v--) if(c[v]>=2) return v*2; return 0;
      case 'twopairs': {
        const pairs=[]; for(let v=6;v>=1;v--) if(c[v]>=2) pairs.push(v);
        return pairs.length>=2 ? pairs[0]*2+pairs[1]*2 : 0;
      }
      case 'three': for(let v=6;v>=1;v--) if(c[v]>=3) return v*3; return 0;
      case 'four':  for(let v=6;v>=1;v--) if(c[v]>=4) return v*4; return 0;
      case 'small': return [1,2,3,4,5].every(v=>c[v]>=1) ? 15 : 0;
      case 'large': return [2,3,4,5,6].every(v=>c[v]>=1) ? 20 : 0;
      case 'full': {
        let t=0,p=0;
        for(let v=6;v>=1;v--){ if(c[v]>=3 && !t) t=v; }
        for(let v=6;v>=1;v--){ if(v!==t && c[v]>=2) p=v; }
        return (t&&p) ? t*3+p*2 : 0;
      }
      case 'chance': return sum;
      case 'yatzy': for(let v=1;v<=6;v++) if(c[v]>=5) return 50; return 0;
      case 'yatzy6': for(let v=1;v<=6;v++) if(c[v]===6) return 100; return 0;
      case 'straight6': return [1,2,3,4,5,6].every(v=>c[v]>=1) ? 21 : 0;
      case 'threepairs': {
        const pr=[];
        for(let v=6;v>=1;v--){
          if(c[v]>=6) pr.push(v,v,v);      /* kuusi samaa = kolme paria */
          else if(c[v]>=4) pr.push(v,v);   /* neljä samaa = kaksi paria */
          else if(c[v]>=2) pr.push(v);
        }
        return pr.length>=3 ? (pr[0]+pr[1]+pr[2])*2 : 0;
      }
      case 'twotriples': {
        const tr=[];
        for(let v=6;v>=1;v--){
          if(c[v]>=6) tr.push(v,v);       /* kuusi samaa = kaksi kolmoislukua */
          else if(c[v]>=3) tr.push(v);
        }
        return tr.length>=2 ? (tr[0]+tr[1])*3 : 0;
      }
      case 'bighouse': {
        for(let f=6;f>=1;f--){
          if(c[f]>=4){
            if(c[f]>=6) return f*6;       /* 6 samaa käy 4+2:na */
            for(let p=6;p>=1;p--) if(p!==f && c[p]>=2) return f*4+p*2;
          }
        }
        return 0;
      }
    }
    return 0;
  }

  const upperSum = sc => UPPER.reduce((a,u)=>a+(sc[u.id]??0),0);
  const bonusOf  = (sc, six) => upperSum(sc)>=bonusLimit(six) ? 50 : 0;
  const totalOf  = (sc, six) => allCats(six).reduce((a,k)=>a+(sc[k.id]??0),0) + bonusOf(sc, six);
  const scFull   = (sc, six) => allCats(six).every(c=>sc[c.id]!==undefined);
  const playerTotal = (p, six) => p.scs.reduce((a,s)=>a+totalOf(s, six),0);

  const api = {
    UPPER, LOWER, LOWER6,
    setSixMode, getSixMode,
    lowerCats, allCats, upperBase, bonusLimit,
    counts, scoreCat, upperSum, bonusOf, totalOf, scFull, playerTotal,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; /* Node (server) */
  } else {
    root.Scoring = api;   /* selain (globaali) */
  }

})(typeof window !== 'undefined' ? window : globalThis);
