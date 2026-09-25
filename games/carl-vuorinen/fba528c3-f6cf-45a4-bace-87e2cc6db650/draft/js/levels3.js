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
   pads:{start:{x:600,y:2210,w:120,h:130}, target:{x:8550,y:1430,w:120,h:120}}},
  {name:'Emergent', theme:'jungle', w:3000, h:5000, groundY:4700, canopyY:330,
   // one giant tree on a gnarled fan of roots, taller than the canopy. The way up is the gap between it and its neighbour at
   // the right edge: limbs reach across from both trunks in turn, past each other, so every storey is a traverse — out to the
   // neighbour, back to the trunk. Higher up the draught blows off the neighbour toward the trunk, against you one storey,
   // behind you the next. Up past the crown on the right, then back over its top to the landing on the crown.
   rooms:[{x:700,y:2650,rx:600,ry:2050,wob:0.06,seed:1401}, {x:2050,y:2600,rx:800,ry:2050,wob:0.06,seed:1402}, {x:1350,y:2600,rx:700,ry:2150,wob:0.05,seed:1403},
          {x:1450,y:600,rx:1300,ry:450,wob:0.07,seed:1404}, {x:500,y:4550,rx:450,ry:280,wob:0.08,seed:1405}, {x:2100,y:4550,rx:650,ry:280,wob:0.08,seed:1406},
          {x:880,y:4600,rx:900,ry:300,wob:0.06,seed:1408}],   // open ground all round the foot of the tree
   corridors:[],
   rocks:[{x:2350,y:4760,r:140,ry:90,wob:0.22,seed:1407}],
   // limbs: ours reach right from the trunk, the neighbour's reach left from the edge, alternating storeys
   spikes:[{x:2750,y:3990,tx:1600,ty:3960,w:130,seed:5013,kind:'branch'},                     // the neighbour's low limb, under a thick bank of leaves
           {x:950,y:3420,tx:2293,ty:3330,w:150,seed:2174,kind:'branch'},
           {x:2750,y:2930,tx:1374,ty:2870,w:150,seed:2670,kind:'branch'},
           {x:950,y:2440,tx:2331,ty:2360,w:150,seed:3099,kind:'branch'},
           {x:2750,y:1930,tx:1355,ty:1880,w:140,seed:3266,kind:'branch'},
           {x:950,y:1440,tx:2372,ty:1370,w:140,seed:3987,kind:'branch'},
           // the left side is open to look at, not to fly: it ends under the crown
           {x:800,y:3000,tx:300,ty:2880,w:120,seed:4104,kind:'branch'}, {x:800,y:2000,tx:280,ty:1900,w:110,seed:4551,kind:'branch'}, {x:40,y:3700,tx:380,ty:3640,w:200,seed:1418},
           // the roots: a gnarled fan from the buttressed foot of the trunk down into the ground. Only to look at; the gaps between them are closed.
           {x:760,y:4000,tx:80,ty:4880,w:150,seed:9169,kind:'branch'}, {x:720,y:4250,tx:300,ty:4900,w:140,seed:9431,kind:'branch'}, {x:680,y:4500,tx:480,ty:4910,w:120,seed:10045,kind:'branch'},
           {x:1010,y:4000,tx:1560,ty:4880,w:150,seed:10285,kind:'branch'}, {x:1060,y:4250,tx:1400,ty:4910,w:140,seed:10740,kind:'branch'}, {x:1100,y:4500,tx:1260,ty:4910,w:120,seed:11160,kind:'branch'},
           {x:620,y:4650,tx:180,ty:4900,w:90,seed:11788,kind:'branch'}],
   trunks:[{x:880,y:4950,tx:890,ty:850,w:460,taper:0.3,seed:1420},                            // the trunk
           {x:2850,y:5200,tx:2830,ty:-200,w:440,taper:0.1,seed:1423},                          // the neighbour
           {x:-60,y:5200,tx:-60,ty:-200,w:300,taper:0,seed:1424}],
   foliage:[{x:850,y:800,r:900,ry:320,seed:1430,tone:0}, {x:600,y:700,r:420,ry:180,seed:1431,tone:1}, {x:1250,y:720,r:450,ry:190,seed:1432,tone:1}, {x:900,y:600,r:380,ry:150,seed:1433,tone:2},
            {x:2253,y:3320,r:170,ry:90,seed:1434,tone:1}, {x:2291,y:2350,r:170,ry:90,seed:1435,tone:0}, {x:2332,y:1360,r:160,ry:85,seed:1436,tone:2},
            {x:1414,y:2870,r:150,ry:80,seed:1437,tone:0}, {x:1395,y:1880,r:140,ry:75,seed:1438,tone:1},
            {x:310,y:2880,r:130,ry:70,seed:1439,tone:2}, {x:290,y:1900,r:120,ry:65,seed:1440,tone:0}, {x:2600,y:250,r:350,ry:130,seed:1441,tone:1},
            {x:2600,y:3930,r:380,ry:190,seed:1460,tone:0}, {x:2150,y:3940,r:380,ry:175,seed:1461,tone:1}, {x:1780,y:3950,r:320,ry:150,seed:1462,tone:0}, {x:1588,y:3955,r:190,ry:110,seed:1463,tone:2},
            {x:2350,y:3860,r:260,ry:110,seed:1464,tone:2}, {x:1950,y:3880,r:220,ry:95,seed:1465,tone:2}],
   hazards:[{x:1700,y:3375,tx:1705,ty:3620,w:60,seed:1450,kind:'branch'}, {x:1800,y:1400,tx:1805,ty:1620,w:60,seed:1451,kind:'branch'},
            {x:1450,y:940,tx:1455,ty:1180,w:60,seed:1452,kind:'branch'}, {x:1300,y:120,tx:1305,ty:330,w:60,seed:1453,kind:'branch'}, {x:2100,y:150,tx:2105,ty:430,w:60,seed:1454,kind:'branch'}],
   forces:[{kind:'wind',x:1000,y:2400,w:1750,h:470,ax:-180,period:6,duty:0.45,phase:0,src:'hollow'},
           {kind:'wind',x:1000,y:1900,w:1750,h:470,ax:-220,period:5.5,duty:0.45,phase:1.8,src:'hollow'},
           {kind:'wind',x:1000,y:1400,w:1750,h:470,ax:-260,period:5,duty:0.45,phase:3.6,src:'hollow'}],
   walls:[],
   pads:{start:{x:1750,y:4700,w:120,h:150}, target:{x:950,y:470,w:120,h:150,base:'bark'}}},
  {name:'Headwaters', theme:'jungle', w:6200, h:4100, groundY:3700, canopyY:1000,
   // the finale: up the river to where it starts. Two cascades first — climb the shaft beside each fall, while a gust off the
   // far wall tries to push you into the water, where you can't hold height. Then in at the foot of a hollow tree and up its
   // throat, weaving round the stubs inside with the draught coming through the knot holes. Out at the top and back along
   // under the canopy with the storm behind you, to the spring: the last fall stands between you and the pad.
   rockZones:[{x:1800,y:3500,r:1300,ry:700,seed:1501}, {x:3700,y:2900,r:1100,ry:800,seed:1502}],
   rooms:[{x:750,y:3600,rx:550,ry:330,wob:0.07,seed:1510},                                     // where the river ends up
          {x:1750,y:650,rx:520,ry:300,wob:0.07,seed:1511},                                     // the spring
          // plunge pools at the foot of each cascade, and under the spring
          {x:2560,y:3810,rx:200,ry:60,wob:0.1,seed:1512}, {x:4060,y:3235,rx:200,ry:55,wob:0.1,seed:1513}, {x:2380,y:935,rx:190,ry:55,wob:0.1,seed:1514},
          {x:4115,y:3175,rx:45,ry:35,wob:0.1,seed:1515}],   // filler: a spit left between the second pool and the shaft floor
   corridors:[{pts:[[1200,3620],[2250,3610]],w:400},                                   // first basin
              {pts:[[2450,3650],[2450,3050]],w:420},                                   // up beside the first cascade
              {pts:[[2800,2950],[3850,2940]],w:400},                                   // second basin
              {pts:[[3950,3000],[3950,2400]],w:420},                                   // up beside the second cascade
              {pts:[[4300,2300],[5300,2300]],w:400},                                   // third basin, into the foot of the tree
              {pts:[[5450,2450],[5450,700]],w:600},                                    // the tree's throat
              {pts:[[5150,700],[3700,720],[2350,700]],w:420},                          // back along under the canopy
              {pts:[[2380,920],[2385,420]],w:200}],                                    // the crack the spring comes through
   rocks:[],
   spikes:[// the ledges the river spills off
           {x:2760,y:3170,tx:2480,ty:3160,w:170,seed:1520}, {x:4260,y:2520,tx:3980,ty:2510,w:170,seed:1521},
           // rock in the basins
           {x:1800,y:3250,tx:1790,ty:3615,w:200,seed:1522}, {x:3300,y:3350,tx:3310,ty:2927,w:220,seed:1523}, {x:4750,y:1950,tx:4740,ty:2290,w:200,seed:1524},
           // stubs inside the tree, alternate walls, each past the middle
           {x:5140,y:1990,tx:5491,ty:2000,w:90,seed:1526,kind:'branch'},
           {x:5760,y:1730,tx:5413,ty:1740,w:90,seed:1527,kind:'branch'}, {x:5140,y:1470,tx:5510,ty:1480,w:90,seed:1528,kind:'branch'},
           {x:5760,y:1210,tx:5409,ty:1220,w:90,seed:1529,kind:'branch'}, {x:5140,y:960,tx:5489,ty:970,w:90,seed:1525,kind:'branch'},
           // under the canopy, a stump standing (the leaves hanging are foliage)
           {x:3800,y:1050,tx:3805,ty:680,w:220,seed:1531}],
   trunks:[{x:5150,y:2080,tx:5150,ty:900,w:220,taper:0.05,seed:1540},                 // the hollow tree's walls
           {x:5750,y:2700,tx:5750,ty:250,w:220,taper:0.05,seed:1541},
           {x:-60,y:4300,tx:-60,ty:-200,w:300,taper:0,seed:1542}],
   foliage:[{x:4500,y:530,r:190,ry:220,seed:1550,tone:1}, {x:4420,y:470,r:160,ry:120,seed:1553,tone:2}, {x:3100,y:530,r:190,ry:220,seed:1551,tone:0}, {x:3180,y:470,r:160,ry:120,seed:1554,tone:2}, {x:5450,y:380,r:600,ry:200,seed:1552,tone:0}],
   hazards:[{x:4150,y:450,tx:4155,ty:680,w:60,seed:1560,kind:'branch'}, {x:2750,y:450,tx:2755,ty:680,w:60,seed:1561,kind:'branch'},
            {x:4400,y:1990,tx:4405,ty:2180,w:60,seed:1562}],
   forces:[// gusts across each cascade shaft, off the far wall and into the water
           {kind:'wind',x:2150,y:3180,w:510,h:210,ax:230,period:5,duty:0.45,phase:0,src:'hollow'},
           {kind:'wind',x:3650,y:2530,w:510,h:195,ax:250,period:5,duty:0.45,phase:2.5,src:'hollow'},
           // through the knot holes in the tree
           {kind:'wind',x:5100,y:2010,w:700,h:210,ax:-220,period:4.5,duty:0.45,phase:0,src:'hollow'},
           {kind:'wind',x:5100,y:1750,w:700,h:210,ax:220,period:4.5,duty:0.45,phase:1.5,src:'hollow'},
           {kind:'wind',x:5100,y:1230,w:700,h:210,ax:260,period:4.5,duty:0.45,phase:3,src:'hollow'},
           // the storm under the canopy, out of the tree and along behind you
           {kind:'wind',x:2500,y:470,w:3300,h:470,ax:-250,period:5,duty:0.5,phase:1,src:'hollow'},
           // the cascades and the spring
           {kind:'water',x:2490,y:3178,w:160,h:699,ay:300,drag:1.5,pool:{x:2400,w:340,h:28}},
           {kind:'water',x:3990,y:2527,w:160,h:770,ay:300,drag:1.5,pool:{x:3900,w:340,h:34}},
           {kind:'water',x:2310,y:310,w:150,h:719,ay:300,drag:1.5,pool:{x:2290,w:200,h:44}}],
   walls:[],
   pads:{start:{x:600,y:3860,w:120,h:130}, target:{x:1650,y:880,w:120,h:130}}}
);
