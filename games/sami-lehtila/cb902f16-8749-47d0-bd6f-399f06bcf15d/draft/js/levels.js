'use strict';
// Level data and derived geometry. Shapes are cut out of solid rock; rocks, walls and pad blocks are put back.
const LEVELS = [
  {name:'Lift-off', w:1600, h:1000,
   rooms:[{x:800,y:540,rx:620,ry:340,wob:0.08,seed:21}],
   corridors:[],
   rocks:[{x:800,y:880,r:95,seed:22}], walls:[],
   pads:{start:{x:230,y:820,w:120,h:100}, target:{x:1250,y:820,w:120,h:100}}},
  {name:'Two rooms', w:2000, h:1200,
   rooms:[{x:450,y:850,rx:320,ry:230,wob:0.1,seed:31}, {x:1450,y:450,rx:380,ry:260,wob:0.1,seed:32}],
   corridors:[{pts:[[700,760],[860,700],[1000,600],[1150,520]],w:170}],
   rocks:[], walls:[],
   pads:{start:{x:380,y:1000,w:120,h:100}, target:{x:1450,y:640,w:120,h:100}}},
  {name:'The climb', w:1800, h:2000,
   rooms:[{x:500,y:1700,rx:350,ry:200,wob:0.1,seed:41}, {x:1200,y:400,rx:360,ry:220,wob:0.1,seed:42}],
   corridors:[{pts:[[700,1620],[850,1450],[900,1300],[780,1150],[700,1000],[800,830],[900,700],[1000,600],[1100,520]],w:180}],
   rocks:[], walls:[],
   pads:{start:{x:420,y:1820,w:120,h:100}, target:{x:1200,y:560,w:120,h:100}}},
  {name:'Cavern', w:2600, h:1500,
   rooms:[{x:420,y:1180,rx:300,ry:210,wob:0.1,seed:1}, {x:1150,y:500,rx:360,ry:240,wob:0.12,seed:2}, {x:2050,y:760,rx:380,ry:310,wob:0.11,seed:3}, {x:2300,y:230,rx:190,ry:140,wob:0.09,seed:4}],
   corridors:[{pts:[[640,1080],[760,980],[880,880],[940,790],[1000,700]],w:160}, {pts:[[1480,520],[1610,540],[1740,600]],w:130}, {pts:[[600,1330],[950,1370],[1300,1380],[1550,1330],[1800,1260],[1920,1170],[2000,1080]],w:170}, {pts:[[2050,480],[2110,380],[2180,260]],w:140}],
   rocks:[{x:1040,y:590,r:48,seed:11}, {x:1310,y:410,r:38,seed:12}, {x:1900,y:820,r:60,seed:13}, {x:2180,y:640,r:44,seed:14}], walls:[],
   pads:{start:{x:360,y:1320,w:120,h:100}, target:{x:2245,y:330,w:110,h:100}}},
  {name:'Pillars', w:3000, h:1600,
   rooms:[{x:400,y:800,rx:300,ry:230,wob:0.1,seed:51}, {x:1500,y:800,rx:720,ry:460,wob:0.08,seed:52}, {x:2620,y:480,rx:300,ry:220,wob:0.1,seed:53}],
   corridors:[{pts:[[650,800],[750,780],[850,800]],w:180}, {pts:[[2150,700],[2280,640],[2420,560]],w:130}],
   rocks:[{x:1150,y:700,r:50,seed:54}, {x:1400,y:950,r:60,seed:55}, {x:1550,y:620,r:44,seed:56}, {x:1800,y:850,r:56,seed:57}, {x:1300,y:480,r:36,seed:60}], walls:[],
   pads:{start:{x:340,y:950,w:120,h:100}, target:{x:2580,y:660,w:120,h:100}}},
  {name:'Undercroft', w:3400, h:1700,
   rooms:[{x:380,y:1250,rx:300,ry:220,wob:0.1,seed:71}, {x:1250,y:900,rx:520,ry:380,wob:0.1,seed:72}, {x:2250,y:650,rx:480,ry:330,wob:0.1,seed:73}, {x:3000,y:1150,rx:300,ry:230,wob:0.1,seed:74}],
   corridors:[{pts:[[620,1150],[760,1080],[900,1000],[1000,950]],w:180}, {pts:[[1650,760],[1780,700],[1900,660],[2000,640]],w:170}, {pts:[[2550,850],[2650,950],[2760,1050],[2850,1120]],w:160}, {pts:[[1500,1200],[1700,1350],[1950,1420],[2250,1400],[2550,1330],[2800,1250]],w:160}],
   rocks:[{x:1150,y:850,r:58,seed:75}, {x:1400,y:1050,r:48,seed:76}, {x:2150,y:600,r:54,seed:77}, {x:2380,y:780,r:42,seed:78}, {x:1250,y:600,r:40,seed:79}], walls:[],
   pads:{start:{x:320,y:1400,w:120,h:100}, target:{x:2960,y:1310,w:120,h:100}}},
  {name:'The chimney', w:1800, h:3600,
   rooms:[{x:600,y:3300,rx:380,ry:220,wob:0.1,seed:81}, {x:1250,y:2650,rx:260,ry:200,wob:0.1,seed:82}, {x:500,y:1950,rx:280,ry:210,wob:0.1,seed:83}, {x:1200,y:1250,rx:260,ry:200,wob:0.1,seed:84}, {x:650,y:550,rx:380,ry:240,wob:0.1,seed:85}],
   corridors:[{pts:[[850,3200],[1000,3050],[1100,2900],[1180,2780]],w:190}, {pts:[[1100,2500],[950,2350],[750,2200],[600,2100]],w:180}, {pts:[[650,1800],[800,1650],[1000,1500],[1150,1380]],w:175}, {pts:[[1100,1100],[950,950],[800,800],[700,700]],w:170}],
   rocks:[{x:1230,y:2620,r:34,seed:86}, {x:520,y:1930,r:36,seed:87}, {x:1180,y:1230,r:32,seed:88}], walls:[],
   pads:{start:{x:540,y:3460,w:120,h:100}, target:{x:600,y:730,w:120,h:100}}},
  {name:'Switchback', w:2200, h:2600,
   rooms:[{x:400,y:300,rx:300,ry:200,wob:0.1,seed:61}, {x:1850,y:700,rx:260,ry:200,wob:0.1,seed:62}, {x:400,y:1250,rx:260,ry:200,wob:0.1,seed:63}, {x:1850,y:1800,rx:260,ry:200,wob:0.1,seed:64}, {x:500,y:2300,rx:300,ry:200,wob:0.1,seed:65}],
   corridors:[{pts:[[600,380],[900,430],[1200,500],[1450,570],[1650,620]],w:170}, {pts:[[1750,860],[1450,950],[1100,1030],[800,1090],[500,1120]],w:160}, {pts:[[500,1400],[800,1470],[1150,1560],[1450,1630],[1750,1680]],w:150}, {pts:[[1750,1960],[1450,2040],[1100,2130],[850,2200],[700,2240]],w:145}],
   rocks:[{x:1100,y:530,r:30,seed:66}, {x:1150,y:1450,r:28,seed:67}], walls:[],
   pads:{start:{x:340,y:440,w:120,h:100}, target:{x:450,y:2440,w:120,h:100}}},
  {name:'Serpent', w:3600, h:2200,
   rooms:[{x:350,y:1800,rx:300,ry:220,wob:0.1,seed:91}, {x:1600,y:400,rx:280,ry:200,wob:0.1,seed:92}, {x:3200,y:600,rx:280,ry:200,wob:0.1,seed:93}],
   corridors:[{pts:[[550,1700],[750,1600],[900,1500],[800,1350],[700,1200],[900,1050],[1100,900],[1300,1000],[1500,1100],[1700,950],[1900,800],[1800,650],[1700,520]],w:150}, {pts:[[1800,450],[2050,570],[2300,700],[2200,900],[2100,1100],[2350,1250],[2600,1400],[2800,1300],[3000,1200],[3080,950],[3150,700]],w:140}],
   rocks:[{x:1560,y:420,r:30,seed:94}, {x:3230,y:570,r:26,seed:95}], walls:[],
   pads:{start:{x:290,y:1940,w:120,h:100}, target:{x:3240,y:740,w:120,h:100}}},
  {name:'Into the deep', w:4000, h:2600,
   rooms:[{x:400,y:350,rx:320,ry:220,wob:0.1,seed:101}, {x:1600,y:600,rx:450,ry:300,wob:0.09,seed:102}, {x:2900,y:1000,rx:700,ry:380,wob:0.07,seed:103}, {x:2200,y:2000,rx:600,ry:350,wob:0.1,seed:104}, {x:900,y:2300,rx:350,ry:220,wob:0.1,seed:105}],
   corridors:[{pts:[[650,450],[900,480],[1100,520],[1260,540]],w:170}, {pts:[[2000,700],[2120,800],[2250,900]],w:130}, {pts:[[3400,1200],[3350,1400],[3300,1600],[3050,1800],[2650,1950]],w:150}, {pts:[[1700,2100],[1450,2200],[1180,2330]],w:130}],
   rocks:[{x:1500,y:650,r:50,seed:106}, {x:1750,y:500,r:40,seed:107}, {x:2100,y:2050,r:60,seed:108}, {x:2350,y:1900,r:45,seed:109}, {x:2050,y:1850,r:38,seed:110}, {x:2650,y:900,r:70,seed:111}, {x:2950,y:1150,r:60,seed:112}, {x:3150,y:850,r:54,seed:113}, {x:2800,y:1250,r:44,seed:114}], walls:[],
   pads:{start:{x:330,y:470,w:120,h:160}, target:{x:830,y:2440,w:120,h:100}}},
];
let L = LEVELS[0], PADS, G, ZONES;
// Corridors are chains of overlapping blobs, so tunnels vary in width and never run dead straight.
function corridorBlobs(cr, idx){
  const r = rng(idx*101+7), out = [], w = cr.w, step = w*0.45, pts = cr.pts;
  for (let i=0;i<pts.length-1;i++){
    const [x0,y0] = pts[i], [x1,y1] = pts[i+1], len = Math.hypot(x1-x0,y1-y0), n = Math.max(1, Math.ceil(len/step));
    for (let j=0;j<=n;j++){ if (i>0 && j===0) continue; const t = j/n, rad = w/2*(0.85+0.35*r()); out.push(polyPts(x0+(x1-x0)*t, y0+(y1-y0)*t, rad, rad, 0.12, Math.floor(r()*1e6))); }
  }
  return out;
}
function setGeom(){
  PADS = Object.values(L.pads);
  const rooms = L.rooms.map(r => polyPts(r.x,r.y,r.rx,r.ry,r.wob,r.seed));
  G = {
    rooms,
    caves: rooms.concat(...L.corridors.map(corridorBlobs)),
    rocks: L.rocks.map(r => ({cx:r.x,cy:r.y,r:r.r,pts:polyPts(r.x,r.y,r.r,r.r,0.18,r.seed)})),
    clear: PADS.map(p => [p.x-34, p.y-190, p.w+68, 190]),
    blocks: PADS.map(p => [p.x-14, p.y, p.w+28, p.h||100]),
  };
  ZONES = Object.entries(L.pads).map(([key,p]) => ({key, x:p.x-14, w:p.w+28, y:p.y}));   // landing zones span the whole block top
}
