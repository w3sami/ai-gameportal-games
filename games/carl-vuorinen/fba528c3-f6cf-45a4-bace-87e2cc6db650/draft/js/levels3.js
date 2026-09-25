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
          {x:1200,y:4150,rx:480,ry:200,wob:0.08,seed:1205},
          {x:1580,y:1280,rx:120,ry:75,wob:0.1,seed:1206}, {x:830,y:3225,rx:160,ry:80,wob:0.1,seed:1207},
          {x:1710,y:1270,rx:70,ry:50,wob:0.1,seed:1208}, {x:950,y:2222,rx:90,ry:50,wob:0.1,seed:1209}, {x:1600,y:2256,rx:110,ry:60,wob:0.1,seed:1212}],   // fillers: carve out the slivers and thin spits left where two strands meet
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
   pads:{start:{x:1140,y:480,w:120,h:150,base:'bark'}, target:{x:1140,y:4280,w:120,h:150,base:'bark'}}},
  {name:'Gorge', theme:'jungle', w:9250, h:2600, groundY:2250, canopyY:1100,
   // a slot canyon under the jungle, flown upstream against the draught that pours down it. The draught comes in gusts; each
   // stretch of it starts in the rock face at the upstream end. Water drops through cracks in the roof, and inside a fall you
   // can only just hover — never while the gust is on you, so every fall is a gate you cross in a lull. Wait for it in the
   // pocket in the roof just short of each fall: the gust runs below it. Boulders and hanging rock make you weave between.
   rockZones:[{x:2500,y:1900,r:1450,ry:950,seed:1301}, {x:4800,y:1250,r:1450,ry:950,seed:1302}, {x:6700,y:1650,r:1150,ry:850,seed:1303}],
   rooms:[{x:850,y:1900,rx:650,ry:380,wob:0.07,seed:1310}, {x:8600,y:1150,rx:490,ry:350,wob:0.07,seed:1311},
          // pockets in the roof just downstream of each fall, above the gust
          {x:2560,y:1560,rx:110,ry:125,wob:0.12,seed:1312}, {x:3980,y:930,rx:110,ry:125,wob:0.12,seed:1313}, {x:4870,y:930,rx:110,ry:125,wob:0.12,seed:1314},
          {x:6620,y:1340,rx:100,ry:125,wob:0.12,seed:1315}, {x:7150,y:1340,rx:100,ry:125,wob:0.12,seed:1316},
          // fillers: carve out the slivers and thin spits left where pockets, cracks and the channel meet
          {x:5830,y:1470,rx:40,ry:30,wob:0.1,seed:1322}, {x:4965,y:1440,rx:30,ry:25,wob:0.1,seed:1323}, {x:6640,y:1445,rx:90,ry:45,wob:0.1,seed:1324}, {x:2650,y:1600,rx:75,ry:115,wob:0.1,seed:1325}, {x:4950,y:940,rx:75,ry:115,wob:0.1,seed:1326}, {x:7225,y:1350,rx:65,ry:115,wob:0.1,seed:1327},
          {x:4991,y:1025,rx:25,ry:25,wob:0.1,seed:1350}, {x:7203,y:1453,rx:25,ry:20,wob:0.1,seed:1351}, {x:7244,y:1457,rx:25,ry:20,wob:0.1,seed:1352}, {x:2588,y:1670,rx:25,ry:20,wob:0.1,seed:1353}, {x:2675,y:1706,rx:25,ry:20,wob:0.1,seed:1354}, {x:2562,y:1680,rx:25,ry:20,wob:0.1,seed:1355}, {x:2598,y:1688,rx:25,ry:20,wob:0.1,seed:1356},
          // plunge pools under each fall
          {x:2775,y:2150,rx:200,ry:60,wob:0.1,seed:1317}, {x:4240,y:1480,rx:210,ry:60,wob:0.1,seed:1318}, {x:5110,y:1480,rx:230,ry:60,wob:0.1,seed:1319},
          {x:6795,y:1850,rx:200,ry:60,wob:0.1,seed:1320}, {x:7345,y:1850,rx:200,ry:60,wob:0.1,seed:1321}],
   corridors:[{pts:[[1760,1930],[2300,1920],[3350,1920]],w:480},                       // lower gorge
              {pts:[[3250,1850],[3480,1600],[3560,1350],[3750,1250]],w:300},           // up the step
              {pts:[[3650,1250],[4800,1240],[5850,1260]],w:480},                       // upper gorge
              {pts:[[5650,1400],[5720,1640],[6100,1720],[6450,1700]],w:280},   // down through a hole in the floor into the narrows
              {pts:[[6450,1650],[7050,1660],[7700,1650]],w:420},                       // the narrows
              {pts:[[7480,1600],[7540,1400],[7650,1230],[8150,1150]],w:320},   // up out to the spring
              // the cracks the water comes through
              {pts:[[2775,1720],[2780,1560]],w:210}, {pts:[[4240,1040],[4245,880]],w:240}, {pts:[[5110,1040],[5115,880]],w:280},
              {pts:[[6795,1480],[6800,1320]],w:210}, {pts:[[7345,1480],[7350,1320]],w:210},
              {pts:[[1380,2030],[1560,2000],[1760,1960]],w:230}],   // the cave mouth (kept last: corridor wobble is seeded by index)
   rocks:[],
   spikes:[{x:1950,y:2350,tx:1970,ty:1840,w:260,seed:1330}, {x:2400,y:1500,tx:2390,ty:1960,w:220,seed:1331}, {x:3100,y:2350,tx:3110,ty:1870,w:240,seed:1332},
           {x:4650,y:800,tx:4640,ty:1320,w:220,seed:1333}, {x:5420,y:1700,tx:5430,ty:1215,w:220,seed:1334},
           {x:7000,y:1250,tx:6995,ty:1720,w:180,seed:1335}],
   trunks:EDGE_TRUNKS(9250), foliage:[{x:850,y:1480,r:500,ry:140,seed:1340,tone:1}, {x:8600,y:780,r:450,ry:130,seed:1341,tone:0}],
   hazards:[],
   forces:[{kind:'wind',x:1450,y:1620,w:2200,h:610,ax:-230,period:6,duty:0.4,phase:0,src:'hollow'},
           {kind:'wind',x:3700,y:980,w:2460,h:540,ax:-260,period:5.5,duty:0.4,phase:1.5,src:'hollow'},
           {kind:'wind',x:6300,y:1385,w:1690,h:535,ax:-290,period:5,duty:0.4,phase:3,src:'hollow'},
           {kind:'water',x:2700,y:1468,w:150,h:744,ay:300,drag:1.5,pool:{x:2600,w:350,h:36}},
           {kind:'water',x:4150,y:779,w:180,h:768,ay:300,drag:1.5,pool:{x:4050,w:380,h:51}},
           {kind:'water',x:5000,y:751,w:220,h:796,ay:300,drag:1.5,pool:{x:4900,w:420,h:53}},
           {kind:'water',x:6720,y:1217,w:150,h:697,ay:300,drag:1.5,pool:{x:6620,w:350,h:27}},
           {kind:'water',x:7270,y:1230,w:150,h:686,ay:300,drag:1.5,pool:{x:7170,w:350,h:25}}],
   walls:[],
   pads:{start:{x:600,y:2210,w:120,h:130}, target:{x:8550,y:1430,w:120,h:120}}}
);
