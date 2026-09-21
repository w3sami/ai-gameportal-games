'use strict';
// Chapter 2 continued: the wind levels. Loaded after levels.js, so it just appends to LEVELS.
// Wind forces: {kind:'wind', x,y,w,h, ax:±, period, duty, phase, src}. Horizontal only, no drag; the gust cycle comes from
// period/duty/phase and runs on sim ticks, so replays stay exact. A gust ramps in and out inside its on-window (see RAMP in
// game.js); a band may set its own `ramp` in seconds. src is the visual source — 'hollow' (a knot-hole on the
// upwind trunk face), 'fissure' (a crack on the upwind rock face), 'sky' (none: the wind is simply there because the space is
// open, so only valid where it is). Not read by the engine yet. Opposing gusts always sit in separate vertical bands.
// A band's upwind edge should sit inside solid mass — a trunk, a rock face, the edge trunks — so the field is never seen to
// begin in open air, and the edge across the wind should line up with the end of that solid: a band coming off a standing
// stump starts at the stump's top, one coming off hanging deadwood stops at its tip. The gap left over is the calm way past.
// The downwind edge may end in the open: that reads as the gale dying out, which is fine.
const EDGE_TRUNKS = w => [{x:-20,y:4000,tx:-20,ty:-200,w:300,taper:0,seed:-340}, {x:260,y:4000,tx:260,ty:-200,w:260,taper:0,seed:1620}, {x:w+20,y:4000,tx:w+20,ty:-200,w:300,taper:0,seed:w*7}, {x:w-260,y:4000,tx:w-260,ty:-200,w:260,taper:0,seed:w*7-1960}];
LEVELS.push(
  {name:'Treetops', theme:'jungle', w:5600, h:2600, groundY:2300, canopyY:350,
   // the teaching level: a run through the canopy layer, over four crowns at different heights. The gale fills the layer end to end —
   // out of the great trunk at the map edge, under the canopy, over the treetop line, dying into the big crown that is the one real
   // climb of the run. A dead spar stands in the middle of it. Land on the last treetop.
   rooms:[{x:2800,y:700,rx:2700,ry:520,wob:0.07,seed:701}, {x:600,y:1500,rx:430,ry:520,wob:0.08,seed:703}],
   corridors:[{pts:[[700,1260],[770,1080],[840,950]],w:260}],
   rocks:[],
   spikes:[{x:1650,y:850,tx:2150,ty:700,w:100,seed:716,kind:'branch'}, {x:5100,y:1300,tx:4700,ty:1120,w:110,seed:717,kind:'branch'}],
   trunks:EDGE_TRUNKS(5600).concat([{x:1650,y:1800,tx:1660,ty:600,w:240,taper:0.2,broken:true,seed:715},
           {x:5100,y:2600,tx:5100,ty:1100,w:300,taper:0.15,seed:705}]),
   foliage:[{x:1250,y:1330,r:460,ry:360,seed:706,tone:0}, {x:1280,y:1130,r:260,ry:190,seed:707,tone:1},
            {x:2500,y:1500,r:520,ry:700,seed:708,tone:1}, {x:2450,y:1300,r:300,ry:460,seed:709,tone:2},
            {x:3450,y:1050,r:420,ry:570,seed:718,tone:2}, {x:3380,y:850,r:260,ry:220,seed:721,tone:3},
            {x:4250,y:1300,r:520,ry:460,seed:711,tone:0}, {x:4200,y:1120,r:280,ry:250,seed:710,tone:1}, {x:4900,y:1420,r:330,ry:230,seed:712,tone:1}],
   hazards:[{x:2150,y:60,tx:2155,ty:330,w:60,seed:719,kind:'branch'}, {x:4550,y:60,tx:4555,ty:340,w:60,seed:720,kind:'branch'}],
   forces:[{kind:'wind',x:380,y:190,w:2870,h:590,ax:200,period:6,duty:0.4,phase:0,src:'hollow'}],
   walls:[],
   pads:{start:{x:540,y:1960,w:120,h:100}, target:{x:5040,y:1100,w:120,h:100,base:'bark'}}},
  {name:'Steps', theme:'jungle', w:8200, h:3800, groundY:3700, canopyY:400,
   // five glades stepping down a wooded slope. Glade 2 gusts with you, 3 against, 4 with, 5 against: whatever carried you over one lip
   // tries to throw you back at the next. Each gust sits in its own vertical band.
   rooms:[{x:800,y:800,rx:650,ry:450,wob:0.08,seed:801}, {x:2400,y:1450,rx:750,ry:470,wob:0.07,seed:802}, {x:4100,y:2100,rx:800,ry:480,wob:0.07,seed:803}, {x:5800,y:2700,rx:800,ry:470,wob:0.07,seed:804}, {x:7400,y:3150,rx:750,ry:450,wob:0.07,seed:805}],
   corridors:[{pts:[[1300,1050],[1700,1280],[2000,1420]],w:220}, {pts:[[3000,1700],[3400,1930],[3700,2080]],w:220}, {pts:[[4750,2380],[5100,2580],[5400,2690]],w:220}, {pts:[[6450,2930],[6800,3080],[7050,3140]],w:220}],
   rocks:[],
   spikes:[{x:2400,y:940,tx:2380,ty:1180,w:130,seed:806}, {x:3900,y:1580,tx:3930,ty:1840,w:130,seed:807}, {x:5500,y:2180,tx:5520,ty:2450,w:130,seed:808}, {x:7100,y:2660,tx:7080,ty:2920,w:130,seed:809},
           {x:1600,y:1650,tx:1750,ty:1500,w:110,seed:810}, {x:3300,y:2300,tx:3450,ty:2150,w:110,seed:811}, {x:5000,y:2900,tx:5150,ty:2760,w:110,seed:812}],
   trunks:EDGE_TRUNKS(8200).concat([{x:1900,y:2000,tx:2750,ty:1830,w:190,taper:0.1,seed:813}, {x:3600,y:2650,tx:4450,ty:2480,w:190,taper:0.1,seed:814}, {x:5300,y:3200,tx:6150,ty:3060,w:190,taper:0.1,seed:815},
           {x:900,y:1500,tx:900,ty:1150,w:170,taper:0.15,broken:true,seed:816}, {x:4200,y:2800,tx:4200,ty:2400,w:180,taper:0.15,broken:true,seed:817}, {x:7500,y:3700,tx:7500,ty:3350,w:180,taper:0.15,broken:true,seed:818}]),
   foliage:[{x:800,y:350,r:480,ry:150,seed:819,tone:1}, {x:2400,y:1000,r:520,ry:160,seed:820,tone:0}, {x:4100,y:1650,r:540,ry:160,seed:821,tone:1}, {x:5800,y:2250,r:540,ry:160,seed:822,tone:0}, {x:7400,y:2720,r:520,ry:150,seed:823,tone:2},
            {x:1500,y:2050,r:300,ry:120,seed:824,tone:0}, {x:3200,y:2700,r:300,ry:120,seed:825,tone:1}, {x:4900,y:3250,r:300,ry:120,seed:826,tone:0}],
   hazards:[{x:2100,y:1020,tx:2105,ty:1260,w:60,seed:827,kind:'branch'}, {x:4400,y:1680,tx:4405,ty:1930,w:60,seed:828,kind:'branch'}, {x:6100,y:2280,tx:6105,ty:2530,w:60,seed:829,kind:'branch'}, {x:7700,y:2740,tx:7705,ty:2990,w:60,seed:830,kind:'branch'}],
   forces:[{kind:'wind',x:1750,y:1030,w:1300,h:820,ax:240,period:5,duty:0.4,phase:0,src:'sky'},
           {kind:'wind',x:3400,y:1880,w:1450,h:640,ax:-240,period:5,duty:0.4,phase:1.6,src:'sky'},
           {kind:'wind',x:5100,y:2550,w:1450,h:570,ax:260,period:5,duty:0.4,phase:3.2,src:'sky'},
           {kind:'wind',x:6750,y:3150,w:1350,h:430,ax:-260,period:5,duty:0.4,phase:0.8,src:'sky'}],
   walls:[],
   pads:{start:{x:440,y:1140,w:120,h:100}, target:{x:7700,y:3490,w:120,h:100}}},
  {name:'Two ways', theme:'jungle', w:7400, h:3800, groundY:3400, canopyY:500,
   // a fork right off the pad. High road: three chambers climbing, dipping and climbing again, a gust in each, the middle one a
   // storey below the two others, then a long gallery out over the roof of the deep chamber. Low road: no wind, but three heavy
   // falls to punch through, and then the whole climb up the deep chamber and the shaft. The two only meet at the pad, which sits
   // on a limb high in the shaft head: the high road arrives level with it, the low road has to climb the last thousand.
   // Pools: each band sits at the floor under its own fall, runs into the stump at its near end and dies out where the ground
   // rises past the surface at the far end, so no edge of water ever ends in the open.
   rooms:[{x:700,y:2400,rx:480,ry:600,wob:0.08,seed:761},
          {x:1900,y:1000,rx:650,ry:450,wob:0.08,seed:762}, {x:3200,y:1730,rx:600,ry:420,wob:0.08,seed:763}, {x:4600,y:900,rx:700,ry:470,wob:0.08,seed:764},
          {x:1800,y:2900,rx:850,ry:500,wob:0.08,seed:765}, {x:3200,y:2950,rx:900,ry:500,wob:0.08,seed:766}, {x:4650,y:2820,rx:950,ry:520,wob:0.08,seed:767},
          {x:5900,y:1900,rx:600,ry:700,wob:0.08,seed:768}, {x:6900,y:1600,rx:430,ry:700,wob:0.08,seed:769}],
   corridors:[{pts:[[850,1950],[1200,1500],[1550,1150]],w:200}, {pts:[[950,2750],[1250,2850],[1500,2900]],w:200},
              {pts:[[2400,1250],[2800,1480],[3050,1630]],w:190}, {pts:[[3700,1530],[4050,1280],[4350,1020]],w:190},
              {pts:[[5150,900],[5700,820],[6200,900],[6600,1080]],w:230}, {pts:[[5400,2750],[5700,2500],[5850,2300]],w:190},
              {pts:[[6350,1800],[6650,1700],[6800,1650]],w:200}],
   rocks:[],
   spikes:[{x:1900,y:480,tx:1920,ty:780,w:120,seed:771,kind:'branch'}, {x:3200,y:2190,tx:3180,ty:1910,w:120,seed:772,kind:'branch'}, {x:4600,y:400,tx:4620,ty:720,w:120,seed:773,kind:'branch'},
           {x:2500,y:2520,tx:2500,ty:2820,w:150,seed:774}, {x:4000,y:2400,tx:4020,ty:2700,w:150,seed:775},
           {x:6300,y:1300,tx:6280,ty:1620,w:120,seed:776}],
   trunks:EDGE_TRUNKS(7400).concat([{x:1700,y:3500,tx:1700,ty:2900,w:240,taper:0.15,broken:true,seed:777}, {x:3150,y:3500,tx:3150,ty:2900,w:220,taper:0.15,broken:true,seed:778},
           {x:1400,y:2200,tx:2250,ty:2350,w:200,taper:0.1,seed:779}, {x:4300,y:2200,tx:5150,ty:2300,w:200,taper:0.1,seed:780},
           {x:4600,y:3500,tx:4600,ty:3180,w:180,taper:0.15,broken:true,seed:791}, {x:6900,y:3500,tx:6900,ty:2450,w:220,taper:0.15,broken:true,seed:781}, {x:7300,y:1430,tx:6620,ty:1330,w:230,taper:0.1,seed:790}]),
   foliage:[{x:1900,y:420,r:420,ry:140,seed:782,tone:1}, {x:4600,y:340,r:450,ry:140,seed:783,tone:0}, {x:3200,y:1210,r:380,ry:130,seed:784,tone:2}, {x:6900,y:820,r:400,ry:140,seed:785,tone:1}],
   hazards:[{x:2300,y:630,tx:2305,ty:880,w:60,seed:786,kind:'branch'}, {x:3450,y:1350,tx:3455,ty:1600,w:60,seed:787,kind:'branch'}, {x:5000,y:520,tx:5005,ty:770,w:60,seed:788,kind:'branch'}, {x:2900,y:2480,tx:2905,ty:2740,w:60,seed:789,kind:'branch'}],
   forces:[{kind:'wind',x:1300,y:600,w:1200,h:780,ax:240,period:4.5,duty:0.4,phase:0,src:'sky'},
           {kind:'wind',x:2650,y:1390,w:1150,h:700,ax:-240,period:4.5,duty:0.4,phase:1.5,src:'fissure'},
           {kind:'wind',x:3950,y:500,w:1300,h:780,ax:260,period:4.5,duty:0.4,phase:3,src:'sky'},
           {kind:'water',x:2050,y:2300,w:300,h:1075,ay:340,drag:1.6,pool:{x:1750,w:750,h:70}},
           {kind:'water',x:3600,y:2400,w:300,h:1050,ay:340,drag:1.6,pool:{x:3200,w:680,h:120}},
           {kind:'water',x:4950,y:2300,w:300,h:1040,ay:340,drag:1.6,pool:{x:4600,w:900,h:70}}],
   walls:[],
   pads:{start:{x:640,y:2920,w:120,h:100}, target:{x:6740,y:1180,w:120,h:100,base:'bark'}}},
  {name:'Hollow', theme:'jungle', w:2400, h:3400, groundY:2800, canopyY:500,
   // the inside of a hollow tree: a climb between two trunk faces, knot-holes gusting across the shaft, branch stubs for ledges.
   rooms:[{x:400,y:3150,rx:330,ry:230,wob:0.1,seed:901}, {x:1200,y:1750,rx:450,ry:1400,wob:0.04,seed:902}, {x:1300,y:450,rx:900,ry:330,wob:0.08,seed:903}],
   corridors:[{pts:[[650,3100],[850,3050],[1000,3000]],w:190}],
   rocks:[],
   spikes:[{x:740,y:2750,tx:1150,ty:2720,w:110,seed:904,kind:'branch'}, {x:1660,y:2050,tx:1250,ty:2080,w:110,seed:905,kind:'branch'}, {x:740,y:1350,tx:1200,ty:1320,w:100,seed:906,kind:'branch'}, {x:1660,y:900,tx:1300,ty:930,w:100,seed:907,kind:'branch'}],
   trunks:[{x:560,y:2900,tx:540,ty:500,w:380,taper:0,broken:true,seed:908}, {x:1840,y:3400,tx:1860,ty:620,w:380,taper:0,seed:909}],
   foliage:[{x:250,y:350,r:320,ry:130,seed:910,tone:1}, {x:2200,y:320,r:320,ry:130,seed:911,tone:0}],
   hazards:[{x:1500,y:120,tx:1505,ty:340,w:60,seed:912,kind:'branch'}],
   forces:[{kind:'wind',x:760,y:2250,w:880,h:300,ax:260,period:4,duty:0.4,phase:0,src:'hollow'}, {kind:'wind',x:760,y:1550,w:880,h:300,ax:-260,period:4,duty:0.4,phase:1.33,src:'hollow'}, {kind:'wind',x:760,y:850,w:880,h:300,ax:260,period:4,duty:0.4,phase:2.67,src:'hollow'}],
   walls:[],
   pads:{start:{x:340,y:3300,w:120,h:100}, target:{x:1780,y:620,w:120,h:100,base:'bark'}}},
  {name:'Behind the falls', theme:'jungle', w:7000, h:3600, groundY:3100, canopyY:700,
   // a dead-end glade with a big fall down the cliff. The only way on is the mouth hidden in the curtain; inside, a second fall drops
   // through the shaft you have to climb, and the way out onto the plateau runs straight through a third.
   plateau:{x0:4750,groundY:1600,canopyY:400},
   rockZones:[{x:3600,y:1900,r:1050,ry:1750,seed:951}],
   rooms:[{x:1500,y:2300,rx:1300,ry:750,wob:0.07,seed:952}, {x:3060,y:2330,rx:200,ry:150,wob:0.1,seed:953}, {x:3600,y:1900,rx:350,ry:700,wob:0.09,seed:954}, {x:4200,y:1150,rx:400,ry:450,wob:0.1,seed:955}, {x:5900,y:1050,rx:1050,ry:560,wob:0.07,seed:956}],
   corridors:[{pts:[[2500,2330],[2800,2350],[3000,2350]],w:190}, {pts:[[3120,2280],[3300,2130],[3480,1990]],w:160}, {pts:[[3650,1450],[3900,1300],[4100,1200]],w:180}, {pts:[[4450,1080],[4750,1100],[5050,1110]],w:200}],
   rocks:[],
   spikes:[{x:2750,y:1700,tx:2550,ty:1820,w:130,seed:957}, {x:3350,y:1500,tx:3500,ty:1620,w:110,seed:958}, {x:3900,y:2300,tx:3750,ty:2150,w:110,seed:959}, {x:800,y:1400,tx:805,ty:1680,w:90,seed:960,kind:'branch'}, {x:6300,y:520,tx:6305,ty:800,w:100,seed:961,kind:'branch'}],
   trunks:EDGE_TRUNKS(7000).concat([{x:1700,y:3100,tx:1700,ty:2550,w:200,taper:0.15,broken:true,seed:962}, {x:900,y:3100,tx:1600,ty:2800,w:150,taper:0.1,seed:963},
           {x:5600,y:1700,tx:5600,ty:1200,w:180,taper:0.15,broken:true,seed:964}, {x:6850,y:1700,tx:6600,ty:1180,w:140,taper:0.15,seed:965}]),
   foliage:[{x:900,y:1400,r:480,ry:150,seed:966,tone:1}, {x:1900,y:1450,r:400,ry:130,seed:967,tone:0}, {x:5300,y:420,r:520,ry:150,seed:968,tone:0}, {x:6500,y:400,r:450,ry:140,seed:969,tone:1}],
   hazards:[{x:1300,y:1520,tx:1305,ty:1790,w:60,seed:970,kind:'branch'}, {x:2200,y:1530,tx:2205,ty:1800,w:60,seed:971,kind:'branch'}, {x:3550,y:1180,tx:3555,ty:1460,w:70,seed:972}, {x:5000,y:480,tx:5005,ty:730,w:60,seed:973,kind:'branch'}],
   forces:[{kind:'water',x:2510,y:1250,w:360,h:1750,ay:300,drag:1.5,pool:{x:2150,w:750,h:70}},
           {kind:'water',x:3520,y:1200,w:170,h:1400,ay:300,drag:1.5,pool:{x:3440,w:360,h:60}},
           {kind:'water',x:4580,y:760,w:260,h:940,ay:300,drag:1.5,pool:{x:4450,w:520,h:60}}],
   walls:[],
   pads:{start:{x:600,y:2890,w:120,h:100}, target:{x:6300,y:1490,w:120,h:100}}},
  {name:'Squall', theme:'jungle', w:6600, h:2200, groundY:1750, canopyY:450,
   // a storm over a blown-down clearing. The gale runs one way only, with you, in long hard gusts; standing stumps and hanging
   // deadwood make you weave, and the calm lee just past each one is where you kill the speed before the next gust takes you.
   rooms:[{x:3300,y:1150,rx:3150,ry:580,wob:0.07,seed:981}, {x:600,y:1400,rx:400,ry:380,wob:0.09,seed:982}, {x:6000,y:1400,rx:400,ry:380,wob:0.09,seed:983}],
   corridors:[],
   rocks:[],
   spikes:[{x:1600,y:1000,tx:2050,ty:1080,w:110,seed:984,kind:'branch'}, {x:2800,y:1200,tx:2350,ty:1260,w:110,seed:985,kind:'branch'}, {x:4000,y:980,tx:4450,ty:1060,w:110,seed:986,kind:'branch'}, {x:5200,y:1220,tx:4750,ty:1280,w:110,seed:987,kind:'branch'}],
   trunks:EDGE_TRUNKS(6600).concat([{x:1600,y:1900,tx:1610,ty:880,w:260,taper:0.15,broken:true,seed:988}, {x:2800,y:380,tx:2810,ty:1320,w:260,taper:0.15,broken:true,seed:989},
           {x:4000,y:1900,tx:4010,ty:860,w:280,taper:0.15,broken:true,seed:990}, {x:5200,y:380,tx:5210,ty:1340,w:260,taper:0.15,broken:true,seed:991},
           {x:2100,y:1800,tx:2900,ty:1740,w:170,taper:0,broken:0.5,seed:992}, {x:4500,y:1800,tx:5300,ty:1750,w:170,taper:0,broken:0.5,seed:993}]),
   foliage:[{x:1000,y:520,r:420,ry:140,seed:994,tone:1}, {x:3400,y:480,r:520,ry:150,seed:995,tone:0}, {x:5800,y:520,r:420,ry:140,seed:996,tone:2},
            {x:2300,y:1780,r:320,ry:130,seed:997,tone:0}, {x:4700,y:1790,r:320,ry:130,seed:998,tone:1}],
   hazards:[{x:1200,y:560,tx:1205,ty:800,w:60,seed:999,kind:'branch'}, {x:2300,y:540,tx:2305,ty:790,w:60,seed:1000,kind:'branch'}, {x:3500,y:530,tx:3505,ty:800,w:70,seed:1001,kind:'branch'}, {x:4700,y:550,tx:4705,ty:800,w:60,seed:1002,kind:'branch'}, {x:5700,y:560,tx:5705,ty:790,w:60,seed:1003,kind:'branch'}],
   // every band starts inside the wood upwind of it, so none of them is seen to begin in open air: band 1 out of the edge trunks,
   // then each of the four stumps in turn. A band off a standing stump (988, 990) has its top at that stump's broken top, leaving
   // the gap up to the canopy calm; a band off hanging deadwood (989, 991) stops at the tip, leaving the gap down to the ground
   // calm. So the quiet way through alternates high, low, high, low, and the run is a weave rather than a straight blast.
   forces:[{kind:'wind',x:0,y:600,w:1470,h:1120,ax:290,period:5,duty:0.5,phase:0,src:'sky'},
           {kind:'wind',x:1600,y:880,w:1070,h:840,ax:290,period:5,duty:0.5,phase:1.25,src:'sky'},
           {kind:'wind',x:2800,y:600,w:1060,h:720,ax:290,period:5,duty:0.5,phase:2.5,src:'sky'},
           {kind:'wind',x:4000,y:860,w:1070,h:860,ax:290,period:5,duty:0.5,phase:3.75,src:'sky'},
           {kind:'wind',x:5200,y:600,w:700,h:740,ax:290,period:5,duty:0.5,phase:0.6,src:'sky'}],
   walls:[],
   // the two end hollows floor out around y=1750–1780, deeper than the 100 px pedestal reached: both pads sat clear of the ground.
   // Dropped a little and given a taller plinth, so each one is dug into the floor the way the rest of the chapter's pads are.
   pads:{start:{x:540,y:1650,w:120,h:150}, target:{x:5940,y:1670,w:120,h:150}}}
);
