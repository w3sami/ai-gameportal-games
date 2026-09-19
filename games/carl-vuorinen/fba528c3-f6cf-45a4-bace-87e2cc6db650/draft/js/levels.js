'use strict';
// Level data and derived geometry. Shapes are cut out of the solid mass; rocks, spikes, trunks, foliage and pad blocks are put back.
// Optional per level: theme ('cave' default | 'jungle'), groundY / canopyY (jungle terrain bands), trunks, foliage, spikes[].kind='branch'.
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
  {name:'Aperture', w:4400, h:2000,
   rooms:[{x:700,y:950,rx:560,ry:420,wob:0.08,seed:121}, {x:2200,y:900,rx:600,ry:450,wob:0.08,seed:122}, {x:3700,y:1000,rx:560,ry:420,wob:0.08,seed:123}, {x:4050,y:380,rx:250,ry:190,wob:0.1,seed:124}],
   corridors:[{pts:[[1200,930],[1450,900],[1700,900]],w:440}, {pts:[[2750,950],[2950,1000],[3200,1000]],w:440}, {pts:[[3820,640],[3920,540],[4000,470]],w:150}],
   rocks:[{x:560,y:760,r:60,seed:125}, {x:900,y:1150,r:50,seed:126}, {x:2050,y:700,r:55,seed:127}, {x:2400,y:1080,r:60,seed:128}, {x:2250,y:520,r:40,seed:129}, {x:3600,y:800,r:55,seed:130}, {x:3900,y:1150,r:45,seed:131}],
   spikes:[{x:1450,y:250,tx:1450,ty:780,w:300,seed:132}, {x:1450,y:1600,tx:1455,ty:930,w:320,seed:133}, {x:2950,y:300,tx:2950,ty:1010,w:300,seed:134}, {x:2950,y:1700,tx:2945,ty:1160,w:320,seed:135},
           {x:1150,y:520,tx:1180,ty:640,w:90,seed:136}, {x:1800,y:470,tx:1790,ty:600,w:100,seed:137}, {x:2600,y:480,tx:2620,ty:610,w:90,seed:138}, {x:3350,y:600,tx:3340,ty:720,w:90,seed:139}, {x:800,y:1380,tx:820,ty:1270,w:90,seed:140}, {x:3200,y:1420,tx:3180,ty:1300,w:100,seed:141}],
   walls:[],
   pads:{start:{x:350,y:1220,w:120,h:100}, target:{x:3990,y:520,w:120,h:100}}},
  {name:'The gauntlet', w:4600, h:1600,
   rooms:[{x:350,y:1200,rx:280,ry:200,wob:0.1,seed:131}, {x:1900,y:800,rx:420,ry:300,wob:0.09,seed:132}, {x:3200,y:650,rx:380,ry:300,wob:0.09,seed:133}, {x:4300,y:1150,rx:280,ry:210,wob:0.1,seed:134}],
   corridors:[{pts:[[600,1130],[800,1080],[1000,1000],[1200,900],[1450,820],[1550,800]],w:200}, {pts:[[2300,720],[2500,680],[2700,650],[2850,650]],w:300}, {pts:[[3550,700],[3750,800],[3950,950],[4100,1050]],w:150}],
   rocks:[{x:850,y:1005,r:30,seed:135}, {x:1100,y:1000,r:30,seed:136}, {x:1350,y:800,r:28,seed:137}, {x:1750,y:700,r:55,seed:138}, {x:1950,y:900,r:50,seed:139}, {x:2100,y:650,r:45,seed:140}, {x:1800,y:950,r:40,seed:141}],
   spikes:[{x:2400,y:440,tx:2410,ty:730,w:150,seed:142}, {x:2600,y:920,tx:2590,ty:640,w:150,seed:143}, {x:2800,y:400,tx:2790,ty:670,w:140,seed:144}, {x:3350,y:1000,tx:3330,ty:850,w:110,seed:146}],
   hazards:[{x:950,y:830,tx:955,ty:975,w:70,seed:147}, {x:1600,y:480,tx:1605,ty:690,w:80,seed:148}, {x:2200,y:480,tx:2195,ty:690,w:80,seed:149}, {x:2700,y:340,tx:2705,ty:590,w:70,seed:145}, {x:3100,y:280,tx:3110,ty:490,w:80,seed:150}],
   walls:[],
   pads:{start:{x:290,y:1350,w:120,h:100}, target:{x:4240,y:1310,w:120,h:100}}},
  {name:'Stalactites', w:3000, h:1500,
   rooms:[{x:330,y:1050,rx:280,ry:200,wob:0.1,seed:141}, {x:1550,y:750,rx:880,ry:430,wob:0.07,seed:142}, {x:2750,y:1050,rx:280,ry:210,wob:0.1,seed:143}],
   corridors:[{pts:[[590,1000],[750,950],[900,900]],w:170}, {pts:[[2380,880],[2520,950],[2620,1000]],w:160}],
   rocks:[],
   spikes:[{x:1000,y:280,tx:1010,ty:930,w:220,seed:144}, {x:1300,y:1260,tx:1290,ty:520,w:240,seed:145}, {x:1650,y:230,tx:1660,ty:1000,w:260,seed:146}, {x:1950,y:1260,tx:1940,ty:540,w:240,seed:147}, {x:2200,y:360,tx:2210,ty:800,w:210,seed:148},
           {x:1150,y:1200,tx:1140,ty:1070,w:90,seed:154}, {x:1500,y:1250,tx:1510,ty:1120,w:80,seed:155}, {x:1800,y:1250,tx:1790,ty:1050,w:100,seed:156}, {x:2100,y:1180,tx:2110,ty:1060,w:80,seed:157}],
   hazards:[{x:1150,y:300,tx:1160,ty:440,w:80,seed:149}, {x:1450,y:250,tx:1440,ty:460,w:90,seed:150}, {x:1800,y:230,tx:1810,ty:420,w:80,seed:151}, {x:2050,y:300,tx:2060,ty:490,w:90,seed:152}, {x:2350,y:620,tx:2340,ty:790,w:70,seed:153}],
   walls:[],
   pads:{start:{x:270,y:1200,w:120,h:100}, target:{x:2690,y:1210,w:120,h:100}}},
  {name:'The sump', w:2600, h:2400,
   rooms:[{x:400,y:500,rx:300,ry:210,wob:0.1,seed:151}, {x:1300,y:1900,rx:480,ry:320,wob:0.1,seed:152}, {x:2200,y:600,rx:300,ry:220,wob:0.1,seed:153}],
   corridors:[{pts:[[600,620],[700,850],[780,1100],[850,1350],[950,1600],[1050,1750]],w:150}, {pts:[[1600,1800],[1750,1550],[1800,1300],[1750,1050],[1850,800],[2000,680]],w:140}],
   rocks:[{x:1180,y:1800,r:55,seed:154}, {x:1450,y:2020,r:45,seed:155}], walls:[],
   pads:{start:{x:340,y:650,w:120,h:100}, target:{x:2140,y:760,w:120,h:100}}},
  {name:'Lattice', w:2800, h:1800,
   rooms:[{x:330,y:1250,rx:280,ry:200,wob:0.1,seed:161}, {x:1500,y:900,rx:880,ry:600,wob:0.06,seed:162}, {x:2550,y:600,rx:260,ry:200,wob:0.1,seed:163}],
   corridors:[{pts:[[580,1200],[720,1150],[820,1120]],w:170}, {pts:[[2330,700],[2430,660]],w:150}],
   rocks:[{x:2039,y:1157,r:44,ry:46,wob:0.35,seed:164}, {x:1719,y:740,r:48,ry:27,wob:0.33,seed:165}, {x:1365,y:1337,r:43,ry:33,wob:0.34,seed:166}, {x:1442,y:418,r:42,ry:23,wob:0.25,seed:167}, {x:1526,y:871,r:39,ry:40,wob:0.2,seed:168}, {x:819,y:751,r:32,ry:24,wob:0.32,seed:169}, {x:1212,y:583,r:46,ry:35,wob:0.29,seed:170}, {x:1697,y:496,r:49,ry:68,wob:0.29,seed:171}, {x:1752,y:1152,r:83,ry:51,wob:0.25,seed:172}, {x:1079,y:1292,r:34,ry:47,wob:0.35,seed:173}, {x:1136,y:1026,r:52,ry:60,wob:0.34,seed:174}, {x:2158,y:910,r:72,ry:79,wob:0.35,seed:175}, {x:912,y:1129,r:54,ry:53,wob:0.34,seed:176}, {x:1949,y:763,r:30,ry:38,wob:0.29,seed:177}, {x:2014,y:562,r:50,ry:29,wob:0.34,seed:178}, {x:1329,y:753,r:30,ry:23,wob:0.25,seed:179}, {x:1348,y:946,r:31,ry:29,wob:0.21,seed:180}, {x:1555,y:1385,r:34,ry:20,wob:0.19,seed:181}, {x:1028,y:770,r:33,ry:47,wob:0.25,seed:182}, {x:1433,y:1138,r:47,ry:40,wob:0.21,seed:183}, {x:1509,y:664,r:39,ry:27,wob:0.29,seed:184}, {x:1008,y:551,r:38,ry:40,wob:0.25,seed:185}, {x:809,y:936,r:36,ry:31,wob:0.21,seed:186}, {x:1834,y:915,r:26,ry:18,wob:0.26,seed:187}], walls:[],
   pads:{start:{x:270,y:1400,w:120,h:100}, target:{x:2490,y:730,w:120,h:100}}},
  {name:'Catacomb', w:3000, h:2000,
   rooms:[{x:350,y:1700,rx:280,ry:200,wob:0.1,seed:171}, {x:1000,y:1650,rx:220,ry:180,wob:0.1,seed:172}, {x:1000,y:1100,rx:220,ry:180,wob:0.1,seed:173}, {x:1700,y:1400,rx:240,ry:190,wob:0.1,seed:174}, {x:1700,y:700,rx:220,ry:180,wob:0.1,seed:175}, {x:2400,y:1050,rx:240,ry:190,wob:0.1,seed:176}, {x:2400,y:1750,rx:200,ry:160,wob:0.1,seed:177}, {x:500,y:900,rx:200,ry:160,wob:0.1,seed:178}, {x:2650,y:400,rx:280,ry:200,wob:0.1,seed:179}],
   corridors:[{pts:[[600,1700],[780,1680]],w:140}, {pts:[[1180,1600],[1350,1500],[1500,1430]],w:130}, {pts:[[1000,1450],[1000,1300]],w:130}, {pts:[[1180,1080],[1350,1000],[1550,850]],w:125}, {pts:[[1900,1350],[2100,1250],[2250,1150]],w:130}, {pts:[[1880,680],[2100,760],[2280,900]],w:125}, {pts:[[2450,860],[2520,650],[2580,540]],w:130}, {pts:[[1750,1580],[1900,1700],[2180,1760]],w:130}, {pts:[[820,1500],[660,1250],[540,1070]],w:125}],
   rocks:[{x:1700,y:1380,r:40,seed:180}, {x:2400,y:1030,r:38,seed:181}], walls:[],
   pads:{start:{x:290,y:1850,w:120,h:100}, target:{x:2590,y:560,w:120,h:100}}},
  {name:'Coil', w:2600, h:2600,
   rooms:[{x:350,y:2300,rx:280,ry:200,wob:0.1,seed:191}, {x:1300,y:1300,rx:220,ry:170,wob:0.1,seed:192}],
   corridors:[{pts:[[600,2250],[1200,2380],[1900,2350],[2250,2100],[2350,1600],[2300,1000],[2050,600],[1500,400],[900,450],[500,750],[400,1200],[550,1600],[900,1800],[1300,1850],[1600,1700],[1650,1400],[1450,1250]],w:175}],
   rocks:[], walls:[],
   pads:{start:{x:290,y:2450,w:120,h:100}, target:{x:1240,y:1400,w:120,h:100}}},
  {name:'Freefall', w:2200, h:3800,
   rooms:[{x:1100,y:380,rx:600,ry:260,wob:0.08,seed:201}, {x:1100,y:1900,rx:560,ry:1350,wob:0.05,seed:202}, {x:1100,y:3300,rx:480,ry:260,wob:0.09,seed:203}, {x:1900,y:3220,rx:240,ry:190,wob:0.1,seed:204}],
   corridors:[{pts:[[1500,3280],[1700,3240]],w:170}],
   rocks:[{x:900,y:3220,r:50,seed:205}, {x:1250,y:3400,r:40,seed:206}],
   spikes:[{x:520,y:1150,tx:1250,ty:1190,w:270,seed:207}, {x:1700,y:2000,tx:950,ty:2040,w:290,seed:208}, {x:540,y:2750,tx:1230,ty:2790,w:260,seed:209},
           {x:800,y:120,tx:820,ty:280,w:90,seed:210}, {x:1300,y:110,tx:1280,ty:300,w:110,seed:211}, {x:1550,y:170,tx:1540,ty:300,w:80,seed:212},
           {x:600,y:800,tx:700,ty:820,w:80,seed:213}, {x:1620,y:1500,tx:1520,ty:1520,w:90,seed:214}, {x:560,y:2350,tx:660,ty:2340,w:80,seed:215}, {x:1650,y:3050,tx:1540,ty:3060,w:80,seed:216},
           {x:700,y:3600,tx:720,ty:3480,w:90,seed:217}],
   walls:[],
   pads:{start:{x:660,y:540,w:120,h:100}, target:{x:1840,y:3340,w:120,h:100}}},
  {name:'Hairpin', w:3800, h:2200,
   rooms:[{x:400,y:450,rx:300,ry:210,wob:0.1,seed:221}, {x:3350,y:820,rx:280,ry:380,wob:0.09,seed:222}, {x:450,y:1500,rx:280,ry:380,wob:0.09,seed:223}, {x:3400,y:1850,rx:300,ry:210,wob:0.1,seed:224}],
   corridors:[{pts:[[680,450],[1400,430],[2200,450],[2900,470],[3150,520]],w:210}, {pts:[[3150,1130],[2400,1170],[1600,1150],[900,1180],[650,1200]],w:240}, {pts:[[650,1800],[1200,1840],[2000,1820],[2800,1850],[3120,1850]],w:210}],
   rocks:[{x:3330,y:820,r:75,seed:225}, {x:470,y:1500,r:70,ry:85,wob:0.22,seed:226}, {x:2300,y:1098,r:32,seed:227}, {x:1800,y:1227,r:32,seed:228}, {x:1300,y:1095,r:30,seed:229}],
   spikes:[{x:3500,y:400,tx:3480,ty:560,w:110,seed:230}, {x:3560,y:1260,tx:3540,ty:1090,w:110,seed:231}, {x:300,y:1080,tx:320,ty:1230,w:110,seed:232}, {x:330,y:1920,tx:350,ty:1770,w:110,seed:233}, {x:1000,y:260,tx:1010,ty:390,w:80,seed:234}, {x:2500,y:280,tx:2510,ty:400,w:80,seed:235}, {x:1100,y:1620,tx:1110,ty:1780,w:80,seed:236}, {x:2400,y:1630,tx:2390,ty:1785,w:90,seed:237}],
   hazards:[{x:3390,y:360,tx:3395,ty:600,w:90,seed:238}, {x:430,y:1060,tx:435,ty:1280,w:90,seed:239}],
   walls:[],
   pads:{start:{x:340,y:600,w:120,h:100}, target:{x:3340,y:2000,w:120,h:100}}},
  {name:'The long dark', w:4200, h:2700,
   rooms:[{x:380,y:2350,rx:310,ry:210,wob:0.1,seed:231}, {x:1300,y:2150,rx:500,ry:330,wob:0.09,seed:232}, {x:2150,y:1500,rx:400,ry:280,wob:0.1,seed:233}, {x:1250,y:1050,rx:360,ry:250,wob:0.1,seed:234}, {x:2450,y:520,rx:400,ry:260,wob:0.1,seed:235}, {x:3400,y:1100,rx:480,ry:320,wob:0.09,seed:236}, {x:3800,y:2250,rx:310,ry:210,wob:0.1,seed:237}],
   corridors:[{pts:[[620,2270],[850,2220],[980,2180]],w:170}, {pts:[[1720,2030],[1900,1870],[2050,1740]],w:150}, {pts:[[1960,1310],[1750,1220],[1520,1130],[1440,1110]],w:145}, {pts:[[1450,860],[1700,740],[1950,620],[2100,570]],w:140}, {pts:[[2780,570],[3000,700],[3180,850],[3300,950]],w:140}, {pts:[[3480,1440],[3600,1700],[3700,1950],[3760,2100]],w:150}, {pts:[[2500,1650],[2850,1550],[3150,1330]],w:125}],
   rocks:[{x:1200,y:2100,r:55,seed:238}, {x:1450,y:2250,r:45,seed:239}, {x:2100,y:1450,r:50,seed:240}, {x:2300,y:1600,r:40,seed:241}, {x:3300,y:1050,r:60,seed:242}, {x:3550,y:1200,r:50,seed:243}, {x:1250,y:1000,r:38,seed:244}, {x:2450,y:480,r:40,seed:245}],
   hazards:[{x:1100,y:1760,tx:1105,ty:1930,w:80,seed:246}, {x:2000,y:1160,tx:2005,ty:1330,w:80,seed:247}, {x:2300,y:1170,tx:2295,ty:1330,w:80,seed:248}, {x:3150,y:650,tx:3155,ty:880,w:90,seed:249}, {x:3500,y:720,tx:3495,ty:900,w:80,seed:250}, {x:2600,y:200,tx:2605,ty:360,w:80,seed:251}], walls:[],
   pads:{start:{x:320,y:2490,w:120,h:100}, target:{x:3740,y:2390,w:120,h:100}}},
  {name:'Canopy', theme:'jungle', w:2400, h:1400, groundY:1080, canopyY:400,
   rooms:[{x:1200,y:760,rx:1060,ry:480,wob:0.08,seed:261}],
   corridors:[],
   rocks:[{x:1250,y:1240,r:90,ry:70,wob:0.2,seed:262}],
   spikes:[{x:130,y:700,tx:340,ty:730,w:120,seed:264}, {x:915,y:900,tx:1140,ty:850,w:56,seed:265,kind:'branch'}, {x:1585,y:900,tx:1810,ty:860,w:52,seed:266,kind:'branch'}, {x:905,y:1050,tx:720,ty:1090,w:48,seed:267,kind:'branch'}],
   trunks:[{x:900,y1:1260,y0:700,lean:40,w:120,seed:268}, {x:1600,y1:1260,y0:640,lean:-30,w:96,seed:269}],
   foliage:[{x:950,y:640,r:200,ry:120,seed:270,tone:1}, {x:880,y:600,r:130,ry:85,seed:279,tone:2}, {x:1050,y:690,r:110,ry:70,seed:280,tone:0}, {x:1150,y:840,r:100,ry:60,seed:271,tone:2},
            {x:1560,y:560,r:190,ry:120,seed:272,tone:0}, {x:1630,y:510,r:120,ry:80,seed:281,tone:1}, {x:1480,y:610,r:100,ry:65,seed:282,tone:2}, {x:1820,y:850,r:95,ry:58,seed:273,tone:1},
            {x:300,y:280,r:220,ry:110,seed:275,tone:1}, {x:1250,y:300,r:150,ry:90,seed:276,tone:2}, {x:1180,y:270,r:100,ry:70,seed:283,tone:0}, {x:2050,y:320,r:240,ry:120,seed:277,tone:2}],
   hazards:[{x:1580,y:800,tx:1380,ty:860,w:46,seed:278,kind:'branch'}],
   walls:[],
   pads:{start:{x:300,y:1150,w:120,h:100}, target:{x:1950,y:1120,w:120,h:100}}},
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
// Spikes: stalactites, stalagmites and ledges. A jagged taper from a base buried in the rock at (x,y), width w,
// to a tip at (tx,ty). Straight edges only, like everything else. They are solids, so they go in with the rocks.
function spikePts(s){
  const r = rng(s.seed*3571+5), dx = s.tx-s.x, dy = s.ty-s.y, len = Math.hypot(dx,dy), ux = dx/len, uy = dy/len, nx = -uy, ny = ux;
  const n = 3+Math.floor(len/110), a = [], b = [];
  for (let i=0;i<=n;i++){
    const t = i/n, hw = s.w/2*(1-t*0.85)*(0.75+r()*0.5), tt = i>0 && i<n ? t+(r()-0.5)*0.5/n : t, px = s.x+ux*len*tt, py = s.y+uy*len*tt;
    a.push([px+nx*hw, py+ny*hw]); b.push([px-nx*hw, py-ny*hw]);
  }
  const j = (r()-0.5)*s.w*0.2;
  return a.concat([[s.tx+nx*j+ux*s.w*0.08, s.ty+ny*j+uy*s.w*0.08]], b.reverse());
}
// Trunks: a tapered, slightly leaning column from a base buried in the ground at (x,y1) to a top at (x+lean,y0),
// with a flared root. The top should sit inside a foliage blob. Straight edges only. Solids, like spikes.
function trunkPts(t){
  const r = rng(t.seed*2917+9), ax = t.x, ay = t.y1, bx = t.x+(t.lean||0), by = t.y0, dx = bx-ax, dy = by-ay, len = Math.hypot(dx,dy), ux = dx/len, uy = dy/len, nx = -uy, ny = ux;
  const n = 3+Math.floor(len/130), taper = 0.55, a = [], b = [];
  for (let i=0;i<=n;i++){
    const tt = i/n, flare = i === 0 ? 1.3 : 1, hw = t.w/2*(1-tt*taper)*flare*(0.88+r()*0.24), px = ax+ux*len*tt, py = ay+uy*len*tt;
    a.push([px+nx*hw, py+ny*hw]); b.push([px-nx*hw, py-ny*hw]);
  }
  return {pts:a.concat(b.reverse()), ax, ay, bx, by, w:t.w, taper};
}
function setGeom(){
  PADS = Object.values(L.pads);
  const rooms = L.rooms.map(r => polyPts(r.x,r.y,r.rx,r.ry,r.wob,r.seed));
  G = {
    rooms,
    caves: rooms.concat(...L.corridors.map(corridorBlobs)),
    rocks: L.rocks.map(r => ({cx:r.x,cy:r.y,r:r.r,pts:polyPts(r.x,r.y,r.r,r.ry||r.r,r.wob||0.18,r.seed)})).concat((L.spikes||[]).filter(sp => sp.kind !== 'branch').map(sp => ({pts:spikePts(sp)}))),
    trunks: (L.trunks||[]).map(trunkPts),
    branches: (L.spikes||[]).filter(sp => sp.kind === 'branch').map(sp => ({pts:spikePts(sp), ax:sp.x, ay:sp.y, bx:sp.tx, by:sp.ty, w:sp.w, taper:0.85})),
    foliage: (L.foliage||[]).map(f => ({x:f.x, y:f.y, r:f.r, ry:f.ry||f.r, tone:f.tone||0, seed:f.seed, pts:polyPts(f.x,f.y,f.r,f.ry||f.r,0.22,f.seed)})),
    clear: PADS.map(p => [p.x-34, p.y-190, p.w+68, 190]),
    blocks: PADS.map(p => [p.x-14, p.y, p.w+28, p.h||100]),
  };
  ZONES = Object.entries(L.pads).map(([key,p]) => ({key, x:p.x-14, w:p.w+28, y:p.y}));   // landing zones span the whole block top
}
