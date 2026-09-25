"use strict";
/* ============================================================
   dice3d.js — Three.js (grafiikka) + cannon.js (fysiikka)
   Vastaa vain nopan 3D-esityksestä ja fysiikkasimulaatiosta.
   Ei tiedä pisteytyksestä eikä vuoroista — GameLogic ohjaa sitä
   julkisen window.Dice3D-rajapinnan kautta.

   Moninpelitila: heittävä pelaaja pyörittää oman fysiikkansa
   normaalisti (throwDice/releaseCharge `record=true`) ja TALLENTAA
   sen samalla — jokaisen aktiivisen nopan sijainti+kiertymä kiinteällä
   ~30Hz aikavälillä (ks. captureFrame/loop). Kun heitto asettuu, koko
   nauhoitus lähetetään palvelimen kautta muille pelaajille, jotka
   TOISTAVAT sen (playTrajectory) sellaisenaan sen sijaan että
   ajaisivat omaa, väistämättä eri näköistä fysiikkaa kohti samaa
   lopputulosta (fysiikkasimulaatiot ovat kaoottisen herkkiä
   alkuarvoille — kaksi eri simulaatiota jotka päätyvät samaan
   silmälukuun näyttävät silti aivan erilaiselta pyörimiseltä matkalla).
   Näin kaikki huoneessa näkevät KIRJAIMELLISESTI saman heiton, eivät
   vain saman lopputuloksen.
   ============================================================ */
