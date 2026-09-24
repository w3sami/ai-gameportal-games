'use strict';
// Chapter 2, last stretch. Kept in its own file so edits here can never collide with a whole-file write to levels2.js.
// Loaded after levels2.js, so it just appends to LEVELS.
LEVELS.push(
  {name:'Strangler', theme:'jungle', wallMat:'wood', w:2400, h:4550, groundY:4900, canopyY:-200,
   // the inside of a strangler fig whose host has rotted out: two strands of fused root braid down through the wood and
   // cross at every storey. Each crossing is a choice for the storey below. The tight side is a short shaft with root stubs
   // jutting from alternate walls past the middle, so you weave down it slowly; the wide side is a long sweep you can fly
   // fast, but it carries a gust or a dead branch. The sides swap every storey. You start at the top and fly down.
   rooms:[{x:1200,y:350,rx:420,ry:200,wob:0.08,seed:1201},
          {x:1200,y:1270,rx:200,ry:140,wob:0.1,seed:1202}, {x:1200,y:2220,rx:200,ry:140,wob:0.1,seed:1203}, {x:1200,y:3170,rx:200,ry:140,wob:0.1,seed:1204},
          {x:1200,y:4150,rx:480,ry:200,wob:0.08,seed:1205}],
   corridors:[
     // storey 1: wide left, gust across its drop | tight right
     {pts:[[850,480],[450,650],[350,950],[550,1180],[1080,1260]],w:240},
     {pts:[[1480,500],[1650,640]],w:220}, {pts:[[1650,620],[1650,1120]],w:380}, {pts:[[1650,1100],[1320,1250]],w:220},
     // storey 2: tight left | wide right, a dead branch over its top
     {pts:[[1080,1340],[750,1480]],w:220}, {pts:[[750,1460],[750,1980]],w:380}, {pts:[[750,1960],[1080,2150]],w:220},
     {pts:[[1350,1350],[1800,1450],[1950,1750],[1850,2050],[1330,2200]],w:240},
     // storey 3: wide left, headwind along its top | tight right
     {pts:[[1050,2320],[550,2450],[400,2750],[600,3050],[1080,3160]],w:240},
     {pts:[[1350,2300],[1650,2440]],w:220}, {pts:[[1650,2420],[1650,2940]],w:380}, {pts:[[1650,2920],[1320,3130]],w:220},
     // storey 4: tight left | wide right, a dead branch over it; both into the landing chamber
     {pts:[[1080,3290],[750,3420]],w:220}, {pts:[[750,3400],[750,3920]],w:380}, {pts:[[750,3900],[950,4040]],w:220},
     {pts:[[1350,3270],[1750,3450],[1850,3750],[1600,4020]],w:240}],
   rocks:[],
   // root stubs in the tight shafts, alternate walls, each reaching past the middle
   spikes:[{x:1900,y:780,tx:1586,ty:790,w:90,seed:1220,kind:'branch'}, {x:1400,y:1000,tx:1681,ty:1010,w:90,seed:1221,kind:'branch'},
           {x:500,y:1620,tx:793,ty:1630,w:90,seed:1222,kind:'branch'}, {x:1000,y:1850,tx:687,ty:1860,w:90,seed:1223,kind:'branch'},
           {x:1900,y:2580,tx:1634,ty:2590,w:90,seed:1224,kind:'branch'}, {x:1400,y:2800,tx:1680,ty:2810,w:90,seed:1225,kind:'branch'},
           {x:500,y:3560,tx:781,ty:3570,w:90,seed:1226,kind:'branch'}, {x:1000,y:3790,tx:723,ty:3800,w:90,seed:1227,kind:'branch'}],
   trunks:[], foliage:[],
   hazards:[{x:1800,y:1250,tx:1805,ty:1540,w:60,seed:1210,kind:'branch'}, {x:1790,y:3300,tx:1795,ty:3560,w:60,seed:1211,kind:'branch'}],
   forces:[{kind:'wind',x:150,y:700,w:550,h:280,ax:260,period:5,duty:0.45,phase:0,src:'hollow'},
           {kind:'wind',x:250,y:2290,w:730,h:240,ax:260,period:5,duty:0.45,phase:2.5,src:'hollow'}],
   walls:[],
   pads:{start:{x:1140,y:480,w:120,h:150,base:'bark'}, target:{x:1140,y:4280,w:120,h:150,base:'bark'}}}
);
