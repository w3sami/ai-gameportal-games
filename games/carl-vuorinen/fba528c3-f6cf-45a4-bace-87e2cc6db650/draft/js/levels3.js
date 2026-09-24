'use strict';
// Chapter 2, last stretch. Kept in its own file so edits here can never collide with a whole-file write to levels2.js.
// Loaded after levels2.js, so it just appends to LEVELS.
LEVELS.push(
  {name:'Emergent', theme:'jungle', w:3000, h:5600, groundY:5100, canopyY:4250,
   // one giant tree that breaks out above the canopy. Below, the trunk walls off everything to its left, so the whole run
   // stays on its right side: off the pad past the buttress roots, low under the aerial roots hanging from the first limb,
   // up the gap where a neighbour fell, then up the open air beside the trunk, where the gusts get harder the higher you go.
   // The calm between bands sits on the limbs. Land on the high limb under the crown.
   // The pocket above the canopy is framed on every side: our crown overhead, the neighbour's crown at the right edge.
   rooms:[{x:1950,y:4750,rx:950,ry:480,wob:0.07,seed:1101}, {x:1700,y:2350,rx:1000,ry:1250,wob:0.06,seed:1102}, {x:2100,y:3150,rx:700,ry:450,wob:0.07,seed:1103}],
   corridors:[{pts:[[2590,4380],[2560,3900],[2600,3450]],w:280}],
   rocks:[],
   spikes:[{x:1050,y:4400,tx:2350,ty:4370,w:120,seed:1110,kind:'branch'},                                   // the first limb
           {x:2090,y:4390,tx:2100,ty:4960,w:50,seed:1111,kind:'branch'}, {x:2200,y:4385,tx:2205,ty:4720,w:50,seed:1112,kind:'branch'}, {x:2300,y:4380,tx:2310,ty:4990,w:50,seed:1113,kind:'branch'},   // aerial roots
           {x:1050,y:3080,tx:1600,ty:3010,w:130,seed:1114,kind:'branch'}, {x:1050,y:2440,tx:1720,ty:2370,w:140,seed:1115,kind:'branch'}],
   trunks:[{x:850,y:5500,tx:860,ty:600,w:560,taper:0.35,seed:1120},
           {x:1080,y:4450,tx:1800,ty:5260,w:170,taper:0.75,seed:1121}, {x:1060,y:4700,tx:1560,ty:5260,w:140,taper:0.75,seed:1122}, {x:1060,y:4930,tx:1320,ty:5260,w:110,taper:0.75,seed:1123},   // buttress roots
           {x:3020,y:5800,tx:3020,ty:-200,w:300,taper:0,seed:1124},
           {x:980,y:1830,tx:2080,ty:1770,w:190,taper:0.45,broken:true,seed:1125}],                                // the landing limb, snapped off: straight, so the pad sits true
   foliage:[{x:900,y:900,r:1000,ry:450,seed:1130,tone:0}, {x:1300,y:1130,r:420,ry:210,seed:1131,tone:1}, {x:800,y:720,r:500,ry:220,seed:1132,tone:2},
            {x:2950,y:2000,r:400,ry:600,seed:1133,tone:1}],
   hazards:[{x:2250,y:1180,tx:2255,ty:1560,w:60,seed:1140,kind:'branch'}],
   // leftward bands start inside the neighbour's crown at the right edge, the rightward one inside the trunk.
   forces:[{kind:'wind',x:1000,y:3150,w:2000,h:420,ax:-190,period:6,duty:0.45,phase:0,src:'sky'},
           {kind:'wind',x:900,y:2520,w:1900,h:460,ax:240,period:6,duty:0.45,phase:2,src:'sky'},
           {kind:'wind',x:1000,y:1880,w:2000,h:450,ax:-290,period:6,duty:0.45,phase:4,src:'sky'}],
   walls:[],
   pads:{start:{x:1880,y:5170,w:120,h:150}, target:{x:1680,y:1700,w:120,h:120,base:'bark'}}}
);