window.Dice3D = (function () {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer, scene, camera, world, wrap, fxC, fxG;
  const CAM_POS = new THREE.Vector3(0, 11.5, 7.2);
  const dice = [];
  let gameDiceCount = 5;
  let settleCb = null;
  let recordTickCb = null;
  let cfg = { nudge:false, parkHeld:true, sound:true };

  /* ---------- tila ---------- */
  let rolling = false, settled = false, charging = false, chargeT = 0;
  let diceValues = [0,0,0,0,0,0];
  let nudgeAvailable = false, settleFrames = 0, rollStart = 0, nudges = 0;
  let shakeT = 0, shakeAmp = 0;
  let last = performance.now();

  /* physicsActive: onko TÄMÄ asiakas se jonka pitäisi ajaa cannon.js-fysiikkaa
     juuri nyt. Yksinpelissä aina true (oma vuoro on aina "oma"). Moninpelissä
     mp-game.js asettaa tämän vuoron mukaan (setPhysicsActive(isMyTurn)) —
     vain vuorossa oleva pelaaja simuloi oikeaa fysiikkaa; muut ovat aina
     puhtaassa toistotilassa (ks. playTrajectory/updatePlayback, jotka eivät
     tarvitse world.step:iä koska liikuttavat noppia suoraan tallennetuista
     kehyksistä). Tämä pitää kaksi tilaa (simulointi vs. toisto) selkeästi
     erillään eivätkä ne voi häiritä toisiaan. */
  let physicsActive = true;
  function setPhysicsActive(active) { physicsActive = !!active; }

  /* ---------- Nauhoitus (heittävä asiakas) ja toisto (muut asiakkaat) ----------
     RECORD_HZ säätää kuinka usein nopan sijainti+kiertymä otetaan talteen heiton
     aikana (kiinteä aikaväli, ei sidottu ruudunpäivitysnopeuteen). Pienempi arvo
     = pienempi tiedonsiirto mutta karkeampi liike toisilla asiakkailla (ne
     interpoloivat pehmeästi näytteiden välillä joka tapauksessa) — säädettävissä
     tästä yhdestä kohdasta jos toisto näyttää nykiseltä tai liian raskaalta. */
  const RECORD_HZ = 10, RECORD_DT = 1 / RECORD_HZ;
  let recording = false, recFrames = [], recStart = 0, recAccum = 0;
  let playback = null; /* {frames, startTime, diceValues} */

  function configure(c) { Object.assign(cfg, c); }

  const DIE = 1.15, HALF = DIE/2;
  const TRAY_W = 11, TRAY_D = 7.6, WALL_H = 1.6;
  /* Suurin mahdollinen heittoteho — sama yläraja paina&pidä-heitolle
     (releaseCharge, ladataan chargeT:n mukaan), suoralle heitolle
     (throwDice, rajataan tähän) ja jumiutuneen/pinossa olevan nopan
     korjausheilautukselle (checkSettle) — pidetty yhdessä paikassa jotta
     korjausheilautus voi käyttää TÄSMÄLLEEN samaa "täysin ladattu heitto"
     -kierrettä eikä kolme kohtaa ajaudu erilleen jos jompaakumpaa säädetään. */
  const MAX_THROW_POWER = 2.2;
  const GRAVITY_Y = 24; /* world.gravity.set(0,-GRAVITY_Y,0) — sama arvo, nimettynä koska
    jumiutuneen nopan korjausheilautus laskee tarvittavan pystynopeuden tästä (ks. checkSettle). */

  function feltTexture() {
    const c = document.createElement('canvas'); c.width=c.height=256;
    const g = c.getContext('2d');
    g.fillStyle='#1e5b45'; g.fillRect(0,0,256,256);
    for(let i=0;i<2600;i++){
      g.fillStyle=`rgba(${10+Math.random()*30|0},${60+Math.random()*40|0},${40+Math.random()*25|0},.25)`;
      g.fillRect(Math.random()*256,Math.random()*256,1.4,1.4);
    }
    const t=new THREE.CanvasTexture(c);
    t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(3,2);
    return t;
  }

  function pipTexture(n) {
    const c=document.createElement('canvas'); c.width=c.height=256;
    const g=c.getContext('2d');
    const grad=g.createLinearGradient(0,0,256,256);
    grad.addColorStop(0,'#faf5e8'); grad.addColorStop(1,'#eee5cf');
    g.fillStyle=grad; g.fillRect(0,0,256,256);
    g.strokeStyle='rgba(120,100,70,.35)'; g.lineWidth=8; g.strokeRect(4,4,248,248);
    const P={1:[[.5,.5]],2:[[.26,.26],[.74,.74]],3:[[.24,.24],[.5,.5],[.76,.76]],
             4:[[.27,.27],[.73,.27],[.27,.73],[.73,.73]],
             5:[[.25,.25],[.75,.25],[.5,.5],[.25,.75],[.75,.75]],
             6:[[.27,.22],[.73,.22],[.27,.5],[.73,.5],[.27,.78],[.73,.78]]};
    g.fillStyle='#2b241c';
    P[n].forEach(([x,y])=>{
      g.beginPath(); g.arc(x*256,y*256,26,0,Math.PI*2); g.fill();
      g.fillStyle='rgba(255,255,255,.25)';
      g.beginPath(); g.arc(x*256-7,y*256-7,8,0,Math.PI*2); g.fill();
      g.fillStyle='#2b241c';
    });
    return new THREE.CanvasTexture(c);
  }

  /* BoxGeometry-materiaalijärjestys: +x,-x,+y,-y,+z,-z  → arvot 3,4,1,6,2,5 (vastakkaiset = 7) */
  const FACE_AXES = [
    [new THREE.Vector3( 1,0,0),3],[new THREE.Vector3(-1,0,0),4],
    [new THREE.Vector3(0, 1,0),1],[new THREE.Vector3(0,-1,0),6],
    [new THREE.Vector3(0,0, 1),2],[new THREE.Vector3(0,0,-1),5],
  ];

  function topFace(mesh) {
    const up=new THREE.Vector3(0,1,0);
    let best=-2, val=1;
    for(const [axis,v] of FACE_AXES){
      const d=axis.clone().applyQuaternion(mesh.quaternion).dot(up);
      if(d>best){best=d; val=v;}
    }
    return {val, dot:best};
  }

  /* Aseta nopan orientaatio niin että haluttu arvo osoittaa ylös, välittömästi
     ilman animaatiota. Käytetään enää harvinaisena varatapauksena
     playTrajectory:ssä, jos toistodataa ei jostain syystä ole saatavilla
     (esim. myöhässä liittynyt/uudelleenyhdistynyt pelaaja, joka ei ollut
     paikalla heiton tapahtuessa) — silloin näytetään suoraan lopputulos
     ilman että kukaan yrittää arvata miltä tuntematon tumppaus näytti. */
  function forceFaceUp(d, value) {
    const target = FACE_AXES.find(([,v])=>v===value)[0];
    const from = target.clone();
    const to = new THREE.Vector3(0,1,0);
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    /* pieni satunnainen kierto pystyakselin ympäri, ettei jokainen heitto näytä identtiseltä */
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.random()*Math.PI*2);
    q.premultiply(spin);
    d.body.quaternion.set(q.x,q.y,q.z,q.w);
    d.body.position.y = HALF;
    d.body.velocity.setZero(); d.body.angularVelocity.setZero();
  }

  function init(wrapEl) {
    wrap = wrapEl;
    renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.insertBefore(renderer.domElement, wrap.firstChild);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(46, 1, .1, 100);
    camera.position.copy(CAM_POS);
    camera.lookAt(0,0,.4);

    scene.add(new THREE.AmbientLight(0xfff2dd,.55));
    const key = new THREE.DirectionalLight(0xffe8c0,.95);
    key.position.set(4,12,5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024,1024);
    key.shadow.camera.left=-8; key.shadow.camera.right=8;
    key.shadow.camera.top=8; key.shadow.camera.bottom=-8;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff,.25);
    fill.position.set(-5,6,-4); scene.add(fill);

    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(TRAY_W,TRAY_D),
      new THREE.MeshStandardMaterial({map:feltTexture(), roughness:.95})
    );
    floorMesh.rotation.x=-Math.PI/2; floorMesh.receiveShadow=true;
    scene.add(floorMesh);

    const woodMat = new THREE.MeshStandardMaterial({color:0x5c4331, roughness:.7});
    function rim(w,d,x,z){
      const m=new THREE.Mesh(new THREE.BoxGeometry(w,WALL_H,d), woodMat);
      m.position.set(x,WALL_H/2-.05,z); m.castShadow=m.receiveShadow=true;
      scene.add(m);
    }
    rim(TRAY_W+1,.5,0,-TRAY_D/2-.25);
    rim(TRAY_W+1,.5,0, TRAY_D/2+.25);
    rim(.5,TRAY_D,-TRAY_W/2-.25,0);
    rim(.5,TRAY_D, TRAY_W/2+.25,0);

    world = new CANNON.World();
    world.gravity.set(0,-GRAVITY_Y,0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 12;

    const matFloor = new CANNON.Material('floor');
    const matDie   = new CANNON.Material('die');
    world.addContactMaterial(new CANNON.ContactMaterial(matFloor, matDie, {friction:.15, restitution:.42}));
    world.addContactMaterial(new CANNON.ContactMaterial(matDie, matDie, {friction:.08, restitution:.5}));

    const floorBody = new CANNON.Body({mass:0, material:matFloor, shape:new CANNON.Plane()});
    floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
    world.addBody(floorBody);
    function wallBody(nx,nz,dist){
      const b=new CANNON.Body({mass:0, material:matFloor, shape:new CANNON.Plane()});
      const angle = Math.atan2(nx,nz);
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(0,1,0), angle);
      b.position.set(-nx*dist,0,-nz*dist);
      world.addBody(b);
    }
    wallBody(0, 1, TRAY_D/2);
    wallBody(0,-1, TRAY_D/2);
    wallBody( 1,0, TRAY_W/2);
    wallBody(-1,0, TRAY_W/2);

    const dieMats = [3,4,1,6,2,5].map(n=>new THREE.MeshStandardMaterial({map:pipTexture(n), roughness:.35, metalness:.05}));
    for(let i=0;i<6;i++){
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(DIE,DIE,DIE), dieMats.map(m=>m.clone()));
      mesh.castShadow=mesh.receiveShadow=true;
      scene.add(mesh);
      const ring=new THREE.Mesh(
        new THREE.RingGeometry(.78,.98,40),
        new THREE.MeshBasicMaterial({color:0xffd66b, transparent:true, opacity:.9, side:THREE.DoubleSide})
      );
      ring.rotation.x=-Math.PI/2; ring.position.y=.02; ring.visible=false;
      scene.add(ring);
      const body=new CANNON.Body({mass:1, material:matDie,
        shape:new CANNON.Box(new CANNON.Vec3(HALF,HALF,HALF))});
      body.position.set(-4+i*2, HALF, 2.4);
      body.sleepSpeedLimit=.12;
      body.addEventListener('collide', e=>{
        const v=e.contact.getImpactVelocityAlongNormal();
        if(Math.abs(v)>1.2 && rolling && window.UI) window.UI.clack(Math.abs(v));
      });
      world.addBody(body);
      dice.push({mesh, body, ring, held:false, value:0});
    }
    setActiveDiceCount(5);

    fxC = document.getElementById('fx'); fxG = fxC.getContext('2d');

    addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  const activeDice = () => dice.slice(0, gameDiceCount);

  function setActiveDiceCount(n) {
    gameDiceCount = n;
    dice.forEach((d,i)=>{
      const on=i<n;
      d.mesh.visible=on; d.ring.visible=false;
      d.held=false; d.value=0; d.parkTarget=null; delete d.hover;
      const b=d.body;
      b.velocity.setZero(); b.angularVelocity.setZero();
      if(on){
        b.type=CANNON.Body.DYNAMIC; b.mass=1; b.updateMassProperties();
        b.position.set(-3.75+i*1.5, HALF, 2.4);
        b.quaternion.set(0,0,0,1);
      } else {
        b.type=CANNON.Body.STATIC; b.mass=0; b.updateMassProperties();
        b.position.set(0,-10,0);
      }
    });
    diceValues = new Array(n).fill(0);
  }

  function applyColor(hex) {
    dice.forEach(d=>d.mesh.material.forEach(m=>m.color.set(hex||'#ffffff')));
  }

  function resetHeld() {
    activeDice().forEach(d=>{
      d.held=false; d.ring.visible=false; d.parkTarget=null;
      d.body.type=CANNON.Body.DYNAMIC; d.body.mass=1; d.body.updateMassProperties();
    });
  }

  function getHeld(i) { return !!(dice[i] && dice[i].held); }
  function setHeld(i, held) { if (getHeld(i) !== !!held) toggleHeld(i); }
  function getValues() { return diceValues.slice(0, gameDiceCount); }
  function isRolling() { return rolling; }
  function isSettled() { return settled; }
  function isCharging() { return charging; }
  function onSettle(cb) { settleCb = cb; }

  /* Palauttaa noppien NÄKYVÄN tilan (silmäluvut + pito) suoraan palvelimen
     lähettämästä tilasta, ilman fysiikkaa tai toistoa. Käytetään VAIN kun
     asiakas liittyy takaisin kesken olevaan peliin (room:rejoin — esim.
     sivun päivitys), koska sillä ei ole mitään nauhoitusta tai fysiikkaa
     josta johtaa nykyinen asento: se ei ollut paikalla kun heitto tapahtui.
     Ei animaatiota — nopat "ilmestyvät" suoraan oikeaan asentoonsa, mikä on
     odotettavaa juuri uudelleenliittymisessä (ks. forceFaceUp-kommentti,
     samaa käytetään playTrajectoryn varatapauksessa myöhässä liittyneelle). */
  function restoreDisplay(values, heldArr) {
    playback = null; rolling = false; charging = false; settled = true;
    activeDice().forEach((d, i) => {
      d.held = !!(heldArr && heldArr[i]);
      d.parkTarget = null; delete d.hover;
      const b = d.body;
      b.velocity.setZero(); b.angularVelocity.setZero(); b.wakeUp();
      b.type = d.held ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
      b.mass = d.held ? 0 : 1;
      b.updateMassProperties();
      const v = values && values[i];
      if (v) { forceFaceUp(d, v); d.value = v; } else { d.value = 0; }
      d.mesh.position.copy(b.position);
      d.mesh.quaternion.copy(b.quaternion);
      d.ring.visible = d.held;
    });
    diceValues = activeDice().map(d => d.value);
  }

  /* Jatkaa KESKENERÄISTÄ omaa heittoa täsmälleen siitä tilasta mihin se jäi
     ennen sivun päivitystä — reilun pelin vuoksi (ks. mp-game.js:n
     talteenotto onRecordTick:illa/localStorage): jos pelaaja päivittää
     sivun juuri ennen kuin nopat asettuvat (koska tulos ei näytä hyvältä),
     tämä EI anna heittää uudelleen tyhjästä, vaan fysiikka jatkaa samasta
     nauhoitetusta tilanteesta ja päätyy (deterministisenä jatkumona) samaan
     lopputulokseen kuin ilman päivitystä olisi tullut.
     `snapshot.frames` on sama nauhoitusdata joka lopulta lähetetään
     palvelimelle muiden toistettavaksi — jatketaan SAMAA taulukkoa (ei
     aloiteta tyhjästä) jotta lopullinen trajectory kattaa koko heiton alusta
     asti, ei vain uudelleenlatauksen jälkeistä osaa. */
  function resumeFrom(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.dice)) return false;
    playback = null; charging = false; settled = false; rolling = true;
    activeDice().forEach((d, i) => {
      const s = snapshot.dice[i];
      if (!s) return;
      d.held = !!s.held;
      d.value = s.value || 0;
      d.parkTarget = null; delete d.hover;
      const b = d.body;
      b.type = d.held ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
      b.mass = d.held ? 0 : 1;
      b.updateMassProperties();
      b.position.set(s.p[0], s.p[1], s.p[2]);
      b.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
      b.velocity.set(s.v[0], s.v[1], s.v[2]);
      b.angularVelocity.set(s.av[0], s.av[1], s.av[2]);
      b.wakeUp();
      d.mesh.position.copy(b.position);
      d.mesh.quaternion.copy(b.quaternion);
      d.ring.visible = d.held;
    });
    diceValues = activeDice().map(d => d.value);
    settleFrames = 0; nudges = 0; rollStart = performance.now();
    /* Jatka SAMAA nauhoitusta (recFrames) alkuperäisestä taulukosta —
       recStart siirretään taaksepäin niin että seuraava captureFrame
       laskee ajan jatkuvasti siitä mihin viimeinen tallennettu kehys jäi. */
    recording = true;
    recFrames = Array.isArray(snapshot.frames) ? snapshot.frames.slice() : [];
    const lastT = recFrames.length ? recFrames[recFrames.length - 1].t : 0;
    recStart = performance.now() - lastT;
    recAccum = 0;
    return true;
  }

  function snapUpright(d) {
    const q=d.mesh.quaternion, e=new THREE.Euler().setFromQuaternion(q);
    const s=Math.PI/2;
    e.x=Math.round(e.x/s)*s; e.y=Math.round(e.y/s)*s; e.z=Math.round(e.z/s)*s;
    const nq=new THREE.Quaternion().setFromEuler(e);
    d.body.quaternion.set(nq.x,nq.y,nq.z,nq.w);
    if(d.body.position.y<DIE) d.body.position.y=HALF;
    d.body.velocity.setZero(); d.body.angularVelocity.setZero();
  }

  function randSpin(b,P) {
    let wx=Math.random()-.5, wy=Math.random()-.5, wz=Math.random()-.5;
    const wl=Math.sqrt(wx*wx+wy*wy+wz*wz)||1;
    const wm=(18+Math.random()*24)*P;
    b.angularVelocity.set(wx/wl*wm, wy/wl*wm, wz/wl*wm);
  }

  /* toggleHeld: palauttaa true jos nyt lukittu.
     Jos tämä noppa on PARHAILLAAN toiston (playTrajectory) kohteena —
     eli joku muu pelaaja heitti ja tämä asiakas on kesken sen tumpun
     toistoa — pito-LIPPU (ja rengasnäkyvyys) päivitetään heti, mutta
     fysiikkarunkoon (STATIC/DYNAMIC, snapUpright) ei kosketa ennen kuin
     toisto päättyy. Muuten noppa jäätyisi kesken tumpun väärään
     asentoon eikä koskaan saisi oikeaa silmälukua (ks. updatePlayback:n
     finalize, joka soveltaa lopullisen pito-tilan vasta kun toisto on
     valmis). Tämä oli aiemman "jäi jumiin" -vian juurisyy: pito saapui
     kesken toisen pelaajan toiston ja rikkoi sen tilakoneen. */
  function toggleHeld(i) {
    const d = dice[i]; if(!d) return false;
    d.held=!d.held;
    d.parkTarget=null;
    const midPlayback = playback && !playback.heldMask[i];
    if (midPlayback) return d.held;
    if(d.held){
      snapUpright(d);
      d.body.type=CANNON.Body.STATIC; d.body.mass=0; d.body.updateMassProperties();
    } else {
      d.body.type=CANNON.Body.DYNAMIC; d.body.mass=1; d.body.updateMassProperties();
    }
    return d.held;
  }

  const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
  function hitTestDie(clientX, clientY) {
    const r=renderer.domElement.getBoundingClientRect();
    pointer.x=((clientX-r.left)/r.width)*2-1;
    pointer.y=-((clientY-r.top)/r.height)*2+1;
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects(activeDice().map(d=>d.mesh))[0];
    if(!hit) return -1;
    return dice.findIndex(d=>d.mesh===hit.object);
  }

  function nudgeAt(clientX, clientY) {
    if(!cfg.nudge || !nudgeAvailable) return false;
    nudgeAvailable=false;
    const r=renderer.domElement.getBoundingClientRect();
    pointer.x=((clientX-r.left)/r.width)*2-1;
    pointer.y=-((clientY-r.top)/r.height)*2+1;
    raycaster.setFromCamera(pointer,camera);
    const o=raycaster.ray.origin, dir=raycaster.ray.direction;
    const t=-o.y/dir.y;
    const px=o.x+dir.x*t, pz=o.z+dir.z*t;
    activeDice().forEach(d=>{
      if(d.held) return;
      d.body.wakeUp();
      let dx=d.body.position.x-px, dz=d.body.position.z-pz;
      const len=Math.sqrt(dx*dx+dz*dz)||1;
      const f=3.5/Math.max(len,.8);
      d.body.applyImpulse(new CANNON.Vec3(dx/len*f, 3.2+Math.random(), dz/len*f), d.body.position);
    });
    settleFrames=0;
    return true;
  }
  function isNudgeAvailable() { return nudgeAvailable; }

  /* ---------- Nauhoitus ---------- */
  function captureFrame(t) {
    recFrames.push({
      t,
      dice: activeDice().map(d => ({
        p: [d.body.position.x, d.body.position.y, d.body.position.z],
        q: [d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w],
      })),
    });
    /* Sama ~10Hz nauhoitustahti kelpaa myös "keskeneräisen heiton" tilan
       jatkuvaan talteenottoon (localStorage) reilun heiton varmistamiseksi —
       ks. mp-game.js:n onRecordTick-käyttö. Ei uutta erillistä ajastinta,
       vain kutsu tässä jo olemassa olevassa nauhoituskohdassa. Nopeus (v/av)
       EI kuulu palvelimelle lähetettävään trajectory-dataan (vain p/q, koska
       muut asiakkaat pelkästään interpoloivat sijainteja) mutta TARVITAAN
       paikallisen fysiikan jatkamiseen sivun päivityksen jälkeen. */
    if (recordTickCb) {
      recordTickCb({
        frames: recFrames,
        dice: activeDice().map(d => ({
          p: [d.body.position.x, d.body.position.y, d.body.position.z],
          q: [d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w],
          v: [d.body.velocity.x, d.body.velocity.y, d.body.velocity.z],
          av: [d.body.angularVelocity.x, d.body.angularVelocity.y, d.body.angularVelocity.z],
          held: d.held,
          value: d.value,
        })),
      });
    }
  }
  function onRecordTick(cb) { recordTickCb = cb; }
  function beginRecording() {
    recording = true; recFrames = []; recStart = performance.now(); recAccum = 0;
    captureFrame(0);
  }

  /* ---------- Heitto ----------
     `record`: true kun TÄMÄ asiakas on vuorossa oleva heittäjä — silloin
     fysiikka nauhoitetaan (ks. beginRecording/captureFrame) ja lopullinen
     nauhoitus palautetaan onSettle-kutsun toisena parametrina, jotta
     mp-game.js voi lähettää sen palvelimelle muiden toistettavaksi. */
  function throwDice(power, record) {
    if(rolling) return;
    rolling=true; settled=false;
    nudgeAvailable = cfg.nudge;
    const P=Number.isFinite(power)?Math.min(Math.max(power,1),MAX_THROW_POWER):1;
    if(cfg.parkHeld){
      const held=activeDice().filter(d=>d.held);
      held.forEach((d,i)=>{
        const x=-(held.length-1)*.75+i*1.5;
        d.parkTarget={x, y:HALF, z:TRAY_D/2-.85};
      });
    }
    let slot=0;
    activeDice().forEach(d=>{
      if(d.held) return;
      d.value=0;
      const b=d.body;
      b.type=CANNON.Body.DYNAMIC; b.mass=1; b.updateMassProperties();
      b.wakeUp();
      b.position.set(-3.75+slot*1.5+(Math.random()-.5)*.5, 4.5+Math.random()*1.5, TRAY_D/2-1.2);
      slot++;
      b.quaternion.setFromEuler(Math.random()*6.3,Math.random()*6.3,Math.random()*6.3);
      b.velocity.set((Math.random()-.5)*4*P, -1-Math.random()*2, (-7-Math.random()*4)*P);
      randSpin(b,P);
    });
    settleFrames=0; rollStart=performance.now(); nudges=0;
    if (record) beginRecording(); else recording = false;
  }

  function startCharge() {
    if(charging || rolling) return;
    charging=true; chargeT=0;
    if(cfg.parkHeld){
      const held=activeDice().filter(d=>d.held);
      held.forEach((d,i)=>{
        const x=-(held.length-1)*.75+i*1.5;
        d.parkTarget={x, y:HALF, z:TRAY_D/2-.85};
      });
    }
    let slot=0;
    activeDice().forEach(d=>{
      if(d.held) return;
      d.value=0;
      const b=d.body;
      b.type=CANNON.Body.KINEMATIC;
      b.velocity.setZero(); b.angularVelocity.setZero(); b.wakeUp();
      d.hover={
        ax:-3.75+slot*1.5, ay:3.1, az:.4,
        p1:Math.random()*6.3, p2:Math.random()*6.3,
        sx:Math.random()-.5+.05, sy:Math.random()-.5, sz:Math.random()-.5
      };
      slot++;
    });
  }

  function releaseCharge(record) {
    if(!charging) return;
    charging=false;
    rolling=true; settled=false;
    nudgeAvailable = cfg.nudge;
    const P=Math.min(1+chargeT*.6, MAX_THROW_POWER);
    activeDice().forEach(d=>{
      if(d.held) return;
      delete d.hover;
      d.value=0;
      const b=d.body;
      b.type=CANNON.Body.DYNAMIC; b.mass=1; b.updateMassProperties(); b.wakeUp();
      b.velocity.set((Math.random()-.5)*4*P, -1-Math.random()*2, (-6-Math.random()*4)*P);
      randSpin(b,P);
    });
    settleFrames=0; rollStart=performance.now(); nudges=0;
    if (record) beginRecording(); else recording = false;
  }

  function cancelCharge() {
    /* moninpelissä ei käytetä pito-heittoa, mutta pidetään rajapinta valmiina */
    charging=false;
  }

  function checkSettle(dt) {
    if(!rolling) return;
    const moving = activeDice().filter(d=>!d.held).some(d=>
      d.body.velocity.length()>.12 || d.body.angularVelocity.length()>.15
    );
    if(!moving) settleFrames++; else settleFrames=0;
    const timeout = performance.now()-rollStart>6500;
    if(settleFrames>=25 || timeout){
      const REST_Y = HALF + 0.06;
      const cocked  = activeDice().filter(d=>!d.held && topFace(d.mesh).dot<.98);
      const stacked = activeDice().filter(d=>!d.held && d.body.position.y>REST_Y);
      const bad=[...new Set([...cocked,...stacked])];
      if(bad.length && nudges<8){
        nudges++;
        rollStart=performance.now();
        /* Jumiutuneen (pinossa/vinossa levänneen) nopan korjausheilautus —
           vaakasuora "tönäisy" on n. 10x aiempaa vahvempi (aiempi versio oli
           liian heikko näyttämään tarkoitukselliselta) PLUS sama maksimikierre
           kuin täydellä ladatulla heitolla (randSpin MAX_THROW_POWER:lla, ks.
           releaseCharge/throwDice) sen sijaan että noppa vain pomppaisi ilman
           kunnon pyörimistä — näyttää siltä että noppa oikeasti heitetään
           uudelleen, ei että sitä vain nykäistään.
           PYSTYSUORA nopeus: tavoite on että noppa hyppää n. 3-4x OMAN
           särmänsä (DIE) korkeudelle ilmaan — ei mielivaltainen kerroin vaan
           laskettu suoraan tästä tavoitekorkeudesta putoamisliikkeen kaavalla
           v=√(2·g·h) (g=GRAVITY_Y, sama kuin world.gravity). Kokeiltiin ensin
           suoraa 10x-kerrointa pystynopeuteenkin, mutta se lensi mitattuna
           ~28 yksikköä pöydän yläpuolelle asti eli reilusti kameran
           (CAM_POS.y=11.5) yläpuolelle — näytti rikkinäiseltä "avaruuteen
           ampumiselta", ei tönäisyltä. */
        bad.forEach(d=>{
          d.body.wakeUp();
          const onTop=d.body.position.y>REST_Y;
          const h=(onTop?3:1.8)*10;
          const hopHeight = DIE * (3 + Math.random()); // 3x-4x nopan särmän pituus
          const up = Math.sqrt(2 * GRAVITY_Y * hopHeight);
          let kx, kz;
          if(onTop){
            const ang=Math.random()*Math.PI*2;
            kx=Math.cos(ang)*h; kz=Math.sin(ang)*h;
          } else {
            const px=d.body.position.x, pz=d.body.position.z;
            const len=Math.sqrt(px*px+pz*pz)||1;
            kx=(-px/len + (Math.random()-.5)*.5)*h;
            kz=(-pz/len + (Math.random()-.5)*.5)*h;
          }
          d.body.applyImpulse(new CANNON.Vec3(kx, up, kz), d.body.position);
          randSpin(d.body, MAX_THROW_POWER);
          if(onTop && window.UI) window.UI.clack(4);
        });
        settleFrames=0; return;
      }
      if(bad.length){
        activeDice().forEach(d=>{ if(!d.held) snapUpright(d); });
      }
      rolling=false; settled=true;
      activeDice().forEach(d=>{ d.value = topFace(d.mesh).val; });
      diceValues = activeDice().map(d=>d.value);
      let trajectory = null;
      if (recording) {
        captureFrame(performance.now() - recStart); // viimeinen kehys tarkasti pysähtymishetkellä
        trajectory = recFrames;
        recording = false; recFrames = [];
      }
      if(settleCb) settleCb(diceValues.slice(), trajectory);
    }
  }

  /* ---------- Toisto (muut asiakkaat kuin heittäjä) ----------
     Ei omaa fysiikkaa lainkaan tälle heitolle — nopat asetetaan suoraan
     nauhoitetuista kehyksistä (interpoloiden niiden välillä) niin että
     kaikki huoneessa näkevät saman tumpun, ei vain saman lopputuloksen.

     heldMask otetaan kiinteäksi TALTEEN toiston alkaessa eikä siihen
     kosketa enää toiston aikana, VAIKKA d.held-lippu muuttuisi kesken
     toiston (pelaaja merkitsee jonkin nopan pidettäväksi SEURAAVAA
     heittoa varten heti nähtyään tuloksen, ennen kuin muiden ruudulla
     ehtii edes näkyä koko tumppu). Ilman tätä pysyvää tilannekuvaa
     pito-tapahtuma kesken toiston jäädyttäisi kyseisen nopan väärään
     kohtaan tumppua eikä se koskaan saisi oikeaa silmälukua — se oli
     aiemman "jäi jumiin" -vian juurisyy. Live d.held-lippua käytetään
     silti LOPULLISEN fysiikkatilan (STATIC/DYNAMIC) asettamiseen kun
     toisto päättyy, jotta mahdollinen kesken toiston tullut pito
     tulee oikein voimaan heti toiston valmistuttua. */
  function playTrajectory(trajectory, values) {
    if (!Array.isArray(trajectory) || !trajectory.length) {
      /* ei nauhoitusta saatavilla (esim. myöhässä liittynyt pelaaja) —
         näytä lopputulos suoraan ilman animaatiota */
      activeDice().forEach((d, i) => {
        if (d.held || values[i] === undefined) return;
        forceFaceUp(d, values[i]);
        d.value = values[i];
      });
      diceValues = activeDice().map(d => d.value);
      rolling = false; settled = true;
      if (settleCb) settleCb(diceValues.slice());
      return;
    }
    rolling = true; settled = false;
    const heldMask = activeDice().map(d => d.held);
    playback = { frames: trajectory, startTime: performance.now(), diceValues: values.slice(), heldMask };
    activeDice().forEach((d, idx) => {
      if (heldMask[idx]) return;
      d.body.type = CANNON.Body.KINEMATIC;
      d.body.velocity.setZero(); d.body.angularVelocity.setZero();
      d.body.wakeUp();
    });
  }

  function updatePlayback() {
    if (!playback) return;
    const elapsed = performance.now() - playback.startTime;
    const frames = playback.frames;
    const heldMask = playback.heldMask;
    let i = 0;
    while (i < frames.length - 1 && frames[i + 1].t <= elapsed) i++;
    const fa = frames[i], fb = frames[Math.min(i + 1, frames.length - 1)];
    const span = fb.t - fa.t;
    const frac = span > 0 ? Math.min(1, Math.max(0, (elapsed - fa.t) / span)) : 1;
    activeDice().forEach((d, idx) => {
      /* HUOM: myös ennen tätä heittoa pidetyt (heldMask[idx]===true) nopat
         animoidaan nauhoituksesta — jos heittäjällä oli "lukitut nopat
         reunalle" (parkHeld) päällä, ne liikkuivat heiton alkaessa reunaan,
         ja se liike ON osa nauhoitettua tumppua (captureFrame tallentaa
         KAIKKI aktiiviset nopat joka näytteellä, ei vain heitettäviä).
         Aiemmin tämä ohitettiin täysin, jolloin muiden ruuduilla lukitut
         nopat jäivät paikoilleen ja menivät päällekkäin uuden heiton kanssa. */
      const a = fa.dice[idx], b = fb.dice[idx];
      if (!a || !b) return;
      d.body.position.set(
        a.p[0] + (b.p[0] - a.p[0]) * frac,
        a.p[1] + (b.p[1] - a.p[1]) * frac,
        a.p[2] + (b.p[2] - a.p[2]) * frac
      );
      const qa = new THREE.Quaternion(a.q[0], a.q[1], a.q[2], a.q[3]);
      const qb = new THREE.Quaternion(b.q[0], b.q[1], b.q[2], b.q[3]);
      qa.slerp(qb, frac);
      d.body.quaternion.set(qa.x, qa.y, qa.z, qa.w);
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
    });
    const lastT = frames[frames.length - 1].t;
    if (elapsed >= lastT) {
      const finalValues = playback.diceValues;
      activeDice().forEach((d, idx) => {
        if (!heldMask[idx]) d.value = finalValues[idx] !== undefined ? finalValues[idx] : d.value;
        /* lopullinen fysiikkatila LIVE d.held-lipun mukaan — voi olla eri
           kuin heldMask[idx] jos pelaaja piti tämän nopan kesken toiston */
        if (d.held) {
          snapUpright(d);
          d.body.type = CANNON.Body.STATIC; d.body.mass = 0; d.body.updateMassProperties();
        } else {
          d.body.type = CANNON.Body.DYNAMIC; d.body.mass = 1; d.body.updateMassProperties();
          d.body.velocity.setZero(); d.body.angularVelocity.setZero();
        }
      });
      diceValues = activeDice().map(d => d.value);
      rolling = false; settled = true;
      playback = null;
      if (settleCb) settleCb(diceValues.slice());
    }
  }

  function shakeCamera(a) { if(REDUCED) return; shakeAmp=a*.02; shakeT=.6; }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt=Math.min((now-last)/1000,.05); last=now;
    /* Toiston aikana nopat liikkuvat suoraan tallennetuista kehyksistä
       (KINEMATIC-rungot, ei voimia) — world.step ei tee siinä mitään
       hyödyllistä. Kun ei ole oma vuoro eikä toistoa käynnissä, nopat
       lepäävät paikallaan eikä simulaatiota tarvita ollenkaan. */
    if (physicsActive && !playback) world.step(1/60, dt, 4);
    if(charging){
      chargeT+=dt;
      const t=now/1000;
      const spinSpeed=Math.min(5+chargeT*7, 18);
      dice.forEach(d=>{
        if(!d.hover) return;
        const b=d.body, hv=d.hover;
        b.position.set(
          hv.ax + Math.sin(t*5.1+hv.p1)*.32,
          hv.ay + Math.sin(t*7.3+hv.p2)*.24,
          hv.az + Math.cos(t*4.4+hv.p1)*.3
        );
        const axis=new CANNON.Vec3(hv.sx,hv.sy,hv.sz);
        axis.normalize();
        const dq=new CANNON.Quaternion();
        dq.setFromAxisAngle(axis, spinSpeed*dt);
        b.quaternion = dq.mult(b.quaternion);
      });
    }
    dice.forEach(d=>{
      if(d.held && d.parkTarget){
        const b=d.body, t=d.parkTarget, k=Math.min(1, dt*7);
        b.position.x+=(t.x-b.position.x)*k;
        b.position.y+=(t.y-b.position.y)*k;
        b.position.z+=(t.z-b.position.z)*k;
      }
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
      d.ring.visible=d.held;
      if(d.held){ d.ring.position.set(d.body.position.x,.03,d.body.position.z);
        d.ring.rotation.z+=dt*1.5; }
    });
    if (recording) {
      recAccum += dt;
      if (recAccum >= RECORD_DT) {
        recAccum -= RECORD_DT;
        captureFrame(performance.now() - recStart);
      }
    }
    if (playback) updatePlayback(); else checkSettle(dt);
    if(shakeT>0){
      shakeT-=dt;
      camera.position.set(
        CAM_POS.x+(Math.random()-.5)*shakeAmp*shakeT*20,
        CAM_POS.y+(Math.random()-.5)*shakeAmp*shakeT*20,
        CAM_POS.z+(Math.random()-.5)*shakeAmp*shakeT*20
      );
    } else camera.position.copy(CAM_POS);
    camera.lookAt(0,0,.4);
    if(window.UI) window.UI.drawFx();
    renderer.render(scene,camera);
  }

  function resize() {
    /* wrap/renderer voivat olla alustamattomia jos init() ei ole vielä
       ajettu (esim. huoneen odotusnäkymä ennen pelin alkua) — ei tehdä
       mitään silloin sen sijaan että kaadutaan. Myös suojaa tilannetta
       jossa säiliö on juuri nyt display:none (esim. uudelleenliittymisen
       aikana ennen kuin näkymä on vaihdettu näkyväksi) — koko klassinen
       "canvas tyhjä kunnes ikkunaa koon muuttaa" -bugi johtuu siitä että
       renderer alustetaan nollakokoiseksi eikä kukaan pakota uutta mittausta
       kun säiliö lopulta tulee näkyviin; siksi mp-main.js kutsuu tätä
       eksplisiittisesti heti kun huonenäkymä näytetään uudelleenliittymisen
       jälkeen sen sijaan että luotettaisiin pelkkään window-resize-tapahtumaan. */
    if (!wrap || !renderer) return;
    const w=wrap.clientWidth, h=wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w,h);
    camera.aspect=w/h; camera.updateProjectionMatrix();
    if(fxC){ fxC.width=w; fxC.height=h; }
  }

  return {
    init, configure, setActiveDiceCount, applyColor, resetHeld,
    getHeld, setHeld, toggleHeld, hitTestDie, nudgeAt, isNudgeAvailable,
    getValues, isRolling, isSettled, isCharging, onSettle, restoreDisplay, resumeFrom, onRecordTick,
    throwDice, startCharge, releaseCharge, cancelCharge,
    playTrajectory, setPhysicsActive,
    shakeCamera, resize,
  };
})();
