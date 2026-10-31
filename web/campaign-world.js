import * as THREE from './vendor/three.module.js';
import { ZONES, PEOPLE, FIXTURES } from './campaign-data.js';
import { ROUTES, BRIDGE_RAIL_OFFSET, PANTRY_PLATFORM, heightAt as groundHeightAt } from './campaign-ground.js';
import { measuredMotion as returnLineMotion } from './return-line.js';
import { createChamberRig } from './chamber-display.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const PALETTE = { ivory: 0xdce2d2, edge: 0xa6bbb9, bronze: 0x9c8054, dark: 0x152d37, mint: 0x9fe3ce, gold: 0xf4cc86, fault: 0xe98c95 };

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function mesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  object.receiveShadow = material.isMeshStandardMaterial && !material.transparent;
  parent.add(object);
  return object;
}

function instances(parent, geometry, material, transforms) {
  if (!transforms.length) return null;
  const object = new THREE.InstancedMesh(geometry, material, transforms.length);
  const dummy = new THREE.Object3D();
  transforms.forEach((t, i) => {
    dummy.position.set(t.x || 0, t.y || 0, t.z || 0);
    dummy.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0);
    dummy.scale.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
    dummy.updateMatrix();
    object.setMatrixAt(i, dummy.matrix);
  });
  object.instanceMatrix.needsUpdate = true;
  object.receiveShadow = material.isMeshStandardMaterial && !material.transparent;
  parent.add(object);
  return object;
}

function ring(parent, radius, tube, material, y = 0, arc = TAU) {
  const object = mesh(parent, new THREE.TorusGeometry(radius, tube, 6, Math.max(36, Math.round(radius * 7)), arc), material, 0, y, 0);
  object.rotation.x = -Math.PI / 2;
  return object;
}

function line(parent, points, color, opacity = 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const object = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }));
  parent.add(object);
  return object;
}

function rod(parent, a, b, radius, material, geometry) {
  const delta = new THREE.Vector3().subVectors(b, a);
  const object = mesh(parent, geometry || new THREE.CylinderGeometry(radius, radius, 1, 6), material);
  object.position.copy(a).add(b).multiplyScalar(.5);
  object.quaternion.setFromUnitVectors(UP, delta.clone().normalize());
  object.scale.y = delta.length();
  return object;
}

function floorTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d'), rnd = random(82281);
  ctx.fillStyle = '#304b52'; ctx.fillRect(0, 0, 1024, 1024); ctx.translate(512, 512);
  ctx.fillStyle = '#a9b9af'; ctx.beginPath(); ctx.arc(0, 0, 422, 0, TAU); ctx.fill();
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU, b = (i + 1) / 12 * TAU;
    ctx.fillStyle = i % 2 ? '#b7c2b5' : '#a9b9af';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 418, a, b); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#698780'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 180, Math.sin(a) * 180); ctx.lineTo(Math.cos(a) * 418, Math.sin(a) * 418); ctx.stroke();
  }
  ctx.fillStyle = '#78988e'; ctx.beginPath(); ctx.arc(0, 0, 180, 0, TAU); ctx.fill();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU, length = i % 2 ? 116 : 166;
    ctx.save(); ctx.rotate(a); ctx.fillStyle = i % 2 ? '#96b0a2' : '#d4d1b1';
    ctx.beginPath(); ctx.moveTo(0, -length); ctx.lineTo(16, -31); ctx.lineTo(0, -49); ctx.lineTo(-16, -31); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  for (const radius of [185, 198, 420, 442, 485]) {
    ctx.strokeStyle = radius === 442 ? '#d1ae71' : '#94a99a'; ctx.lineWidth = radius === 442 ? 5 : 2;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
  }
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * TAU, r = i % 4 ? 462 : 452;
    ctx.strokeStyle = i % 4 ? '#65847f' : '#c8ac78'; ctx.lineWidth = i % 4 ? 2 : 3;
    ctx.beginPath(); ctx.moveTo(Math.sin(a) * r, Math.cos(a) * r); ctx.lineTo(Math.sin(a) * 479, Math.cos(a) * 479); ctx.stroke();
  }
  for (let i = 0; i < 11000; i++) { ctx.fillStyle = rnd() > .5 ? 'rgba(245,241,215,.05)' : 'rgba(15,40,47,.055)'; ctx.fillRect(rnd() * 1024 - 512, rnd() * 1024 - 512, 1 + rnd() * 3, 1 + rnd() * 2); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function haloTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.13, 'rgba(255,255,255,.65)'); g.addColorStop(.5, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function nameTexture(text) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 512, 80);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '28px Georgia';
  ctx.fillStyle = '#d8e7d3'; ctx.shadowBlur = 12; ctx.shadowColor = '#0b2733'; ctx.fillText(text, 256, 40);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createCampaignWorld(scene) {
  const root = new THREE.Group(); root.name = 'The Last Crossing observatory'; scene.add(root);
  scene.background = new THREE.Color(0x081a28); scene.fog = new THREE.FogExp2(0x102c38, .006);
  const rnd = random(20261030), texture = floorTexture(), halo = haloTexture();
  const stone = new THREE.MeshStandardMaterial({ color: 0xd8d6c4, roughness: .78, metalness: .06 });
  const bridgeStone = new THREE.MeshStandardMaterial({ color: 0x6c7b7a, roughness: .9, metalness: .03 });
  const bridgeSupportStone = new THREE.MeshStandardMaterial({ color: 0x9baea9, roughness: .94, metalness: .02 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x385b62, roughness: .56, metalness: .3 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0xc79b5e, roughness: .3, metalness: .65, emissive: 0x382915, emissiveIntensity: .08 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x806445, roughness: .82, metalness: .04 });
  const enamel = new THREE.MeshStandardMaterial({ color: 0x397b79, roughness: .37, metalness: .28 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17323e, roughness: .5, metalness: .28 });
  const basalt = new THREE.MeshStandardMaterial({ color: 0x1b3442, roughness: .94, flatShading: true });
  const mint = new THREE.MeshBasicMaterial({ color: PALETTE.mint, toneMapped: false });
  const gold = new THREE.MeshBasicMaterial({ color: PALETTE.gold, toneMapped: false });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9edbd0, transparent: true, opacity: .24, roughness: .12, metalness: .25, depthWrite: false, side: THREE.DoubleSide });
  const cylinder = new THREE.CylinderGeometry(.055, .055, 1, 6), box = new THREE.BoxGeometry(1, 1, 1);
  const orb = new THREE.SphereGeometry(.12, 10, 6), blockers = [], rotors = [], motionParts = [], signalPrisms = [];
  const districtViews = new Map(), fixtureViews = new Map(), personViews = new Map();
  const pantryServiceFootprints = [];
  const bridgeViews = [], dockFreight = [], passengerViews = [], refugeGuideLanterns = [];
  let returnLineRig = null, clinicReturnCue = null, windRig = null, pantryLantern = null, pantryGlazing = null, pantryFirebox = null, pantryBoilerEmitter = null, pantryGrowEmitter = null;
  const pantryCold = new THREE.Color(0x91bac6), pantryWarm = new THREE.Color(0xffb56f);
  const avatarOccluders = [];
  const roofRay = new THREE.Raycaster(), roofTarget = new THREE.Vector3(), roofDirection = new THREE.Vector3(), roofHits = [];
  const roofBounds = new THREE.Box3(), roofInterior = new THREE.Box3(), roofIntersection = new THREE.Vector3(), roofAvatarPosition = new THREE.Vector3();
  const avatarRoofSamples = [new THREE.Vector3(), new THREE.Vector3(-.75, -.03, .12), new THREE.Vector3(.75, -.03, .12)];
  const voiceTable = createChamberRig({ nameplates: true }); voiceTable.group.name = 'voice_routing_table'; voiceTable.group.position.set(3.5, 1.65, -61.3); voiceTable.group.rotation.x = .38; voiceTable.group.scale.setScalar(1.25); voiceTable.group.visible = false; root.add(voiceTable.group);
  let voiceTableKey = '';
  const voiceStand = new THREE.Group(); voiceStand.position.set(3.5, 0, -61.3); voiceStand.visible = false; root.add(voiceStand);
  for (const x of [-2.2, 2.2]) { const post = mesh(voiceStand, box, bronze, x, .75, 0); post.scale.set(.14, 1.5, .14); const foot = mesh(voiceStand, box, dark, x, .06, 0); foot.scale.set(.6, .12, .5); }
  const voiceBrace = mesh(voiceStand, box, enamel, 0, .6, -.2); voiceBrace.name = 'voice_bench_patina_rail'; voiceBrace.scale.set(4.5, .16, .12);
  for (const sign of [-1, 1]) rod(voiceStand, new THREE.Vector3(sign * 2.2, .18, -.2), new THREE.Vector3(sign * .9, 1.35, -.2), .055, bronze, cylinder);
  const hub = ZONES.find(z => Math.hypot(z.x, z.z) < 1) || ZONES[0];
  const pantryZone = ZONES.find(z => z.id === 'pantry');
  const districts = ZONES.filter(z => z.id !== hub.id);
  const routes = ROUTES;

  scene.add(new THREE.HemisphereLight(0x8ca8b8, 0x122537, .34));
  const sun = new THREE.DirectionalLight(0x9ebacf, 1.6); sun.position.set(-36, 30, 18); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 110 });
  sun.shadow.bias = -.00025; sun.shadow.normalBias = .035; sun.shadow.camera.updateProjectionMatrix(); scene.add(sun, sun.target);
  const shadowOffset = new THREE.Vector3(-36, 30, 18), shadowRight = new THREE.Vector3().crossVectors(UP, shadowOffset).normalize(), shadowUp = new THREE.Vector3().crossVectors(shadowOffset, shadowRight).normalize(), shadowFocus = new THREE.Vector3();
  const fill = new THREE.DirectionalLight(0x5a7da0, .2); fill.position.set(25, 18, -55); scene.add(fill);
  const lightPool = Array.from({ length: 3 }, (_, i) => {
    const light = new THREE.PointLight(i ? 0xa7e8dd : 0xd7f9df, i ? 11 : 18, i ? 28 : 32, 2);
    light.name = 'district_fill_' + i; light.position.set(hub.x, 4 + i, hub.z); scene.add(light); return light;
  });
  const secondaryRoles = [null, null];

  const seaUniforms = { time: { value: 0 } };
  const seaMaterial = new THREE.ShaderMaterial({
    uniforms: seaUniforms,
    vertexShader: 'varying vec3 vWorld; uniform float time; void main(){vec3 p=position; p.z+=sin(p.x*.05+time*.15)*.12; vec4 w=modelMatrix*vec4(p,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: `varying vec3 vWorld;uniform float time;void main(){
      vec2 p=vWorld.xz,wind=vec2(.82,.57),crosswind=vec2(-.3,.95);
      float a=dot(p,wind)*.95-time*.58,b=dot(p,crosswind)*1.43-time*.41,swell=dot(p,vec2(.9,-.2))*.18-time*.16;
      vec2 slope=wind*.12*cos(a)+crosswind*.055*cos(b)+vec2(.9,-.2)*.02*cos(swell);
      vec3 normal=normalize(vec3(-slope.x,1.,-slope.y)),view=normalize(cameraPosition-vWorld);
      float facing=clamp(dot(normal,view),0.,1.),fresnel=.025+.975*pow(1.-facing,5.);
      vec3 reflected=reflect(-view,normal),skyColor=mix(vec3(.11,.17,.18),vec3(.018,.045,.075),sqrt(clamp(reflected.y,0.,1.)));
      vec3 c=mix(vec3(.024,.067,.082)+vec3(.002,.005,.005)*sin(swell),skyColor,fresnel*.7);
      vec3 sunlight=normalize(vec3(-32.,42.,24.));
      float sheen=pow(max(0.,dot(reflect(-sunlight,normal),view)),18.);
      c+=vec3(.7,.72,.58)*sheen*.045;
      float distanceHaze=1.-exp(-length(cameraPosition-vWorld)*.0035);
      c=mix(c,vec3(.035,.08,.105),distanceHaze);gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  const sea = mesh(root, new THREE.PlaneGeometry(900, 900, 70, 70), seaMaterial, 0, -8.2, 0); sea.rotation.x = -Math.PI / 2;
  // A soft projected island silhouette grounds the floating deck above the sea.
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
  const shadowContext = shadowCanvas.getContext('2d'), shadowGradient = shadowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
  shadowGradient.addColorStop(0, 'rgba(255,255,255,.36)'); shadowGradient.addColorStop(.65, 'rgba(255,255,255,.32)'); shadowGradient.addColorStop(1, 'rgba(255,255,255,0)');
  shadowContext.fillStyle = shadowGradient; shadowContext.fillRect(0, 0, 128, 128);
  const heightShadowMap = new THREE.CanvasTexture(shadowCanvas);
  const heightShadows = instances(root, new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: heightShadowMap, color: 0x03121c, transparent: true, depthWrite: false }),
    ZONES.map(zone => ({ x: zone.x + 8.2 * 32 / 42, y: -8.02, z: zone.z - 8.2 * 24 / 42, sx: zone.radius * 1.1, sz: zone.radius * 1.1 })));
  heightShadows.name = 'island_height_shadows';
  const sky = mesh(root, new THREE.SphereGeometry(390, 36, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vPos;void main(){vec3 d=normalize(vPos);float h=max(0.,d.y);
      vec3 c=mix(vec3(.038,.092,.128),vec3(.008,.019,.045),pow(h,.6));
      c+=vec3(.025,.058,.073)*exp(-pow((d.y-.19-d.x*.08)*7.,2.));
      c+=vec3(.025,.024,.055)*exp(-pow((d.y-.36-sin(d.z*3.)*.05)*10.,2.));gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  })); sky.renderOrder = -10;
  const starVertices = [];
  for (let i = 0; i < 700; i++) {
    const a = rnd() * TAU, h = .12 + rnd() * 1.3, r = 320;
    starVertices.push(Math.cos(a) * Math.cos(h) * r, Math.sin(h) * r, Math.sin(a) * Math.cos(h) * r);
  }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xb7ddd9, size: .28, transparent: true, opacity: .65, fog: false, depthWrite: false })); root.add(stars);
  const distant = [];
  for (let i = 0; i < 34; i++) { const a = rnd() * TAU, r = 130 + rnd() * 90, h = 13 + rnd() * 32; distant.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, y: -11 + h / 2, sx: 2 + rnd() * 4, sy: h, sz: 2 + rnd() * 4, ry: rnd() * TAU }); }
  instances(root, new THREE.CylinderGeometry(.25, 1, 1, 5), new THREE.MeshStandardMaterial({ color: 0x0d2734, roughness: 1 }), distant);
  const farGate = new THREE.Group(); farGate.position.set(0, 14, -140); farGate.rotation.z = -.2; root.add(farGate);
  mesh(farGate, new THREE.TorusGeometry(36, .6, 8, 96, Math.PI * 1.65), bronze);
  mesh(farGate, new THREE.TorusGeometry(34.7, .04, 6, 96, Math.PI * 1.65), mint);

  const contactTransforms = [];
  const foliage = { stems: [], leaves: [], flowers: [], stones: [], railPosts: [] };
  for (const zone of ZONES) {
    const group = new THREE.Group(); group.position.set(zone.x, 0, zone.z); root.add(group);
    const color = zone.color || PALETTE.mint;
    const floorMat = new THREE.MeshStandardMaterial({ map: texture, color: new THREE.Color(color).lerp(new THREE.Color(PALETTE.ivory), .84), roughness: .82, metalness: .08 });
    mesh(group, new THREE.CylinderGeometry(zone.radius, zone.radius - .55, 1.05, 72), edge, 0, -.55, 0);
    const top = mesh(group, new THREE.CircleGeometry(zone.radius - .12, 80), floorMat, 0, -.012, 0); top.rotation.x = -Math.PI / 2;
    const skirt = new THREE.CylinderGeometry(zone.radius - .4, zone.radius * .48, 5.1, 11, 2);
    const positions = skirt.attributes.position;
    for (let i = 0; i < positions.count; i++) if (positions.getY(i) < -.5) { positions.setX(i, positions.getX(i) * (.82 + rnd() * .3)); positions.setZ(i, positions.getZ(i) * (.82 + rnd() * .3)); }
    skirt.computeVertexNormals(); mesh(group, skirt, basalt, 0, -3.5, 0);
    const coping = mesh(group, new THREE.RingGeometry(zone.radius - .23, zone.radius - .045, 80), stone, 0, .008, 0); coping.rotation.x = -Math.PI / 2;
    ring(group, zone.radius - .26, .04, bronze, .04);
    ring(group, zone.radius - .08, .065, bronze, -.33);
    ring(group, zone.radius - .2, .08, dark, -.76);
    const wake = ring(group, zone.radius - .56, .025, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, depthWrite: false }), .055);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(zone.name.toUpperCase()), transparent: true, depthWrite: false, opacity: .68 }));
    sign.position.set(0, 5.1, -zone.radius + 2); sign.scale.set(9, 1.4, 1); sign.visible = zone.id !== 'gallery'; group.add(sign);
    districtViews.set(zone.id, { zone, group, wake, floorMat, lamps: [], mechanics: [] });
    for (let i = 0; i < 105; i++) {
      const a = rnd() * TAU, r = zone.radius - 2 + rnd() * 1.25;
      const x = zone.x + Math.sin(a) * r, z = zone.z + Math.cos(a) * r, h = .3 + rnd() * .65;
      foliage.stems.push({ x, z, y: h / 2, sx: .028, sy: h, sz: .028 });
      for (let leaf = 0; leaf < 2; leaf++) { const b = a + leaf * 2.1; foliage.leaves.push({ x: x + Math.cos(b) * .09, z: z + Math.sin(b) * .09, y: h * (.4 + leaf * .22), sx: .07, sy: .3, sz: .13, ry: b, rz: -.65 }); }
      if (i % 3 === 0) foliage.flowers.push({ x, z, y: h + .04, s: .075 });
      if (i % 4 === 0) foliage.stones.push({ x, z, y: .08, sx: .17 + rnd() * .2, sy: .12 + rnd() * .18, sz: .12 + rnd() * .2, ry: a });
    }
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * TAU, r = zone.radius - .55;
      const towardHub = Math.atan2(hub.x - zone.x, hub.z - zone.z), gap = Math.atan2(Math.sin(a - towardHub), Math.cos(a - towardHub));
      if (zone.id !== hub.id && Math.abs(gap) < .28) continue;
      if (zone.id === hub.id && districts.some(d => Math.abs(Math.atan2(Math.sin(a - Math.atan2(d.x, d.z)), Math.cos(a - Math.atan2(d.x, d.z)))) < .25)) continue;
      foliage.railPosts.push({ x: zone.x + Math.sin(a) * r, z: zone.z + Math.cos(a) * r, y: .54, sx: .055, sy: .95, sz: .055 });
    }
    const theme = String(zone.theme || zone.id).toLowerCase();
    const landmark = new THREE.Group(); group.add(landmark);
    if (theme.includes('refuge')) buildRefuge(landmark, zone);
    else if (theme.includes('dock')) buildDock(landmark, zone);
    else if (theme.includes('garden') || theme.includes('pantry')) buildGarden(landmark, zone);
    else if (theme.includes('choir')) buildChoir(landmark, zone);
    else if (theme.includes('wind') || theme.includes('gallery')) buildWind(landmark, zone);
    else if (theme.includes('archive') || theme.includes('index')) buildArchive(landmark, zone);
    else buildCrown(landmark, zone);
  }

  for (const contact of contactTransforms) contact.y += groundHeightAt(contact.x, contact.z) ?? 0;
  const contacts = instances(root, new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: heightShadowMap, color: 0x08191c, transparent: true, opacity: .6, depthWrite: false }), contactTransforms);
  contacts.name = 'fixed_support_contacts';

  for (const route of routes) {
    const dx = route.b.x - route.a.x, dz = route.b.z - route.a.z, distance = Math.hypot(dx, dz), ux = dx / distance, uz = dz / distance;
    const start = route.a.radius - 1, end = distance - route.b.radius + 1, length = end - start;
    const bridge = new THREE.Group(); bridge.name = route.id; bridge.position.set(route.a.x + ux * start, 0, route.a.z + uz * start); bridge.rotation.y = Math.atan2(dx, dz); bridge.visible = !route.flag; root.add(bridge); bridgeViews.push({ route, group: bridge });
    mesh(bridge, new THREE.BoxGeometry(route.width, .36, length), bridgeStone, 0, -.21, length / 2);
    mesh(bridge, new THREE.BoxGeometry(5.05, .13, length + .2), bronze, 0, -.45, length / 2);
    line(bridge, [-2.15, .02, 0, -2.15, .02, length, 2.15, .02, 0, 2.15, .02, length], 0x97ccb9, .7);
    const railStart = Math.sqrt(route.a.radius ** 2 - BRIDGE_RAIL_OFFSET ** 2) - start;
    const railEnd = distance - Math.sqrt(route.b.radius ** 2 - BRIDGE_RAIL_OFFSET ** 2) - start;
    const railLength = railEnd - railStart, railPosts = Math.max(1, Math.ceil(railLength / 4));
    if (!route.flag) {
      const structure = new THREE.Group(); structure.name = route.id + '_understructure'; bridge.add(structure);
      const abutments = instances(structure, box, bridgeSupportStone, [railStart, railEnd].map(z => ({ x: 0, y: -3.3, z, sx: 5.9, sy: 5.6, sz: 2.3 }))); abutments.name = route.id + '_abutments'; abutments.castShadow = true;
      const crowns = instances(structure, box, stone, [railStart, railEnd].map(z => ({ x: 0, y: -.725, z, sx: 6.1, sy: .45, sz: 2.5 }))); crowns.castShadow = true;
      const supports = [], ties = [];
      for (const side of [-1, 1]) {
        const points = Array.from({ length: 25 }, (_, i) => { const t = i / 24; return new THREE.Vector3(side * 2.55, -5.2 + 4 * Math.sin(t * Math.PI), railStart + t * railLength); });
        const rib = mesh(structure, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, .45, 8, false), bridgeSupportStone); rib.name = route.id + '_rib_' + side; rib.castShadow = true;
        for (let i = 1; i < 8; i++) { const t = i / 8, z = railStart + t * railLength, y = -5.2 + 4 * Math.sin(t * Math.PI); supports.push({ x: side * 2.55, y: (y - .5) / 2, z, sx: .3, sy: -.5 - y, sz: .38 }); }
      }
      const piers = instances(structure, box, bridgeSupportStone, supports); piers.name = route.id + '_vertical_supports'; piers.castShadow = true;
      for (const t of [.25, .5, .75]) ties.push({ x: 0, y: -5.2 + 4 * Math.sin(t * Math.PI), z: railStart + t * railLength, sx: 5.15, sy: .18, sz: .24 });
      const crossTies = instances(structure, box, bronze, ties); crossTies.name = route.id + '_cross_ties';
    }

    for (const side of [-1, 1]) {
      const rail = mesh(bridge, box, bronze, side * BRIDGE_RAIL_OFFSET, .9, (railStart + railEnd) / 2); rail.name = route.id + '_rail_' + side; rail.scale.set(.07, .08, railLength);
      for (let i = 0; i <= railPosts; i++) { const post = mesh(bridge, box, bronze, side * BRIDGE_RAIL_OFFSET, .45, railStart + i / railPosts * railLength); post.scale.set(.065, .9, .065); }
    }
    const segments = Math.max(2, Math.round(length / 4));
    for (let i = 0; i <= segments; i++) {
      const t = i / segments * length;
      const cross = mesh(bridge, box, bronze, 0, .025, t); cross.scale.set(4.55, .025, .04);
      if (i % 2 === 0) {
        const arch = mesh(bridge, new THREE.TorusGeometry(2.7, .055, 5, 32, Math.PI), bronze, 0, .15, t); arch.rotation.z = 0;
        const mark = mesh(bridge, orb, mint, 0, .08, t + .5); mark.scale.setScalar(.65);
      }
    }
  }
  instances(root, new THREE.CylinderGeometry(1, 1, 1, 5), new THREE.MeshStandardMaterial({ color: 0x6e9a91, roughness: .8 }), foliage.stems);
  instances(root, new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x9cbfad, roughness: .75, metalness: .1 }), foliage.leaves);
  instances(root, new THREE.OctahedronGeometry(1, 0), gold, foliage.flowers);
  instances(root, new THREE.IcosahedronGeometry(1, 0), edge, foliage.stones);
  instances(root, box, bronze, foliage.railPosts);

  function pillar(parent, x, z, height, radius = .2) {
    const contact = parent.localToWorld(new THREE.Vector3(x, 0, z)), contactRadius = radius * 1.7 + .25;
    if (ZONES.some(zone => Math.hypot(contact.x - zone.x, contact.z - zone.z) + contactRadius < zone.radius - .12)) contactTransforms.push({ x: contact.x, y: .018, z: contact.z, sx: contactRadius, sz: contactRadius });
    const shaft = mesh(parent, new THREE.CylinderGeometry(radius, radius * 1.2, height, 8), stone, x, height / 2, z); shaft.castShadow = true;
    mesh(parent, new THREE.CylinderGeometry(radius * 1.4, radius * 1.7, .32, 8), dark, x, .16, z);
    mesh(parent, new THREE.CylinderGeometry(radius * 1.25, radius * 1.25, .09, 12), bronze, x, .36, z);
    mesh(parent, new THREE.CylinderGeometry(radius * 1.4, radius * 1.4, .12, 8), bronze, x, height, z);
    if (height > 3) { const p = parent.localToWorld(new THREE.Vector3(x, 0, z)); blockers.push({ x: p.x, z: p.z, radius: radius + .28 }); }
  }
  function lantern(parent, x, y, z, color = PALETTE.gold) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    mesh(g, new THREE.OctahedronGeometry(.22), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color, transparent: true, opacity: .4, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.set(1.8, 1.8, 1); g.add(glow);
    return g;
  }
  function passengers(parent, positions, kind) {
    const group = new THREE.Group(); group.name = 'passengers_' + kind; parent.add(group);
    positions.forEach(([x,z], index) => {
      mesh(group, new THREE.ConeGeometry(.24, .8, 7), index % 2 ? enamel : timber, x, .57, z);
      mesh(group, new THREE.SphereGeometry(.16, 10, 7), stone, x, 1.13, z);
      const scarf = mesh(group, box, bronze, x, .9, z - .16); scarf.scale.set(.28,.12,.08);
    });
    passengerViews.push({group,kind}); return group;
  }
  function buildRefuge(parent, zone) {
    let westLantern;
    const core = new THREE.Group(); core.position.y = 8.2; core.scale.setScalar(1.3); parent.add(core);
    const shell = mesh(core, new THREE.IcosahedronGeometry(2.7, 1), glass); shell.name = 'refuge_seaglass_shell';
    const bearing = mesh(core, new THREE.CylinderGeometry(1.15, 1.7, .55, 12), dark, 0, -2.4, 0); bearing.castShadow = true;
    ring(core, 1.55, .09, bronze, -2.52); ring(core, 1.17, .07, bronze, -2.08);
    const heart = mesh(core, new THREE.OctahedronGeometry(.88), new THREE.MeshStandardMaterial({ color: 0xe8be76, emissive: 0xc68136, emissiveIntensity: .75, roughness: .3, metalness: .25 })); heart.name = 'refuge_amber_heart';
    const lens = mesh(core, new THREE.SphereGeometry(1.55, 24, 16), glass); lens.scale.set(1, .65, 1);
    for (let i = 0; i < 6; i++) {
      const meridian = mesh(core, new THREE.TorusGeometry(2.72, .065, 6, 48, Math.PI), bronze); meridian.rotation.y = i * Math.PI / 3; meridian.rotation.z = -Math.PI / 2; meridian.castShadow = true;
    }
    ring(core, 2.72, .11, bronze); ring(core, 2.74, .025, gold, .14);
    const crown = mesh(core, new THREE.ConeGeometry(.55, .85, 8), bronze, 0, 2.9, 0); crown.castShadow = true;
    const wire = mesh(core, new THREE.IcosahedronGeometry(2.66, 1), new THREE.MeshBasicMaterial({ color: 0xc3f3de, wireframe: true, transparent: true, opacity: .12, depthWrite: false }));
    const orbitA = mesh(core, new THREE.TorusGeometry(3.6, .11, 8, 64), bronze); orbitA.rotation.x = .9; orbitA.rotation.y = .4; orbitA.castShadow = true;
    const orbitB = mesh(core, new THREE.TorusGeometry(4.1, .075, 6, 72), bronze); orbitB.rotation.y = -.7; orbitB.rotation.z = .4; orbitB.castShadow = true;
    const orbitC = mesh(core, new THREE.TorusGeometry(3.25, .025, 6, 64), mint); orbitC.rotation.y = .8;
    rotors.push({ object: orbitA, axis: 'z', speed: .06 }, { object: orbitB, axis: 'x', speed: -.035 }, { object: wire, axis: 'y', speed: .08 });
    const vertices = [], nodes = [], geom = new THREE.IcosahedronGeometry(2.65, 1).attributes.position;
    for (let i = 0; i < geom.count; i += 3) { const a = new THREE.Vector3().fromBufferAttribute(geom, i), b = new THREE.Vector3().fromBufferAttribute(geom, i + 1); vertices.push(a.x, a.y, a.z, b.x, b.y, b.z); if (i % 12 === 0) nodes.push({ x: a.x, y: a.y, z: a.z, s: .055 }); }
    line(core, vertices, 0xcaf8df, .16); instances(core, orb, mint, nodes);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + .51, x = Math.sin(a) * 11.4, z = Math.cos(a) * 11.4;
      const support = new THREE.Group(); support.position.set(x, 0, z); parent.add(support);
      pillar(support, 0, 0, 8.8, .24);
      const height = z > 4 ? 1.15 : z < -4 ? 8.8 : 3.6;
      support.scale.y = height / 8.8;
      mesh(parent, new THREE.CylinderGeometry(.43, .46, .28, 8), dark, x, .14, z);
      mesh(parent, new THREE.CylinderGeometry(.38, .3, .2, 12), bronze, x, height + .1, z);
      const lamp = lantern(parent, x, height + .42, z);
      if (i === 4) westLantern = lamp;
      if (height < 2) { lamp.name = 'refuge_guide_lantern_' + refugeGuideLanterns.length; refugeGuideLanterns.push(lamp); }
    }
    const cradle = new THREE.Group(); cradle.name = 'refuge_rear_cradle'; cradle.position.set(.14, 8.8, -9.87); parent.add(cradle);
    const arch = mesh(cradle, new THREE.TorusGeometry(5.7, .26, 10, 72, Math.PI), bronze); arch.scale.y = .61; arch.castShadow = true;
    const innerRim = mesh(cradle, new THREE.TorusGeometry(5.32, .045, 6, 64, Math.PI), stone); innerRim.scale.y = .61;
    ring(parent,4.7,.035,bronze,.04);ring(parent,6.2,.022,mint,.045);
    const seats=[], backs=[], legs=[], rails=[];
    for(const side of [-1,1]) for(let i=0;i<3;i++) {
      if (side < 0 && i === 1) continue;
      const x=side < 0 ? -11.55 : side*8.7,z=side < 0 ? i === 0 ? -1.5 : 1.7 : -3.2+i*2.6;
      contactTransforms.push({ x: zone.x + x, y: .018, z: zone.z + z, sx: .65, sz: side < 0 ? .95 : 1.18 });
      seats.push({x,y:.55,z,sx:.8,sy:.13,sz:side < 0 ? 1.4 : 1.9});
      backs.push({x:x+side*.34,y:1.06,z,sx:.13,sy:.75,sz:side < 0 ? 1.4 : 1.9});
      rails.push({x:x+side*.36,y:1.46,z,sx:.18,sy:.1,sz:side < 0 ? 1.55 : 2.05});
      for(const dx of [-.28,.28])for(const dz of (side < 0 ? [-.5,.5] : [-.7,.7])) { legs.push({x:x+dx,y:.25,z:z+dz,sx:.1,sy:.5,sz:.12}); contactTransforms.push({ x: zone.x + x + dx, y: .019, z: zone.z + z + dz, sx: .18, sz: .2 }); }
    }
    instances(parent,box,timber,seats);instances(parent,box,timber,backs);instances(parent,box,bronze,legs);instances(parent,box,bronze,rails);
    const dockArrivals=passengers(parent,[[-11.45,1.7],[8.6,2]],'refuge_dock');dockArrivals.scale.y=.72;dockArrivals.position.y=.25;
    const spanArrivals=passengers(parent,[[-11.45,-1.5],[8.6,-3.2]],'refuge_span');spanArrivals.scale.y=.72;spanArrivals.position.y=.25;
    const sanctuary = new THREE.Group(); sanctuary.name = 'refuge_sanctuary'; parent.add(sanctuary);
    const foundationStone = new THREE.MeshStandardMaterial({ color: 0x758b88, roughness: .86, metalness: .03 });
    mesh(sanctuary, new THREE.CylinderGeometry(13.83, 13.83, .48, 96), stone, 0, -1.3, 0);
    mesh(sanctuary, new THREE.CylinderGeometry(13.7, 12.7, 1.15, 64), foundationStone, 0, -2.1, 0);
    ring(sanctuary, 13.78, .065, bronze, -1.03);
    const structuralRibs = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + .27, lower = new THREE.Vector3(Math.sin(a) * 8.6, -5.8, Math.cos(a) * 8.6), upper = new THREE.Vector3(Math.sin(a) * 13.4, -1.4, Math.cos(a) * 13.4);
      const direction = upper.clone().sub(lower), turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize())), center = lower.clone().add(upper).multiplyScalar(.5);
      structuralRibs.push({ x: center.x, y: center.y, z: center.z, sy: direction.length(), rx: turn.x, ry: turn.y, rz: turn.z });
    }
    instances(sanctuary, new THREE.CylinderGeometry(.32, .6, 1, 8), foundationStone, structuralRibs);
    const pavilion = new THREE.Group(); pavilion.name = 'refuge_crescent_pavilion'; sanctuary.add(pavilion);
    const northRoute = routes.find(route => route.a.id === zone.id && route.b.id === 'pantry'), southRoute = routes.find(route => route.a.id === zone.id && route.b.id === 'dock');
    const northBearing = Math.atan2(northRoute.b.x - zone.x, northRoute.b.z - zone.z), southBearing = Math.atan2(southRoute.b.x - zone.x, southRoute.b.z - zone.z);
    const corridorMargin = Math.max(northRoute.halfWidth, southRoute.halfWidth) + .6;
    const pavilionPoint = (radius, along) => { const north = northBearing + Math.asin(corridorMargin / radius), south = southBearing - Math.asin(corridorMargin / radius), a = north + (south - north) * along; return new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius); };
    const wallPath = [];
    for (let i = 0; i <= 10; i++) wallPath.push(pavilionPoint(9.4 + i * .4, 0));
    for (let i = 1; i <= 24; i++) wallPath.push(pavilionPoint(13.4, i / 24));
    for (let i = 1; i <= 10; i++) wallPath.push(pavilionPoint(13.4 - i * .4, 1));
    const masonry = [], lining = [];
    for (let i = 0; i < wallPath.length - 1; i++) {
      const a = wallPath[i], b = wallPath[i + 1], delta = b.clone().sub(a), center = a.clone().add(b).multiplyScalar(.5);
      if (i >= 34) continue;
      const turn = Math.atan2(delta.x, delta.z), normal = new THREE.Vector3(Math.cos(turn), 0, -Math.sin(turn)); if (normal.dot(new THREE.Vector3(-11, 0, .3).sub(center)) < 0) normal.negate();
      masonry.push({ x: center.x, y: 2, z: center.z, sx: .62, sy: 4, sz: delta.length() + .08, ry: turn });
      lining.push({ x: center.x + normal.x * .325, y: 1.95, z: center.z + normal.z * .325, sx: .035, sy: 3.85, sz: delta.length() + .06, ry: turn });
      blockers.push({ x: zone.x + a.x, z: zone.z + a.z, radius: .55 });
    }
    const last = wallPath.at(-1); blockers.push({ x: zone.x + last.x, z: zone.z + last.z, radius: .55 });
    const wall = instances(pavilion, box, new THREE.MeshStandardMaterial({ color: 0x3a5154, roughness: .9, metalness: .06 }), masonry); wall.name = 'refuge_pavilion_wall'; wall.castShadow = true; avatarOccluders.push(wall);
    const wallLining = instances(pavilion, box, timber.clone(), lining); wallLining.name = 'refuge_pavilion_wall_lining'; avatarOccluders.push(wallLining);
    const openCornerPiers = [wallPath[34], last].map(p => ({ x: p.x, y: 2, z: p.z, sx: .68, sy: 4, sz: .68 }));
    const cornerPiers = instances(pavilion, box, stone, openCornerPiers); cornerPiers.castShadow = true; blockers.push({ x: zone.x + wallPath[34].x, z: zone.z + wallPath[34].z, radius: .55 });
    const roofVertices = [], roofIndices = [];
    for (let radial = 0; radial <= 8; radial++) for (let along = 0; along <= 24; along++) { const t = radial / 8, point = pavilionPoint(9.1 + t * 4.65, along / 24); roofVertices.push(point.x, 4.35 + .4 * Math.sin(t * Math.PI) + .1 * t, point.z); }
    const layerCount = roofVertices.length / 3;
    for (let i = 0; i < layerCount; i++) roofVertices.push(roofVertices[i * 3], roofVertices[i * 3 + 1] - .45, roofVertices[i * 3 + 2]);
    for (let row = 0; row < 8; row++) for (let column = 0; column < 24; column++) { const i = row * 25 + column, j = i + layerCount; roofIndices.push(i, i + 25, i + 1, i + 1, i + 25, i + 26, j, j + 1, j + 25, j + 1, j + 26, j + 25); }
    const edgePath = [...Array.from({ length: 25 }, (_, i) => i), ...Array.from({ length: 8 }, (_, i) => (i + 1) * 25 + 24), ...Array.from({ length: 24 }, (_, i) => 223 - i), ...Array.from({ length: 7 }, (_, i) => (7 - i) * 25)];
    for (let i = 0; i < edgePath.length; i++) { const a = edgePath[i], b = edgePath[(i + 1) % edgePath.length]; roofIndices.push(a, b, a + layerCount, b, b + layerCount, a + layerCount); }
    const roofGeometry = new THREE.BufferGeometry(); roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roofVertices, 3)); roofGeometry.setIndex(roofIndices); roofGeometry.computeVertexNormals();
    const roof = mesh(pavilion, roofGeometry, new THREE.MeshStandardMaterial({ color: 0x526b6b, roughness: .74, metalness: .22, side: THREE.DoubleSide })); roof.name = 'refuge_pavilion_roof'; roof.castShadow = true; avatarOccluders.push(roof);
    for (const [seam, column] of [5, 12, 19].entries()) {
      const points = Array.from({ length: 9 }, (_, row) => new THREE.Vector3(roofVertices[(row * 25 + column) * 3], roofVertices[(row * 25 + column) * 3 + 1] + .05, roofVertices[(row * 25 + column) * 3 + 2]));
      mesh(pavilion, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, .055, 6, false), bronze).name = 'refuge_roof_structural_seam_' + seam;
    }
    const opening = Array.from({ length: 25 }, (_, i) => { const p = pavilionPoint(9.1, i / 24); p.y = 3.92; return p; });
    mesh(pavilion, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(opening), 32, .12, 8, false), bronze);
    const lowerOpening = Array.from({ length: 25 }, (_, i) => { const p = pavilionPoint(9.35, i / 24); p.y = .055; return p; });
    mesh(pavilion, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lowerOpening), 32, .045, 6, false), bronze);
    const westAngle = 4 / 6 * TAU + .51;
    rod(pavilion, new THREE.Vector3(Math.sin(westAngle) * 11.4, 3.6, Math.cos(westAngle) * 11.4), new THREE.Vector3(-10.3, 3.8, 1.5), .055, bronze);
    rod(pavilion, new THREE.Vector3(-10.3, 3.8, 1.5), new THREE.Vector3(-10.3, 3.43, 1.5), .025, bronze);
    mesh(pavilion, new THREE.CylinderGeometry(.16, .32, .16, 12), bronze, -10.3, 3.44, 1.5);
    westLantern.position.set(-10.3, 3.15, 1.5); westLantern.name = 'refuge_pavilion_lantern';
    refugeGuideLanterns[1] = westLantern;
    for (const z of [-1.5, 1.7]) for (const dz of [-.35, 0, .35]) blockers.push({ x: zone.x - 11.55, z: zone.z + z + dz, radius: .43 });
    const insidePavilion = p => p.x < -9 && Math.hypot(p.x, p.z) < 13.9 && p.x * Math.cos(northBearing) - p.z * Math.sin(northBearing) > 2.7 && p.x * Math.cos(southBearing) - p.z * Math.sin(southBearing) < -2.7;
    for (const kind of ['stems', 'leaves', 'flowers', 'stones']) foliage[kind] = foliage[kind].filter(p => !insidePavilion({ x: p.x - zone.x, z: p.z - zone.z }));
    const paving = document.createElement('canvas'); paving.width = paving.height = 1024; const pctx = paving.getContext('2d'); pctx.fillStyle = '#29484d'; pctx.fillRect(0, 0, 1024, 1024); pctx.translate(512, 512);
    for (let course = 0; course < 4; course++) for (let block = 0; block < 40; block++) {
      const inner = 224 + course * 57, outer = inner + 54, a = (block + (course % 2) * .5) / 40 * TAU + .003, b = a + TAU / 40 - .006;
      pctx.fillStyle = ['#b6bcae', '#aab5a8', '#bdc2b2'][(course + block) % 3]; pctx.beginPath(); pctx.arc(0, 0, outer, a, b); pctx.arc(0, 0, inner, b, a, true); pctx.closePath(); pctx.fill();
    }
    for (const district of districts) {
      const a = Math.atan2(district.x - zone.x, district.z - zone.z); pctx.save(); pctx.rotate(-a); pctx.fillStyle = '#c3c7b7'; pctx.fillRect(-75, 224, 150, 290); pctx.strokeStyle = '#74877e'; pctx.lineWidth = 2;
      for (let y = 244; y < 510; y += 42) { pctx.beginPath(); pctx.moveTo(-74, y); pctx.lineTo(74, y); pctx.stroke(); } pctx.restore();
    }
    pctx.fillStyle = '#304e52'; pctx.beginPath(); pctx.arc(0, 0, 220, 0, TAU); pctx.fill();
    for (const radius of [209, 218]) { pctx.strokeStyle = radius === 209 ? '#b39461' : '#69877c'; pctx.lineWidth = radius === 209 ? 4 : 2; pctx.beginPath(); pctx.arc(0, 0, radius, 0, TAU); pctx.stroke(); }
    for (let i = 0; i < 8; i++) { pctx.save(); pctx.rotate(i / 8 * TAU); pctx.fillStyle = i % 2 ? '#7f9a8e' : '#b4b79a'; pctx.beginPath(); pctx.moveTo(0, i % 2 ? -119 : -177); pctx.lineTo(17, -31); pctx.lineTo(0, -49); pctx.lineTo(-17, -31); pctx.closePath(); pctx.fill(); pctx.restore(); }
    pctx.fillStyle = '#84694a'; pctx.fillRect(-492, -120, 155, 260); pctx.strokeStyle = '#49594f'; pctx.lineWidth = 2; for (let x = -480; x < -337; x += 16) { pctx.beginPath(); pctx.moveTo(x, -120); pctx.lineTo(x, 140); pctx.stroke(); }
    const pavingMap = new THREE.CanvasTexture(paving); pavingMap.colorSpace = THREE.SRGBColorSpace; pavingMap.anisotropy = 4; districtViews.get(zone.id).floorMat.map = pavingMap;
    districtViews.get(zone.id).core = core; districtViews.get(zone.id).heart = heart;
  }

  function buildDock(parent, zone) {
    for (const side of [-1, 1]) {
      const x = side * 10.8;
      pillar(parent,x,3.7,9.2,.28);pillar(parent,x,-1,7.5,.22);
      rod(parent,new THREE.Vector3(x,9.2,3.7),new THREE.Vector3(side*3,13,-2),.14,stone);
      rod(parent,new THREE.Vector3(side*3,13,-2),new THREE.Vector3(x,7.5,-1),.1,bronze);
      const wheel=mesh(parent,new THREE.TorusGeometry(.9,.13,8,36),bronze,x,8.1,3.7);wheel.rotation.y=Math.PI/2;
      lantern(parent,x,9.7,3.7);
    }
    rod(parent,new THREE.Vector3(-3,13,-2),new THREE.Vector3(3,13,-2),.16,bronze);
    const beam = mesh(parent, box, bronze, 0, 9.2, 3.7); beam.scale.set(22.2,.35,.5);
    const carriage = new THREE.Group(); carriage.name='dock_lift_carriage';carriage.position.set(0,-3,zone.radius+1.8);parent.add(carriage);
    const tray = mesh(carriage, box, stone); tray.scale.set(6.8,.35,4.1);
    for(const side of [-1,1]) {
      const rail=mesh(carriage,box,bronze,side*3.2,.65,0);rail.scale.set(.08,1.1,4);
      rod(parent,new THREE.Vector3(side*3.2,9.2,3.7),new THREE.Vector3(side*3.2,-3,zone.radius+1.8),.04,bronze,cylinder);
    }
    for(let i=0;i<4;i++) {
      const crate=new THREE.Group();crate.name='dock_freight_'+i;crate.position.set(-2.1+(i%2)*1.4,.6,-1+Math.floor(i/2)*1.4);carriage.add(crate);
      const cargo=mesh(crate,box,timber);cargo.scale.set(1.1,.9,1.1);
      for(const y of [-.27,.27]){const band=mesh(crate,box,bronze,0,y,0);band.scale.set(1.13,.07,1.13);}
      dockFreight.push(crate);
    }
    passengers(carriage,[[-1.8,.85],[1.7,.85]],'dock');
    motionParts.push({object:carriage,axis:'y',initial:-3,stages:[{id:'lift_raise',flag:'passengers_safe',from:-3,to:.4}]});
    const banner=mesh(parent,new THREE.PlaneGeometry(2.1,4.5),new THREE.MeshStandardMaterial({color:0xb5d1c8,side:THREE.DoubleSide,roughness:.9}),-8.5,5,-.2);banner.rotation.y=.5;
  }

  function buildGarden(parent, zone) {
    const hall = new THREE.Group(); hall.name = 'pantry_conservatory_hall'; hall.position.y = PANTRY_PLATFORM.height; parent.add(hall);
    const masonry = new THREE.MeshStandardMaterial({ color: 0x7f938c, roughness: .88, metalness: .03 });
    const p = PANTRY_PLATFORM;
    const plinth = mesh(parent, new THREE.BoxGeometry(p.halfWidth * 2, p.height, p.front - p.back), masonry.clone(), 0, p.height / 2, (p.back + p.front) / 2); plinth.name = 'pantry_raised_hall_plinth'; plinth.castShadow = true; avatarOccluders.push(plinth);
    const rampVertices = [-p.doorHalfWidth,p.height,p.front, p.doorHalfWidth,p.height,p.front, -p.rampHalfWidth,0,p.rampEnd, p.rampHalfWidth,0,p.rampEnd, -p.rampHalfWidth,0,p.front, p.rampHalfWidth,0,p.front];
    let rampGeometry = new THREE.BufferGeometry(); rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rampVertices, 3)); rampGeometry.setIndex([0,2,3,0,3,1,0,4,2,1,3,5]); rampGeometry = rampGeometry.toNonIndexed(); rampGeometry.computeVertexNormals();
    const ramp = mesh(parent, rampGeometry, masonry.clone(), 0, .014, 0); ramp.name = 'pantry_broad_entry_ramp'; ramp.castShadow = true; ramp.material.color.set(0x52635c);
    const glazing = new THREE.MeshStandardMaterial({ color: 0xb8d8bf, roughness: .3, metalness: .12, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide });
    pantryGlazing = glazing; pantryGlazing.emissive.set(0xc8945d); pantryGlazing.emissiveIntensity = 0;
    const nave = new THREE.Group(); nave.name = 'pantry_lower_conservatory_nave'; parent.add(nave);
    const naveGlazing = glazing.clone(); naveGlazing.opacity = .07; naveGlazing.emissive.set(0x000000); naveGlazing.emissiveIntensity = 0;
    const naveFloor = mesh(nave, new THREE.PlaneGeometry(16.4, 10), new THREE.MeshStandardMaterial({ color: 0x627b70, roughness: .92 }), 0, .012, 1.5); naveFloor.rotation.x = -Math.PI / 2;
    const courtCanvas = document.createElement('canvas'); courtCanvas.width = 512; courtCanvas.height = 320; const courtContext = courtCanvas.getContext('2d'); courtContext.fillStyle = 'rgb(214,214,214)'; courtContext.fillRect(0, 0, 512, 320);
    for (let row = 0; row < 4; row++) for (let column = -1; column < 5; column++) { const shade = 246 + (row * 3 + column + 7) % 5; courtContext.fillStyle = `rgb(${shade},${shade},${shade})`; courtContext.fillRect(column * 128 + (row % 2) * 64 + 1, row * 80 + 1, 127, 79); }
    const courtMap = new THREE.CanvasTexture(courtCanvas); courtMap.colorSpace = THREE.SRGBColorSpace; courtMap.wrapS = courtMap.wrapT = THREE.ClampToEdgeWrapping; courtMap.anisotropy = 4;
    const rampPositions = rampGeometry.attributes.position, rampUvs = []; for (let i = 0; i < rampPositions.count; i++) rampUvs.push((rampPositions.getX(i) + 8.2) / 16.4, (6.5 - rampPositions.getZ(i)) / 10); rampGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(rampUvs, 2));
    for (const material of [naveFloor.material, ramp.material]) { material.map = courtMap; material.color.multiplyScalar(1.0717195424); }
    const arrivalDirection = new THREE.Vector2(hub.x - zone.x, hub.z - zone.z).normalize(), arrivalRadius = zone.radius + .4;
    const arrivalVertices = [];
    for (const side of [-1, 1]) arrivalVertices.push(arrivalDirection.x * arrivalRadius + arrivalDirection.y * 2.15 * side, .026, arrivalDirection.y * arrivalRadius - arrivalDirection.x * 2.15 * side);
    arrivalVertices.push(8.2, .026, 4.8, 8.2, .026, 2.6, 6.8, .026, 4.8, 6.8, .026, 2.6);
    const arrivalGeometry = new THREE.BufferGeometry(); arrivalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(arrivalVertices, 3)); arrivalGeometry.setIndex([0,1,2,1,3,2,2,3,4,3,5,4]); arrivalGeometry.computeVertexNormals();
    const arrival = mesh(parent, arrivalGeometry, bridgeStone); arrival.name = 'pantry_side_arrival_apron';
    const naveWalls = [], naveWindows = [], naveFrames = [], naveRoofFrames = [];
    const naveFacades = ['left', 'front', 'right'].map(name => ({ name, posts: [], rails: [] }));
    const naveEdges = [[[-8.2,-3.5],[-8.2,1.5],4.6], [[-8.2,1.5],[-8.2,6.5],3.7], [[-8.2,6.5],[-3,6.5],3.7], [[3,6.5],[8.2,6.5],3.7], [[8.2,-3.5],[8.2,1.6],4.6], [[8.2,5.8],[8.2,6.5],3.7]];
    for (const [a,b,height] of naveEdges) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]), angle = Math.atan2(b[0] - a[0], b[1] - a[1]), x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
      naveWalls.push({ x, y: .325, z, sx: .3, sy: .65, sz: length, ry: angle });
      naveWindows.push({ x, y: (.7 + height) / 2, z, sx: .025, sy: height - .7, sz: length, ry: angle });
      const facade = naveFacades[a[0] === b[0] ? a[0] < 0 ? 0 : 2 : 1];
      facade.rails.push({ x, y: height, z, sx: .078, sy: .0845, sz: length + .1, ry: angle });
      naveFrames.push({ x, y: .7, z, sx: .10, sy: .08, sz: length + .1, ry: angle });
      const count = Math.ceil(length / 2.5); for (let i = 0; i <= count; i++) facade.posts.push({ x: a[0] + (b[0] - a[0]) * i / count, y: height / 2, z: a[1] + (b[1] - a[1]) * i / count, sx: .10, sy: height, sz: .10 });
      const steps = Math.ceil(length / .3); for (let i = 0; i <= steps; i++) blockers.push({ x: zone.x + a[0] + (b[0] - a[0]) * i / steps, z: zone.z + a[1] + (b[1] - a[1]) * i / steps, radius: .31 });
    }
    naveFacades[1].rails.push({ x: 0, y: 3.7, z: 6.5, sx: 6.15, sy: .091, sz: .091 });
    naveFacades[2].rails.push({ x: 8.2, y: 3.7, z: 3.7, sx: .091, sy: .091, sz: 4.3 });
    const growHousing = mesh(nave, box, dark, -5.6, 2.72, 4); growHousing.scale.set(3.45,.12,.3); growHousing.name = 'pantry_grow_light_housing';
    pantryGrowEmitter = mesh(nave,new THREE.CylinderGeometry(.065,.065,3.2,8),new THREE.MeshStandardMaterial({color:0x26353a,roughness:.3,emissive:0xffdfb8,emissiveIntensity:0}),-5.6,2.6,4);pantryGrowEmitter.rotation.z=Math.PI/2;pantryGrowEmitter.name='pantry_grow_light_tube';
    for(const x of [-7,-4.2]){const roofY=3.7+1.2*(1-Math.abs(x)/8.3);rod(nave,new THREE.Vector3(x,2.78,4),new THREE.Vector3(x,roofY,4),.018,bronze);const clamp=mesh(nave,box,dark,x,roofY,4);clamp.scale.set(.16,.1,.16);}
    const lowerWalls = instances(nave, box, masonry.clone(), naveWalls); lowerWalls.name = 'pantry_nave_low_walls'; lowerWalls.castShadow = true;
    instances(nave, box, naveGlazing, naveWindows);
    const naveRoofOccluders = [];
    const naveMetal = bronze.clone(); naveMetal.color.set(0x6a7b78); naveMetal.roughness = .75; naveMetal.metalness = .15; naveMetal.emissive.set(0x000000); naveMetal.emissiveIntensity = 0;
    for (const [bay,back,front,eave] of [[0,-3.5,1.5,4.6],[1,1.5,6.5,3.7]]) {
      const rise = 1.2, half = 8.3;
      for (const side of [-1,1]) {
        const glassRoof = naveGlazing.clone(); glassRoof.opacity = .08; glassRoof.forceSinglePass = true;
        const roof = mesh(nave, new THREE.PlaneGeometry(Math.hypot(half,rise),front-back+.12),glassRoof,side*half/2,eave+rise/2,(back+front)/2); roof.rotation.x = -Math.PI/2; roof.rotation.y = side*Math.atan2(rise,half); roof.name = 'pantry_nave_glazed_roof_'+bay+'_'+side; roof.userData.restOpacity = .08; avatarOccluders.push(roof); naveRoofOccluders.push(roof);
        for (const z of [back,(back+front)/2,front]) { const a = new THREE.Vector3(side*half,eave,z), b = new THREE.Vector3(0,eave+rise,z), direction = b.clone().sub(a), turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP,direction.clone().normalize())), center = a.add(b).multiplyScalar(.5); naveRoofFrames.push({ x:center.x,y:center.y,z:center.z,sx:.065,sy:direction.length(),sz:.065,rx:turn.x,ry:turn.y,rz:turn.z }); }
      }
      naveRoofFrames.push({ x:0,y:eave+rise,z:(back+front)/2,sx:.078,sy:.078,sz:front-back+.15 });
    }
    const framing = instances(nave, box, naveMetal, naveFrames); framing.name = 'pantry_nave_bronze_frames'; framing.castShadow = true;
    const naveInterior = new THREE.Box3(new THREE.Vector3(-8.2, -100, -3.5), new THREE.Vector3(8.2, 100, 6.5));
    for (const facade of naveFacades) {
      const posts = instances(nave, box, naveMetal.clone(), facade.posts); posts.name = 'pantry_nave_' + facade.name + '_posts'; posts.castShadow = true; posts.computeBoundingBox(); const cutawayBounds = posts.boundingBox.clone(); cutawayBounds.min.y = -1; cutawayBounds.max.y = 40;
      const rails = instances(nave, box, naveMetal.clone(), facade.rails); rails.name = 'pantry_nave_' + facade.name + '_rails'; rails.castShadow = false; naveRoofOccluders.push(rails);
      for (const surface of [posts, rails]) { surface.userData.cutawayBounds = cutawayBounds; surface.userData.cutawayInterior = naveInterior; avatarOccluders.push(surface); }
    }
    const roofFraming = instances(nave, box, naveMetal.clone(), naveRoofFrames); roofFraming.name = 'pantry_nave_overhead_frames'; roofFraming.castShadow = false; roofFraming.userData.linkedOccluders = naveRoofOccluders; avatarOccluders.push(roofFraming);
    const stepGeometry = new THREE.BufferGeometry(); stepGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-8.3,3.7,1.5,0,4.9,1.5,8.3,3.7,1.5,-8.3,4.6,1.5,0,5.8,1.5,8.3,4.6,1.5],3)); stepGeometry.setIndex([0,1,4,0,4,3,1,2,5,1,5,4]); stepGeometry.computeVertexNormals(); const stepGlass = mesh(nave,stepGeometry,naveGlazing); stepGlass.name = 'pantry_nave_glazed_roof_step'; naveRoofOccluders.push(stepGlass);
    const frontGable = new THREE.BufferGeometry(); frontGable.setAttribute('position',new THREE.Float32BufferAttribute([-8.2,3.7,6.5,8.2,3.7,6.5,0,4.9,6.5],3)); frontGable.computeVertexNormals(); const frontGlass = mesh(nave,frontGable,naveGlazing); naveRoofOccluders.push(frontGlass);

    const roofTexture = new THREE.TextureLoader().load(new URL('./assets/slate-tint-v1.png', import.meta.url).href); roofTexture.colorSpace = THREE.SRGBColorSpace; roofTexture.wrapS = roofTexture.wrapT = THREE.ClampToEdgeWrapping; roofTexture.anisotropy = 4;
    const roofMaterial = new THREE.MeshStandardMaterial({ map: roofTexture, color: 0x476365, roughness: .76, metalness: .16, side: THREE.DoubleSide }); roofMaterial.color.multiplyScalar(2.195976);
    const floor = mesh(hall, new THREE.PlaneGeometry(16.4, 5.7), new THREE.MeshStandardMaterial({ color: 0x627b70, roughness: .92 }), 0, .01, -6.35); floor.rotation.x = -Math.PI / 2;
    const wallSegments = [[[-8.2, -3.5], [-2.5, -3.5]], [[2.5, -3.5], [8.2, -3.5]], [[-8.2, -3.5], [-8.2, -9.2]], [[8.2, -3.5], [8.2, -9.2]], [[-8.2, -9.2], [8.2, -9.2]]];
    const walls = [], windows = [], frames = [];
    for (const [a, b] of wallSegments) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]), angle = Math.atan2(b[0] - a[0], b[1] - a[1]), x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
      walls.push({ x, y: .58, z, sx: .38, sy: 1.16, sz: length, ry: angle });
      windows.push({ x, y: 2.66, z, sx: .035, sy: 2.96, sz: length, ry: angle });
      frames.push({ x, y: 4.18, z, sx: .26, sy: .24, sz: length + .15, ry: angle });
      frames.push({ x, y: 1.2, z, sx: .28, sy: .1, sz: length + .15, ry: angle });
      const divisions = Math.ceil(length / 2.25);
      for (let i = 0; i <= divisions; i++) frames.push({ x: a[0] + (b[0] - a[0]) * i / divisions, y: 2.13, z: a[1] + (b[1] - a[1]) * i / divisions, sx: .17, sy: 4.26, sz: .17 });
      const steps = Math.ceil(length / .35);
      for (let i = 0; i <= steps; i++) blockers.push({ x: zone.x + a[0] + (b[0] - a[0]) * i / steps, z: zone.z + a[1] + (b[1] - a[1]) * i / steps, radius: .36 });
    }
    const wall = instances(hall, box, masonry, walls); wall.name = 'pantry_conservatory_walls'; wall.castShadow = true; avatarOccluders.push(wall);
    instances(hall, box, glazing, windows);
    const frame = instances(hall, box, bronze, frames); frame.castShadow = true;
    const entryBeam = mesh(hall, box, bronze, 0, 4.18, -3.5); entryBeam.scale.set(5.1, .24, .28);
    for (const side of [-1, 1]) {
      const roof = mesh(hall, new THREE.PlaneGeometry(Math.hypot(6.35, 1.15), 6.1), roofMaterial.clone(), side * 5.175, 4.775, -6.35); roof.rotation.x = -Math.PI / 2; roof.rotation.y = side * Math.atan2(1.15, 6.35); roof.name = 'pantry_conservatory_roof_' + side; roof.castShadow = true; avatarOccluders.push(roof);
      const clerestory = mesh(hall, new THREE.PlaneGeometry(6.1, 1.28), glazing, side * 2, 5.99, -6.35); clerestory.rotation.y = Math.PI / 2;
      for (const z of [-9.4, -7.35, -5.35, -3.3]) {
        rod(hall, new THREE.Vector3(side * 8.35, 4.2, z), new THREE.Vector3(side * 2, 5.35, z), .065, bronze);
        const mullion = mesh(hall, box, bronze, side * 2, 5.99, z); mullion.scale.set(.1, 1.4, .1);
      }
      const crownRail = mesh(hall, box, bronze, side * 2, 6.66, -6.35); crownRail.scale.set(.16, .14, 6.2);
      const gutter = mesh(hall, box, bronze, side * 8.35, 4.2, -6.35); gutter.scale.set(.18, .12, 6.2);
      rod(hall, new THREE.Vector3(side * 8.35, 4.2, -8.8), new THREE.Vector3(side * 8.35, .4, -8.8), .08, bronze);
    }
    const crownGeometry = new THREE.BoxGeometry(4.2, .24, 6.3, 2, 1, 1).toNonIndexed(), crownPositions = crownGeometry.attributes.position;
    for (let i = 0; i < crownPositions.count; i++) if (crownPositions.getY(i) > 0 && crownPositions.getX(i) === 0) crownPositions.setY(i, crownPositions.getY(i) + .45);
    crownGeometry.computeVertexNormals();
    const crown = mesh(hall, crownGeometry, roofMaterial.clone(), 0, 6.76, -6.35); crown.name = 'pantry_conservatory_clerestory_roof'; crown.castShadow = true; avatarOccluders.push(crown);
    for (const z of [-9.35, -3.35]) {
      const upperPane = mesh(hall, new THREE.PlaneGeometry(3.9, 2.35), glazing, 0, 5.48, z);
      const upperRail = mesh(hall, box, bronze, 0, 5.34, z); upperRail.scale.set(4.1, .14, .14);
    }
    const beds = [], leaves = [];
    for (const x of [5.2]) {
      beds.push({ x, y: .38, z: -8, sx: 4, sy: .76, sz: 1.2 });
      for (let i = 0; i < 10; i++) leaves.push({ x: x - 1.7 + i * .38, y: 1.05 + (i % 3) * .1, z: -8, sx: .24, sy: .5, sz: .36, ry: i * .7 });
      const pipe = mesh(hall, new THREE.CylinderGeometry(.09, .09, 4.3, 8), bronze, x, 1.62, -8.7); pipe.rotation.z = Math.PI / 2;
      for (let i = 0; i < 5; i++) rod(hall, new THREE.Vector3(x - 1.6 + i * .8, 1.6, -8.7), new THREE.Vector3(x - 1.6 + i * .8, .9, -8), .035, bronze);
    }
    instances(hall, box, timber, beds);
    const cropGeometry = new THREE.OctahedronGeometry(1), cropMaterial = new THREE.MeshStandardMaterial({ color: 0x8cac79, roughness: .9 });
    instances(hall, cropGeometry, cropMaterial, leaves);
    const lowerBeds = [], soilTrays = [], cropLeaves = [], cropStems = [], dripLines = [], rackParts = [];
    for (const z of [2,4.7]) {
      lowerBeds.push({ x:-5.6,y:.38,z,sx:4,sy:.76,sz:1.2 }); soilTrays.push({ x:-5.6,y:.79,z,sx:3.78,sy:.08,sz:1.02 });
      dripLines.push({ x:-5.6,y:.9,z:z-.5,sx:3.9,sy:.055,sz:.055 });
      for (let column=0;column<7;column++) {
        const x=-7.25+column*.55; dripLines.push({ x,y:.9,z:z-.05,sx:.035,sy:.035,sz:.9 });
        for (const row of [-1,1]) { const plantZ=z+row*.22; cropStems.push({ x,y:1.03,z:plantZ,sx:.5,sy:.5,sz:.5 }); for(let leaf=0;leaf<4;leaf++){ const turn=leaf*Math.PI/2+column*.23; cropLeaves.push({ x:x+Math.sin(turn)*.18,y:1.12+(leaf%2)*.12,z:plantZ+Math.cos(turn)*.18,sx:.24,sy:.075,sz:.43,ry:turn,rz:.2 }); } }
      }
      for (const x of [-7,-6.1,-5.2,-4.3]) blockers.push({ x:zone.x+x,z:zone.z+z,radius:.55 });
    }
    const bedsMesh=instances(nave,box,timber,lowerBeds); bedsMesh.name='pantry_nave_crop_beds'; bedsMesh.castShadow=true;
    for(const y of [.72,1.72]) {
      rackParts.push({ x:-7.45,y,z:-.95,sx:.9,sy:.09,sz:1.7 }); soilTrays.push({ x:-7.45,y:y+.085,z:-.95,sx:.78,sy:.08,sz:1.56 });
      for(const z of [-1.5,-.95,-.4]) { cropStems.push({ x:-7.45,y:y+.29,z,sx:.45,sy:.4,sz:.45 }); for(let leaf=0;leaf<4;leaf++){ const turn=leaf*Math.PI/2; cropLeaves.push({ x:-7.45+Math.sin(turn)*.12,y:y+.36+(leaf%2)*.08,z:z+Math.cos(turn)*.12,sx:.18,sy:.065,sz:.29,ry:turn,rz:.2 }); } }
    }
    for(const x of [-7.84,-7.06])for(const z of [-1.72,-.18])rackParts.push({ x,y:1.2,z,sx:.065,sy:2.4,sz:.065 });
    const rack=instances(nave,box,bronze,rackParts);rack.name='pantry_two_level_growing_rack';rack.castShadow=true;
    for(const z of [-1.5,-.9,-.3])blockers.push({ x:zone.x-7.45,z:zone.z+z,radius:.42 });
    instances(nave,box,new THREE.MeshStandardMaterial({color:0x263c30,roughness:1}),soilTrays);
    instances(nave,cylinder,bronze,cropStems);instances(nave,cropGeometry,cropMaterial,cropLeaves);instances(nave,box,bronze,dripLines);
    const serviceMasonry = masonry.clone(); serviceMasonry.color.set(0x657970);
    const serviceTopStone = stone.clone(); serviceTopStone.color.set(0x8c9c95);
    const bench=mesh(nave,box,serviceMasonry,6.9,.5,-1.5);bench.scale.set(1.65,1,2.4);bench.name='pantry_built_in_service_cabinet';bench.castShadow=true;
    const worktop=mesh(nave,box,serviceTopStone,6.9,1.06,-1.5);worktop.scale.set(1.8,.12,2.55);
    const serviceBodies = instances(nave, box, serviceMasonry, [
      {x:7.2,y:.5,z:.85,sx:1.2,sy:1,sz:2.5},
      {x:5.95,y:.2,z:2.6,sx:3.7,sy:.4,sz:1.2},
      {x:3.2,y:.2,z:2.3,sx:1.8,sy:.4,sz:1.8}
    ]); serviceBodies.name = 'pantry_connected_service_bay'; serviceBodies.castShadow = true;
    const serviceTops = instances(nave, box, serviceTopStone, [
      {x:7.2,y:1.06,z:.85,sx:1.35,sy:.12,sz:2.6},
      {x:5.95,y:.445,z:2.6,sx:3.7,sy:.09,sz:1.2},
      {x:3.2,y:.445,z:2.3,sx:1.8,sy:.09,sz:1.8}
    ]); serviceTops.name = 'pantry_connected_service_worktop'; serviceTops.castShadow = true;
    const serviceTopBounds = [{ x:worktop.position.x, z:worktop.position.z, width:worktop.scale.x, depth:worktop.scale.z }];
    const serviceMatrix = new THREE.Matrix4();
    for (let i = 0; i < serviceTops.count; i++) {
      serviceTops.getMatrixAt(i, serviceMatrix);
      const e = serviceMatrix.elements;
      serviceTopBounds.push({ x:e[12], z:e[14], width:e[0], depth:e[10] });
    }
    for (const part of serviceTopBounds) pantryServiceFootprints.push({
      minX:zone.x + part.x - part.width / 2 - .25, maxX:zone.x + part.x + part.width / 2 + .25,
      minZ:zone.z + part.z - part.depth / 2 - .25, maxZ:zone.z + part.z + part.depth / 2 + .25
    });
    const toolBack=mesh(nave,box,bronze,7.78,1.42,-1.5);toolBack.scale.set(.08,.62,2.4);
    for(const z of [-2.5,-.5])rod(nave,new THREE.Vector3(7.78,1.42,z),new THREE.Vector3(8.15,1.42,z),.045,bronze);
    for(const z of [-2,-1])blockers.push({ x:zone.x+6.9,z:zone.z+z,radius:.7 });
    for(let i=0;i<3;i++) { const x=6.35+i*.55; const bezel=mesh(nave,new THREE.CylinderGeometry(.15,.15,.055,12),bronze,x,.72,-.265);bezel.rotation.x=Math.PI/2;const dial=mesh(nave,new THREE.CircleGeometry(.115,16),stone,x,.72,-.232);const needle=mesh(nave,box,dark,x,.74,-.223);needle.scale.set(.014,.12,.015);needle.rotation.z=-.5+i*.45; }
    rod(parent,new THREE.Vector3(7,.28,-3.35),new THREE.Vector3(7,.28,-2.7),.075,bronze);
    rod(parent,new THREE.Vector3(7,.28,-2.7),new THREE.Vector3(7,1.18,-2.7),.075,bronze);
    rod(parent,new THREE.Vector3(7,1.18,-2.7),new THREE.Vector3(7,1.18,-.4),.075,bronze);
    rod(parent,new THREE.Vector3(6.05,.28,-.4),new THREE.Vector3(5.6,.28,-.4),.075,bronze);
    const hearth = new THREE.Group(); hearth.name = 'pantry_masonry_heater'; hearth.position.set(0, 0, -7.6); hall.add(hearth);
    const heaterStone = new THREE.MeshStandardMaterial({ color: 0x66787a, roughness: .95, metalness: .02 });
    const body = mesh(hearth, new THREE.CylinderGeometry(1.2, 1.3, 2.6, 8), heaterStone, 0, 1.3, 0); body.rotation.y = Math.PI / 8; body.name = 'pantry_heater_masonry'; body.castShadow = true; avatarOccluders.push(body);
    const capMaterial = heaterStone.clone(); capMaterial.color.set(0x3e4f55);
    const cap = mesh(hearth, new THREE.CylinderGeometry(1.28, 1.28, .18, 8), capMaterial, 0, 2.66, 0); cap.rotation.y = Math.PI / 8; cap.name = 'pantry_heater_cap'; avatarOccluders.push(cap);
    const doorFrame = mesh(hearth, box, bronze, 0, 1.03, 1.205); doorFrame.scale.set(1.5, .91, .11);
    pantryFirebox = new THREE.MeshStandardMaterial({ color: 0x152229, roughness: .23, metalness: .18, emissive: 0xff7b29, emissiveIntensity: 0 });
    const firebox = mesh(hearth, new THREE.PlaneGeometry(1.28, .68), pantryFirebox, 0, 1.03, 1.267); firebox.name = 'pantry_firebox_glass'; avatarOccluders.push(firebox);
    for (const y of [.67, 1.39]) { const bar = mesh(hearth, box, dark, 0, y, 1.27); bar.scale.set(1.35, .05, .035); }
    const handle = mesh(hearth, box, bronze, .6, 1.03, 1.31); handle.scale.set(.04, .27, .08);
    blockers.push({ x: zone.x, z: zone.z - 7.6, radius: 1.19 });
    const flue = new THREE.Group(); flue.name = 'pantry_supported_flue'; hall.add(flue);
    rod(flue, new THREE.Vector3(0, 2.75, -8), new THREE.Vector3(0, 3.1, -8), .22, dark);
    rod(flue, new THREE.Vector3(0, 3.1, -8), new THREE.Vector3(2.45, 3.1, -8), .22, dark);
    rod(flue, new THREE.Vector3(2.45, 3.1, -8), new THREE.Vector3(2.45, 7.8, -8), .22, dark);
    for (const y of [3.2, 4.4, 6.6, 7.55]) { const band = mesh(flue, new THREE.TorusGeometry(.24, .035, 6, 16), bronze, 2.45, y, -8); band.rotation.x = Math.PI / 2; }
    rod(flue, new THREE.Vector3(2.45, 4.18, -8), new THREE.Vector3(2.45, 4.18, -9.2), .055, bronze);
    rod(flue, new THREE.Vector3(2.45, 6.6, -8), new THREE.Vector3(2, 6.6, -8), .055, bronze);
    mesh(flue, new THREE.ConeGeometry(.42, .2, 8), dark, 2.45, 7.9, -8);
    const servicePipe = mesh(hall, new THREE.CylinderGeometry(.1, .1, 14, 8), bronze, 0, 2.2, -8.85); servicePipe.rotation.z = Math.PI / 2;
    rod(hall, new THREE.Vector3(0, 2.2, -8.85), new THREE.Vector3(0, 2.2, -8.5), .1, bronze);
    rod(hall, new THREE.Vector3(7, 2.2, -8.85), new THREE.Vector3(7, 2.2, -5), .1, bronze);
    rod(hall, new THREE.Vector3(7, 2.2, -5), new THREE.Vector3(5, 2.2, -5), .1, bronze);
    rod(hall, new THREE.Vector3(7, 2.2, -5), new THREE.Vector3(7, .28, -5), .1, bronze);
    rod(hall, new THREE.Vector3(7, .28, -5), new THREE.Vector3(7, .28, -3.35), .1, bronze);
    rod(parent, new THREE.Vector3(7, p.height + .28, -3.35), new THREE.Vector3(7, .28, -3.35), .1, bronze);
    rod(parent, new THREE.Vector3(7, .28, -3.35), new THREE.Vector3(5.6, .28, -3.35), .1, bronze);
    rod(parent, new THREE.Vector3(5.6, .28, -3.35), new THREE.Vector3(5.6, .28, .75), .1, bronze);
    rod(parent, new THREE.Vector3(5.6, .28, .75), new THREE.Vector3(5.6, 1.1, .75), .1, bronze);
    const pipeFeet = [[7,-3.35],[5.6,-2.5],[5.6,-.5],[5.6,.45]].map(([x,z]) => { const floor = groundHeightAt(zone.x + x, zone.z + z) ?? 0; return { x, y: (floor + .18) / 2, z, sx: .35, sy: .18 - floor, sz: .28 }; });
    instances(parent, box, dark, pipeFeet);

    const lanternZ = -3.8;
    const tie = mesh(hall, box, bronze, 0, 4.18, lanternZ); tie.scale.set(16.4, .14, .16);
    rod(hall, new THREE.Vector3(0, 4.18, lanternZ), new THREE.Vector3(0, 3.84, lanternZ), .045, bronze);
    pantryLantern = lantern(hall, 0, 3.5, lanternZ, 0x91bac6); pantryLantern.name = 'pantry_service_lantern';
    mesh(pantryLantern, new THREE.ConeGeometry(.4, .16, 8), dark, 0, .34, 0);
    mesh(pantryLantern, new THREE.CylinderGeometry(.3, .34, .1, 8), bronze, 0, -.32, 0);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; rod(pantryLantern, new THREE.Vector3(Math.sin(a) * .26, -.27, Math.cos(a) * .26), new THREE.Vector3(Math.sin(a) * .26, .28, Math.cos(a) * .26), .025, bronze); }

    const heater=mesh(parent,new THREE.CylinderGeometry(.7,1,2.2,8),dark,5.6,1.1,.75); heater.name = 'pantry_courtyard_boiler'; heater.castShadow = true;
    blockers.push({ x: zone.x + heater.position.x, z: zone.z + heater.position.z, radius: .9 });
    const windowFrame = mesh(parent, box, bronze, heater.position.x, 1.6, heater.position.z + .77); windowFrame.scale.set(.94, .6, .12);
    pantryBoilerEmitter = mesh(parent, new THREE.PlaneGeometry(.74, .4), new THREE.MeshStandardMaterial({ color: 0x17292f, roughness: .28, metalness: .12, emissive: 0xffba7a, emissiveIntensity: 0 }), heater.position.x, 1.6, heater.position.z + .84); pantryBoilerEmitter.name = 'pantry_boiler_window';
    const coils=new THREE.Group();coils.position.copy(heater.position);parent.add(coils);for(let j=0;j<4;j++)ring(coils,.9,.035,gold,-.8+j*.5);
    districtViews.get(zone.id).mechanics.push(coils);
    const wash = new THREE.Group(); wash.name = 'clinic_return_washstand'; wash.position.set(5.7, 0, 2.4); wash.visible = false; parent.add(wash);
    const stand = mesh(wash, box, stone, 0, .65, 0); stand.scale.set(1.3, .12, .8);
    const washFeet = instances(wash, box, stone, [-.45,.45].map(x => ({x,y:.54,z:0,sx:.12,sy:.1,sz:.6}))); washFeet.name = 'clinic_return_washstand_counter_feet';
    const basin = mesh(wash, new THREE.TorusGeometry(.28, .065, 6, 20), bronze, 0, .75, 0); basin.rotation.x = -Math.PI / 2;
    rod(wash, new THREE.Vector3(.4, .7, -.18), new THREE.Vector3(.4, 1.15, -.18), .045, bronze);
    rod(wash, new THREE.Vector3(.4, 1.15, -.18), new THREE.Vector3(0, 1.15, 0), .045, bronze);
    const stream = mesh(wash, new THREE.CylinderGeometry(.025, .025, .34, 6), mint, 0, .94, 0); stream.name = 'clinic_essential_return_stream';
    const loop = ring(wash, .62, .055, mint, .8); loop.name = 'clinic_full_return_indicator';
    clinicReturnCue = { group: wash, stream, loop };
  }

  function buildChoir(parent, zone) {
    const pipes=[],caps=[];
    for(let i=0;i<9;i++) {
      const x=(i-4)*1.15,h=7.5+Math.sin(i/8*Math.PI)*6;
      pipes.push({x,z:-7,y:h/2,sx:.33,sy:h,sz:.33});caps.push({x,z:-7,y:h+.08,s:.4});
    }
    const organ = instances(parent,new THREE.CylinderGeometry(1,1.12,1,12),stone,pipes); organ.castShadow = true;
    instances(parent,new THREE.OctahedronGeometry(1),bronze,caps);
    instances(parent,new THREE.CylinderGeometry(1,1,1,12),dark,pipes.map(p => ({ x:p.x, z:p.z, y:.35, sx:.42, sy:.7, sz:.42 })));
    instances(parent,new THREE.CylinderGeometry(1,1,1,12),bronze,pipes.flatMap(p => [1.1, p.sy - .7].map(y => ({ x:p.x, z:p.z, y, sx:.35, sy:.12, sz:.35 }))));
    for(const y of [2.1,5.4]){const rail=mesh(parent,box,bronze,0,y,-7);rail.scale.set(10.4,.16,.26);}
    const orbit=new THREE.Group();orbit.position.set(0,7,-6.6);parent.add(orbit);
    for(let i=0;i<3;i++){const r=mesh(orbit,new THREE.TorusGeometry(3.8+i*.4,.04,6,64),i===1?mint:bronze);r.rotation.y=i*.7;r.rotation.z=i*.4;rotors.push({object:r,axis:'z',speed:(i%2?-1:1)*.045});}
    for(const side of [-1,1]){pillar(parent,side*9,1,6.3,.2);const bell=mesh(parent,new THREE.CylinderGeometry(.45,.9,1.5,12,1,true),bronze,side*9,5.6,1);bell.rotation.z=side*.1;lantern(parent,side*9,4.7,1,zone.color||0xb9aff3);}
  }

  function buildWind(parent, zone) {
    const baffles = [];
    for (const [x, z] of [[9, 5], [9, -5], [-9, 0], [0, -10]]) pillar(parent, x, z, 5.8, .22);
    const definitions = [
      { id: 'wind_west', label: 'WEST', x: -8, anchorX: -9, z: 0, poses: { crosswind: 0, leeward: -.65, spill: .8 } },
      { id: 'wind_center', label: 'CENTER', x: 0, z: -10, poses: { hold: 0, pass: Math.PI / 2 } },
      { id: 'wind_east', label: 'EAST', x: 7, anchorX: 9, z: -5, poses: { crosswind: 0, leeward: -.65, spill: .8 } },
    ];
    const plateGeometry = new THREE.PlaneGeometry(3.4, 1.16);
    const sailPanel = new THREE.PlaneGeometry(2.8, 4.4, 12, 8);
    for (let i = 0; i < sailPanel.attributes.position.count; i++) { const x = sailPanel.attributes.position.getX(i); sailPanel.attributes.position.setZ(i, .3 * (1 - (x / 1.4) ** 2)); }
    sailPanel.computeVertexNormals();
    const sailEnamel = new THREE.MeshStandardMaterial({ color: 0x78aaa1, roughness: .56, metalness: .1, side: THREE.DoubleSide });
    for (const def of definitions) {
      const maps = {};
      for (const setting of Object.keys(def.poses)) {
        const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 136;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#9d8b66'; ctx.fillRect(0, 0, 384, 136);
        ctx.strokeStyle = '#655337'; ctx.lineWidth = 3; ctx.strokeRect(5, 5, 374, 126);
        ctx.fillStyle = '#e0cf9f'; ctx.fillRect(8, 8, 368, 3);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#10242a';
        ctx.font = 'bold 31px sans-serif'; ctx.fillText(def.label, 192, 31);
        ctx.font = 'bold 52px sans-serif'; ctx.fillText(setting.toUpperCase(), 192, 92, 356);
        maps[setting] = new THREE.CanvasTexture(canvas); maps[setting].colorSpace = THREE.SRGBColorSpace;
      }
      const frame = new THREE.Group(); frame.name = 'gallery_' + def.id; frame.position.set(def.x, 3.8, def.z); parent.add(frame);
      if (def.anchorX !== undefined) rod(parent, new THREE.Vector3(def.anchorX, 3.8, def.z), new THREE.Vector3(def.x, 3.8, def.z), .075, bronze);
      const bow = mesh(frame, new THREE.TorusGeometry(1.65, .085, 8, 64), bronze); bow.scale.y = 1.48;
      const vane = new THREE.Group(); vane.name = def.id + '_vane'; frame.add(vane);
      const panel = mesh(vane, sailPanel, sailEnamel); panel.castShadow = true;
      for (const y of [-2.2, 2.2]) {
        const points = [-1.4, -.7, 0, .7, 1.4].map(x => new THREE.Vector3(x, y, .035 + .3 * (1 - (x / 1.4) ** 2)));
        mesh(vane, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, .045, 5, false), bronze);
      }
      for (const x of [-.9, .9]) { const rib = mesh(vane, box, bronze, x, 0, .035 + .3 * (1 - (x / 1.4) ** 2)); rib.scale.set(.045, 4.35, .045); }
      mesh(frame, new THREE.CylinderGeometry(.08, .08, 5.05, 8), bronze);
      const plaqueY = def.id === 'wind_east' ? -.8 : -2;
      const plaqueBack = mesh(frame, box, bronze, 0, plaqueY, 1.42); plaqueBack.scale.set(3.5, 1.26, .14);
      const plate = mesh(frame, plateGeometry, new THREE.MeshBasicMaterial({ map: maps[Object.keys(def.poses)[0]], side: THREE.DoubleSide }), 0, plaqueY, 1.5);
      plate.name = def.id + '_plate';
      for (const x of [-1.5, 1.5]) rod(frame, new THREE.Vector3(x, plaqueY + .5, 0), new THREE.Vector3(x, plaqueY + .5, 1.5), .04, bronze);
      baffles.push({ ...def, vane, plate, maps, current: null });
    }
    const sheltered = new THREE.Group(); sheltered.name = 'gallery_achieved_shelter'; sheltered.visible = false; parent.add(sheltered);
    for (const x of [-2.2, 2.2]) rod(sheltered, new THREE.Vector3(x, .14, 2), new THREE.Vector3(x, .14, 7.5), .065, mint);
    const statusMaps = Object.fromEntries(['ROUTE UNTESTED', 'GUST TEST RUNNING', 'SHELTER TESTED', 'SETUP CHANGED'].map(label => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#9d8b66'; ctx.fillRect(0, 0, 512, 96);
      ctx.strokeStyle = '#655337'; ctx.lineWidth = 3; ctx.strokeRect(4, 4, 504, 88); ctx.fillStyle = '#e0cf9f'; ctx.fillRect(7, 7, 498, 3);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#152f35'; ctx.font = 'bold 40px sans-serif'; ctx.fillText(label, 256, 48);
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; return [label, map];
    }));
    const status = mesh(parent, new THREE.PlaneGeometry(4.6, .85), new THREE.MeshBasicMaterial({ map: statusMaps['ROUTE UNTESTED'], side: THREE.DoubleSide }), 0, 3, -.6); status.name = 'gallery_wind_status';
    const statusBack = mesh(parent, box, bronze, 0, 3, -.68); statusBack.scale.set(4.7, .95, .14);
    for (const x of [-2, 2]) rod(parent, new THREE.Vector3(0, 1.1, -1), new THREE.Vector3(x, 2.6, -.6), .085, bronze);
    const strandCount = 18, strandSegments = 20, strandPositions = [], strandSeeds = [], strandIndices = [];
    for (let strand = 0; strand < strandCount; strand++) {
      const lane = -11 + strand * 1.3, phase = (strand * .61803398875) % 1, speed = .8 + (strand % 5) * .12;
      for (let step = 0; step <= strandSegments; step++) for (const side of [-1, 1]) { strandPositions.push(step / strandSegments, side, 0); strandSeeds.push(lane, phase, speed); }
      for (let step = 0; step < strandSegments; step++) { const at = strand * (strandSegments + 1) * 2 + step * 2; strandIndices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2); }
    }
    const windGeometry = new THREE.BufferGeometry(); windGeometry.setAttribute('position', new THREE.Float32BufferAttribute(strandPositions, 3)); windGeometry.setAttribute('strand', new THREE.Float32BufferAttribute(strandSeeds, 3)); windGeometry.setIndex(strandIndices); windGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 28);
    const windUniforms = { time: { value: 0 }, baffles: { value: new THREE.Vector3() }, sheltered: { value: 0 }, testing: { value: 0 }, tint: { value: new THREE.Color(0xc2e1d7) } };
    const windMaterial = new THREE.ShaderMaterial({ uniforms: windUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute vec3 strand; uniform float time; uniform vec3 baffles; uniform float sheltered; varying float along; varying float across;
        void main(){
          along=position.x; across=position.y;
          float x=mod(time*(3.2+strand.z)+strand.y*38.,38.)-17.-(1.-along)*(2.6+strand.z);
          float z=strand.x+.32*sin(x*.45+strand.y*6.283+time*.4);
          z+=sin(baffles.x)*1.7*exp(-((x+8.)*(x+8.)+z*z)*.08);
          z+=sin(baffles.y)*1.3*exp(-(x*x+(z+10.)*(z+10.))*.09);
          z+=sin(baffles.z)*1.7*exp(-((x-7.)*(x-7.)+(z+5.)*(z+5.))*.08);
          if(sheltered>.5 && z>1.4 && z<8.1){float bend=1.-smoothstep(2.2,5.2,abs(x));z=mix(z,z<4.75?1.25:8.25,bend);}
          float y=.85+strand.y*2.2+.12*sin(x*.3+time*.6+strand.y*6.283);
          vec3 p=vec3(x,y+across*.033,z);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
        }`,
      fragmentShader: `uniform vec3 tint; uniform float testing; varying float along; varying float across;
        void main(){float alpha=pow(max(0.,sin(along*3.14159265)),1.2)*(1.-smoothstep(.25,1.,abs(across)))*(.34+testing*.12);gl_FragColor=vec4(tint,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const windStrands = mesh(parent, windGeometry, windMaterial); windStrands.name = 'gallery_weather_strands';
    windRig = { baffles, sheltered, status, statusMaps, windUniforms, initialized: false };
    const loom = new THREE.Group(); loom.name = 'gallery_storm_loom'; parent.add(loom);
    const ribPaths = [
      [[-9, 5.8, 0], [-8.3, 8.7, -1.8], [-5, 11.1, -4.9], [-1.3, 10.6, -6.5]],
      [[9, 5.8, -5], [8, 8.7, -5.6], [4.7, 11.1, -6.5], [1.3, 10.6, -6.5]],
      [[0, 5.8, -10], [0, 8.7, -11], [0, 11.2, -9.3], [0, 10.6, -6.5]],
    ];
    for (const path of ribPaths) {
      const curve = new THREE.CatmullRomCurve3(path.map(p => new THREE.Vector3(...p)));
      const rib = mesh(loom, new THREE.TubeGeometry(curve, 32, .2, 8, false), stone); rib.castShadow = true;
      const seam = new THREE.CatmullRomCurve3(path.map(([x, y, z]) => new THREE.Vector3(x, y + .17, z)));
      mesh(loom, new THREE.TubeGeometry(seam, 32, .045, 5, false), bronze);
      for (const t of [.12, .48, .83]) {
        const collar = mesh(loom, new THREE.CylinderGeometry(.25, .25, .24, 10), bronze);
        collar.position.copy(curve.getPoint(t)); collar.quaternion.setFromUnitVectors(UP, curve.getTangent(t));
      }
    }
    const drum = new THREE.Group(); drum.position.set(0, 10.6, -6.5); loom.add(drum);
    const barrel = mesh(drum, new THREE.CylinderGeometry(.62, .62, 2.9, 20), dark); barrel.rotation.z = Math.PI / 2; barrel.castShadow = true;
    for (const x of [-1.5, -1.15, 1.15, 1.5]) {
      const flange = mesh(drum, new THREE.CylinderGeometry(.88, .88, .12, 24), bronze, x); flange.rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 9; i++) { const winding = mesh(drum, new THREE.TorusGeometry(.64, .055, 5, 24), timber, (i - 4) * .23); winding.rotation.y = Math.PI / 2; }
    const fabric = document.createElement('canvas'); fabric.width = 1024; fabric.height = 512;
    const weave = fabric.getContext('2d'), wear = random(1931);
    weave.fillStyle = '#d1d4bd'; weave.fillRect(0, 0, 1024, 512);
    for (let y = 0; y < 512; y += 3) { weave.fillStyle = y % 6 ? 'rgba(50,74,61,.045)' : 'rgba(255,250,217,.13)'; weave.fillRect(0, y, 1024, 1); }
    for (let x = 0; x < 1024; x += 4) { weave.fillStyle = 'rgba(51,78,63,.055)'; weave.fillRect(x, 0, 1, 512); }
    weave.fillStyle = 'rgba(69,98,75,.2)'; weave.fillRect(0, 0, 1024, 17); weave.fillRect(0, 495, 1024, 17); weave.fillRect(0, 0, 17, 512); weave.fillRect(1007, 0, 17, 512);
    for (const x of [341, 683]) { weave.fillStyle = 'rgba(64,89,69,.16)'; weave.fillRect(x - 3, 17, 6, 478); }
    weave.strokeStyle = 'rgba(79,96,67,.45)'; weave.lineWidth = 1.5; weave.setLineDash([3, 5]); weave.strokeRect(10, 10, 1004, 492);
    for (const x of [336, 346, 678, 688]) { weave.beginPath(); weave.moveTo(x, 18); weave.lineTo(x, 494); weave.stroke(); }
    for (const x of [40, 307, 717, 984]) {
      weave.fillStyle = '#aebda1'; weave.fillRect(x - 22, 0, 44, 52); weave.strokeRect(x - 17, 5, 34, 42);
      weave.setLineDash([]); weave.strokeStyle = '#7e8160'; weave.lineWidth = 4; weave.beginPath(); weave.arc(x, 12, 5, 0, TAU); weave.stroke(); weave.strokeStyle = 'rgba(79,96,67,.45)'; weave.lineWidth = 1.5; weave.setLineDash([3, 5]);
    }
    for (const side of [-1, 1]) {
      const x = side < 0 ? 0 : 1024;
      weave.fillStyle = '#aebda1'; weave.beginPath(); weave.moveTo(x, 422); weave.lineTo(x - side * 110, 512); weave.lineTo(x, 512); weave.closePath(); weave.fill();
      weave.beginPath(); weave.moveTo(x - side * 8, 438); weave.lineTo(x - side * 90, 504); weave.stroke();
    }
    weave.setLineDash([]); weave.save(); weave.translate(512, 266);
    weave.strokeStyle = 'rgba(60,95,83,.23)'; weave.lineWidth = 2; weave.beginPath(); weave.arc(0, 0, 145, 0, TAU); weave.stroke();
    for (let i = 0; i < 8; i++) {
      weave.save(); weave.rotate(i / 8 * TAU); weave.fillStyle = i % 2 ? 'rgba(56,91,79,.28)' : 'rgba(56,91,79,.46)';
      weave.beginPath(); weave.moveTo(0, i % 2 ? -88 : -134); weave.lineTo(14, -28); weave.lineTo(0, -49); weave.lineTo(-14, -28); weave.closePath(); weave.fill(); weave.restore();
    }
    weave.restore();
    for (let i = 0; i < 2800; i++) { weave.fillStyle = wear() > .45 ? 'rgba(232,231,204,.13)' : 'rgba(69,94,69,.035)'; weave.fillRect(wear() * 1024, wear() * 512, 1 + wear() * 6, 1 + wear() * 2); }
    const fabricMap = new THREE.CanvasTexture(fabric); fabricMap.colorSpace = THREE.SRGBColorSpace; fabricMap.anisotropy = 4;
    const sail=new THREE.Group();sail.position.set(0,7,-6.5);parent.add(sail);
    const clothGeometry = new THREE.PlaneGeometry(9, 4.4, 12, 8), clothPoints = clothGeometry.attributes.position;
    for (let i = 0; i < clothPoints.count; i++) {
      const x = clothPoints.getX(i), drop = 1 - clothGeometry.attributes.uv.getY(i);
      clothPoints.setXY(i, x * (1 - .06 * drop - .075 * Math.sin(drop * Math.PI)), 2.2 - drop * (3.7 - .5 * (1 - (x / 4.5) ** 2)));
    }
    const cloth=mesh(sail,clothGeometry,new THREE.MeshStandardMaterial({color:0xb8d6cf,map:fabricMap,roughness:.9,side:THREE.DoubleSide}));cloth.rotation.z=.12;cloth.visible=false;
    for (const [i, side] of [-1, 1].entries()) {
      const clew = new THREE.Vector3(side * 4.23, -1.5, .055);
      const collar = new THREE.CatmullRomCurve3(ribPaths[i].map(p => new THREE.Vector3(...p))).getPoint(.12);
      collar.sub(sail.position).applyAxisAngle(new THREE.Vector3(0, 0, 1), -.12);
      const sheet = rod(cloth, clew, collar, .045, timber); sheet.name = 'gallery_sail_sheet_' + i;
      const eye = mesh(cloth, new THREE.TorusGeometry(.115, .032, 6, 18), bronze, clew.x, clew.y, clew.z); eye.name = 'gallery_sail_clew_' + i;
    }
    const yard = new THREE.Group(); yard.rotation.z = .12; sail.add(yard);
    for (const side of [-1, 1]) {
      const spar = mesh(yard, new THREE.CylinderGeometry(.085, .22, 5.3, 10), bronze, side * 2.65, 2.35); spar.rotation.z = -side * Math.PI / 2; spar.castShadow = true;
      mesh(yard, new THREE.TorusGeometry(.26, .09, 8, 20), dark, side * 4.55, 2.72);
      rod(loom, new THREE.Vector3(side * 1.1, 10.6, -6.1), new THREE.Vector3(side * 4.55 * Math.cos(.12) - 2.72 * Math.sin(.12), 7 + side * 4.55 * Math.sin(.12) + 2.72 * Math.cos(.12), -6.5), .035, timber);
      for (const x of [side * 1.8, side * 4.15]) {
        const hook = mesh(yard, new THREE.TorusGeometry(.14, .035, 6, 14, Math.PI * 1.55), bronze, x, 2.08, .12); hook.rotation.z = -.7;
      }
    }
    districtViews.get(zone.id).sail=cloth;
    buildReturnLine(parent);
  }

  function buildReturnLine(parent) {
    const g = new THREE.Group(); g.name = 'gallery_return_service'; g.position.set(4, 0, -3); g.visible = false; parent.add(g);
    const base = mesh(g, box, dark, 0, .13, 0); base.scale.set(5.2, .2, 1.8);
    const housings = [], wheels = [], pickups = [];
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 1.6, body = mesh(g, box, enamel, x, .9, 0); body.scale.set(1.2, 1.35, 1.05); body.name = 'return_housing_' + (i + 1); housings.push(body);
      const lid = mesh(g, box, stone, x, 1.61, 0); lid.scale.set(1.3, .12, 1.14);
      const rim = mesh(g, new THREE.CylinderGeometry(.43, .43, .12, 16), bronze, x, .9, .6); rim.rotation.x = Math.PI / 2;
      const wheel = new THREE.Group(); wheel.name = 'return_rotor_' + (i + 1); wheel.position.set(x, .9, .69); g.add(wheel); wheels.push(wheel);
      mesh(wheel, orb, bronze).scale.setScalar(.8);
      for (let j = 0; j < 4; j++) { const blade = mesh(wheel, box, stone, Math.sin(j * Math.PI / 2) * .22, Math.cos(j * Math.PI / 2) * .22, 0); blade.scale.set(.07, .32, .055); blade.rotation.z = -j * Math.PI / 2; }
      for (let n = 0; n <= i; n++) { const notch = mesh(g, box, bronze, x + (n - i / 2) * .12, .31, .55); notch.scale.set(.055, .12, .035); }
      const pickMat = bronze.clone(), pickup = mesh(g, new THREE.CylinderGeometry(.1, .1, .26, 8), pickMat, x + .66, .64, .03); pickup.name = 'return_pickup_' + (i + 1); pickups.push(pickup);
    }
    for (const [a, b] of [[[-3, .62, 0], [-2.2, .62, 0]], [[-1, .62, 0], [-.6, .62, 0]], [[.6, .62, 0], [1, .62, 0]], [[2.2, .62, 0], [2.8, .62, 0]]]) rod(g, new THREE.Vector3(...a), new THREE.Vector3(...b), .1, bronze);
    const fitted = new THREE.Group(); fitted.name = 'return_fitted_insert'; g.add(fitted);
    const shoe = mesh(fitted, box, bronze); shoe.scale.set(.8, .12, .4);
    const insert = mesh(fitted, new THREE.CylinderGeometry(.2, .2, .38, 12), stone, 0, .2, 0); insert.name = 'return_insert_part'; insert.rotation.x = Math.PI / 2;
    const outlets = [];
    for (const [index, x] of [1.5, 3.6].entries()) {
      const id = index === 0 ? 'return_essential_outlet' : 'return_full_loop_outlet';
      rod(g, new THREE.Vector3(2.65, .62, 0), new THREE.Vector3(x, .62, 1.25), .075, bronze);
      const outlet = mesh(g, box, mint, x, .72, 1.25); outlet.scale.set(.18, .62, .18); outlet.name = id; outlet.visible = false;
      const cap = mesh(g, new THREE.CylinderGeometry(.18, .18, .15, 8), bronze, x, 1.08, 1.25); cap.rotation.x = Math.PI / 2;
      const basin = ring(g, .36, .055, bronze, .34); basin.position.set(x, .34, 1.25);
      const closed = mesh(g, box, bronze, x, .78, 1.25); closed.scale.set(.75, .12, .15); closed.name = id + '_closed';
      outlets.push({ stream: outlet, closed });
    }
    const outletStatusMaps = [['BASIN CLOSED', 'LOOP CLOSED'], ['BASIN FLOW', 'LOOP CLOSED'], ['BASIN FLOW', 'LOOP FLOW']].map(rows => {
      const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 144;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#9d8b66'; ctx.fillRect(0, 0, 384, 144);
      ctx.strokeStyle = '#655337'; ctx.lineWidth = 3; ctx.strokeRect(4, 4, 376, 136); ctx.beginPath(); ctx.moveTo(12, 72); ctx.lineTo(372, 72); ctx.stroke();
      ctx.fillStyle = '#10242a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 45px sans-serif';
      rows.forEach((text, index) => ctx.fillText(text, 192, 37 + index * 70, 356));
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; return map;
    });
    const outletStatus = new THREE.Sprite(new THREE.SpriteMaterial({ map: outletStatusMaps[0], depthWrite: false }));
    outletStatus.name = 'return_outlet_status'; outletStatus.position.set(1.05, .74, 2.7); outletStatus.scale.set(3.4, 1.28, 1); g.add(outletStatus);
    const brace = mesh(g, box, bronze, 3, .9, -.55); brace.scale.set(.1, 1.8, .1); brace.name = 'return_brace_post';
    const pawl = mesh(g, box, stone, 3, 1.1, -.5); pawl.scale.set(.6, .1, .2); pawl.rotation.z = -.3; pawl.name = 'return_fixed_pawl';
    returnLineRig = { group: g, housings, wheels, pickups, fitted, insert, outlets, outletStatus, outletStatusMaps, pawl, serial: null, began: -Infinity, pulseClosed: true };
  }

  function buildArchive(parent, zone) {
    const library=new THREE.Group();library.name='index_shelf_lift';parent.add(library);
    const boards=[],posts=[],books=[[],[],[]];
    for(let i=0;i<5;i++)for(const side of [-1,1]) {
      const x=side*8,z=-5.5+i*1.9;
      for(const y of [.3,1.3,2.4])boards.push({x,z,y,sx:.85,sy:.12,sz:1.6});
      for(const dz of [-.73,.73])posts.push({x,z:z+dz,y:1.3,sx:.85,sy:2.7,sz:.1});
      for(let shelf=0;shelf<2;shelf++)for(let j=0;j<5;j++)books[(j+i+shelf)%3].push({x:x+.03,z:z-.55+j*.25,y:.78+shelf*1.04,sx:.7,sy:.75+(j%2)*.1,sz:.18});
    }
    instances(library,box,timber,boards);instances(library,box,bronze,posts);
    const bookMaterials=[new THREE.MeshStandardMaterial({color:0x89b4a3,roughness:.8}),new THREE.MeshStandardMaterial({color:0xc3a275,roughness:.8}),new THREE.MeshStandardMaterial({color:0xb3a1bf,roughness:.8})];
    books.forEach((transforms,i)=>instances(library,box,bookMaterials[i],transforms));
    motionParts.push({object:library,axis:'y',initial:-1.5,stages:[{id:'index_raise',flag:'shelves_raised',from:-1.5,to:0}]});
    for(const z of [-8,-5.5]) {
      mesh(parent,new THREE.TorusGeometry(9,.14,8,64,Math.PI),stone,0,1,z);
      for(const side of [-1,1])pillar(parent,side*9,z,1.1,.32);
    }
    rod(parent,new THREE.Vector3(0,10,-8),new THREE.Vector3(0,10,-5.5),.06,bronze,cylinder);
    const water=mesh(parent,new THREE.CircleGeometry(6.5,48),new THREE.MeshStandardMaterial({color:0x477d8c,transparent:true,opacity:.33,metalness:.12,roughness:.2,depthWrite:false}),0,.12,0);water.rotation.x=-Math.PI/2;water.name='index_water';
    motionParts.push({object:water,axis:'y',initial:.12,stages:[{id:'index_drain',flag:'index_dry',from:.12,to:-.35}]});
    const globe=new THREE.Group();globe.position.set(0,6,-7);parent.add(globe);mesh(globe,new THREE.IcosahedronGeometry(1.7,1),glass);const r=mesh(globe,new THREE.TorusGeometry(2.3,.035,6,48),bronze);r.rotation.y=.6;rotors.push({object:globe,axis:'y',speed:.06});
  }

  function buildCrown(parent, zone) {
    const teeth=[];for(let i=0;i<10;i++){const a=i/10*TAU,h=6.2+(i%2)*2.4,x=Math.sin(a)*10.9,z=Math.cos(a)*10.9;if(x>3.2||(Math.abs(x)<.5&&z<0))continue;teeth.push({x,z,y:h/2,sx:.32,sy:h,sz:.32,ry:a});blockers.push({x:zone.x+x,z:zone.z+z,radius:.5});}
    instances(parent,box,stone,teeth);
    const turbine=new THREE.Group();turbine.position.set(0,7.8,-6);parent.add(turbine);
    mesh(turbine,new THREE.TorusGeometry(5.2,.18,8,80),bronze);const halo=mesh(turbine,new THREE.TorusGeometry(5.7,.025,6,80),mint);halo.rotation.y=.13;
    mesh(turbine,new THREE.CylinderGeometry(.85,.85,.5,12),dark).rotation.x=Math.PI/2;
    for(let i=0;i<8;i++){const a=i/8*TAU,vane=mesh(turbine,box,edge,Math.sin(a)*2.9,Math.cos(a)*2.9,0);vane.scale.set(.85,3.3,.15);vane.rotation.z=-a+.2;}
    rotors.push({object:turbine,axis:'z',speed:.17});
    const rescue=new THREE.Group();rescue.name='span_rescue_carriage';rescue.position.set(-7,-3,7);parent.add(rescue);
    const rescueTray=mesh(rescue,box,stone);rescueTray.scale.set(4.1,.35,3);
    for(const side of [-1,1]){const rail=mesh(rescue,box,bronze,side*1.9,.65,0);rail.scale.set(.08,1.1,2.8);}
    passengers(rescue,[[-.8,0],[.8,0]],'span');
    motionParts.push({object:rescue,axis:'y',initial:-3,stages:[{id:'span_rescue',flag:'span_rescued',from:-3,to:.25}]});
    const cradle=new THREE.Group();cradle.name='crossing_cradle';cradle.position.set(7,.3,9);parent.add(cradle);
    const tray=mesh(cradle,box,stone);tray.scale.set(7,.35,3);const keel=mesh(cradle,box,bronze,0,-.27,0);keel.scale.set(7.3,.15,3.3);
    for(const side of [-1,1]){const rail=mesh(cradle,box,bronze,side*3.3,.65,0);rail.scale.set(.08,1.1,2.8);}
    passengers(cradle,[[-1.7,0],[1.7,0]],'first');passengers(cradle,[[-1.7,0],[1.7,0]],'second');
    motionParts.push({object:cradle,axis:'z',initial:9,stages:[{id:'crossing_first',flag:'first_cradle_arrived',from:9,to:-18},{id:'crossing_return',flag:'crossing_cradle_returned',from:-18,to:9},{id:'crossing_second',flag:'transfer_complete',from:9,to:-18}]});
    for(const side of [-1,1]) {
      pillar(parent,7+side*3.6,8,7.2,.18);
      rod(parent,new THREE.Vector3(7+side*3.3,7.2,8),new THREE.Vector3(7+side*3.3,5.7,-18),.04,bronze,cylinder);
    }
    const landing=new THREE.Group();landing.name='far_anchorage';landing.position.set(7,0,-19.5);parent.add(landing);
    mesh(landing,new THREE.CylinderGeometry(4,3,.55,32),stone,0,-.05,0);ring(landing,3.6,.04,bronze,.25);
    passengers(landing,[[-1.8,0],[-.6,0]],'landing');passengers(landing,[[.6,0],[1.8,0]],'landing_second');
    ['voice','shelter','storm'].forEach((signal,i)=> {
      const x=(i-1)*5.5,z=-7.5;mesh(parent,new THREE.CylinderGeometry(.55,.72,.4,8),bronze,x,.2,z);
      const material=new THREE.MeshBasicMaterial({color:0x67847f,toneMapped:false});const prism=mesh(parent,new THREE.OctahedronGeometry(.42),material,x,1.1,z);
      const beam=rod(parent,new THREE.Vector3(x,1.1,z),new THREE.Vector3(0,7.8,-6),.035,new THREE.MeshBasicMaterial({color:[0x9ee5db,0xf1ce91,0xb9acf1][i],transparent:true,opacity:.4,depthWrite:false}));
      beam.visible=false;signalPrisms.push({signal,prism,beam,material,index:i});
    });
  }

  function createFixture(fixture) {
    const group = new THREE.Group(); group.position.set(fixture.x, groundHeightAt(fixture.x, fixture.z) ?? 0, fixture.z); group.name = fixture.id; root.add(group);
    const zone = ZONES.find(z => z.id === fixture.zone), color = zone?.color || PALETTE.mint;
    const glowMat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .65, depthWrite: false });
    const circle = mesh(group, new THREE.RingGeometry(.75, .83, 36), ringMat, 0, .045, 0); circle.rotation.x = -Math.PI / 2;
    const base = fixture.id === 'pantry_console' || fixture.id === 'pantry_plate' ? null : mesh(group, new THREE.CylinderGeometry(.7, .85, .22, 10), dark, 0, .13, 0);
    const focus = new THREE.Group(); focus.position.y = .35; group.add(focus);
    const bits = [];
    if (fixture.kind === 'item') {
      const carrier = mesh(focus, new THREE.OctahedronGeometry(.42, 0), glowMat, 0, .6, 0); carrier.rotation.z = .2;
      const cage = mesh(focus, new THREE.TorusGeometry(.57, .035, 6, 36), bronze, 0, .6, 0); cage.rotation.y = .6; bits.push(carrier, cage);
      base.scale.set(.72, 1, .72);
    } else if (fixture.kind === 'socket') {
      const shell = mesh(focus, new THREE.CylinderGeometry(.36, .52, .72, 8, 1, true), bronze, 0, .35, 0);
      const core = mesh(focus, new THREE.OctahedronGeometry(.27), glowMat, 0, .6, 0); core.visible = false; bits.push(core, shell);
      const clamp = mesh(focus, new THREE.TorusGeometry(.47, .04, 6, 32, Math.PI * 1.5), stone, 0, .6, 0); clamp.rotation.y = .5;
    } else if (fixture.kind === 'evidence') {
      const back = mesh(focus, box, bronze, 0, .48, 0); back.scale.set(.85, .95, .1); back.rotation.x = -.4;
      const page = mesh(focus, new THREE.PlaneGeometry(.69, .74), new THREE.MeshStandardMaterial({ color: 0xe4e6ce, emissive: color, emissiveIntensity: .12, roughness: .7 }), 0, .5, .075); page.rotation.x = -.4;
      line(focus, [-.22, .7, .18, .22, .7, .18, -.22, .53, .11, .1, .53, .11, -.22, .37, .05, .22, .37, .05], color, .7);
      bits.push(page);
    } else if (fixture.kind === 'console') {
      const plinth = mesh(focus, box, bronze, 0, fixture.id === 'pantry_console' ? .46 : .4, 0); plinth.scale.set(1.45, fixture.id === 'pantry_console' ? .62 : .75, .8); plinth.rotation.x = -.12;
      const panel = mesh(focus, box, dark, 0, .81, .05); panel.scale.set(1.3, .12, .73); panel.rotation.x = -.12;
      const rotor = mesh(focus, new THREE.TorusGeometry(.55, .055, 6, 36), glowMat, 0, 1.5, 0); rotor.rotation.y = .2;
      for (const x of [-.42, 0, .42]) mesh(focus, orb, glowMat, x, .9, .15).scale.setScalar(.6);
      const cursor = mesh(focus, new THREE.OctahedronGeometry(.13), gold, 0, 1.5, 0); bits.push(rotor, cursor);
    } else if (fixture.kind === 'attune') {
      for (const side of [-1, 1]) { const prong = mesh(focus, box, stone, side * .55, .8, 0); prong.scale.set(.13, 1.6, .16); }
      const core = mesh(focus, new THREE.IcosahedronGeometry(.43, 1), glass, 0, .8, 0);
      const lattice = mesh(focus, new THREE.IcosahedronGeometry(.44, 0), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .65 }), 0, .8, 0);
      const orbit = mesh(focus, new THREE.TorusGeometry(.68, .025, 6, 48), bronze, 0, .8, 0); orbit.rotation.y = .8; bits.push(lattice, orbit, core);
    } else {
      const staff = mesh(focus, new THREE.CylinderGeometry(.08, .12, 1.6, 8), bronze, 0, .8, 0);
      const emblem = mesh(focus, new THREE.OctahedronGeometry(.32), glowMat, 0, 1.55, 0); bits.push(emblem, staff);
      const banner = mesh(focus, new THREE.PlaneGeometry(.9, 1), new THREE.MeshStandardMaterial({ color: 0xbcd8cb, roughness: .9, side: THREE.DoubleSide }), .48, 1.1, 0); banner.rotation.y = -.3;
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color, transparent: true, opacity: .24, blending: THREE.AdditiveBlending, depthWrite: false })); glow.position.y = 1; glow.scale.set(2.3, 2.3, 1); group.add(glow);
    const animationDefs = fixture.machine?.triggers?.flatMap(t => t.effects?.animation ? [t.effects.animation] : []) || [];
    const view = { fixture, group, focus, bits, glow, glowMat, ringMat, circle, animations: animationDefs };
    fixtureViews.set(fixture.id, view);
    return view;
  }
  for (const fixture of FIXTURES) if (fixture.kind !== 'npc') createFixture(fixture);

  for (const person of PEOPLE) {
    const g = new THREE.Group(); g.name = person.id; g.position.set(person.x, groundHeightAt(person.x, person.z) ?? 0, person.z); root.add(g);
    const colors = { marin: 0xc9b487, vale: 0xbcd3ad, iona: 0x86bdc0, mara: 0xb6a8d0 };
    const look = {
      marin: { coat: 0x36545b, skin: 0xc19a72, hair: 0x34332d, width: .93, stance: .16 },
      vale: { coat: 0x49635f, skin: 0x9a6c4d, hair: 0x85867c, width: 1.1, stance: .15 },
      iona: { coat: 0xd6dccc, skin: 0xb17e56, hair: 0x302e29, width: 1, stance: .18 },
      mara: { coat: 0x354f56, skin: 0xc19c79, hair: 0x3d3c35, width: .94, stance: .12 },
    }[person.id];
    const robe = new THREE.MeshStandardMaterial({ color: look.coat, metalness: .3, roughness: .7 });
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: .85 });
    const hair = new THREE.MeshStandardMaterial({ color: look.hair, roughness: .95 });
    const part = (name, material, x, y, z, sx, sy, sz) => { const p = mesh(g, box, material, x, y, z); p.name = person.id + '_' + name; p.scale.set(sx, sy, sz); return p; };
    const coat = mesh(g, new THREE.CylinderGeometry(.27, .34, .78, 8), robe, 0, .94, 0); coat.name = person.id + '_coat'; coat.scale.set(look.width, 1, .8);
    const headGeometry = new THREE.SphereGeometry(.25, 14, 10);
    const head = mesh(g, headGeometry, skin, 0, 1.65, 0); head.name = person.id + '_face'; head.scale.set(.94, 1, .87);
    const collar = ring(g, .27, .035, bronze, 1.39);
    const cap = mesh(g, headGeometry, hair, 0, 1.82, .025); cap.name = person.id + '_hair'; cap.scale.set(1.02, .48, .88);
    for (const side of [-1, 1]) {
      mesh(g, orb, basalt, side * .078, 1.68, -.213).scale.set(.17, .2, .12);
      part('leg_' + side, dark, side * look.stance, .32, person.id === 'marin' ? side * .055 : 0, .15, .52, .19);
      part('boot_' + side, bronze, side * look.stance, .06, -.035, .2, .12, .32);
      const arm = mesh(g, cylinder, robe, side * .34 * look.width, .99, 0); arm.name = person.id + '_arm_' + side; arm.scale.set(1.6, .52, 1.6); arm.rotation.z = side * .12;
      const hand = mesh(g, orb, skin, side * .375 * look.width, .71, -.025); hand.name = person.id + '_hand_' + side; hand.scale.set(.6, .65, .5);
    }
    mesh(g, orb, skin, 0, 1.61, -.225).scale.set(.23, .3, .26);
    part('mouth', dark, 0, 1.535, -.214, .075, .012, .014);
    const shoulders = mesh(g, new THREE.SphereGeometry(.46, 12, 8), robe, 0, 1.24, 0); shoulders.scale.set(look.width, .35, .65);
    const satchel = mesh(g, box, bronze, .36, .78, .12); satchel.scale.set(.25, .34, .18);
    const staff = mesh(g, new THREE.CylinderGeometry(.028, .035, 1.45, 6), bronze, -.47, .75, 0);
    const emblem = mesh(g, new THREE.OctahedronGeometry(.11), mint, -.47, 1.55, 0);
    if (person.id === 'marin') {
      const scarf = ring(g, .285, .09, stone, 1.37); scarf.name = 'marin_scarf_wrap'; scarf.scale.z = .85;
      const tail = part('scarf_tail', stone, .15, 1.02, -.25, .23, .65, .045); tail.rotation.z = -.18;
      const strap = part('courier_strap', bronze, .09, 1.05, -.245, .075, .7, .025); strap.rotation.z = .5;
      part('satchel_flap', dark, .36, .88, .225, .27, .13, .035);
      const fringe = mesh(g, headGeometry, hair, .13, 1.79, -.09); fringe.name = 'marin_fringe'; fringe.scale.set(.65, .3, .5);
    }
    if (person.id === 'vale') {
      const shawl = mesh(g, new THREE.SphereGeometry(.46, 12, 8), stone, 0, 1.26, .025); shawl.name = 'vale_shawl'; shawl.scale.set(1.1, .4, .75);
      for (const side of [-1, 1]) { const fold = part('shawl_fold_' + side, stone, side * .16, 1.07, -.245, .18, .5, .055); fold.rotation.z = side * .4; }
      g.getObjectByName('vale_hand_1').position.set(.43, 1.03, -.05);
      const forearm = g.getObjectByName('vale_arm_1'); forearm.position.set(.43, 1.12, -.05); forearm.scale.y = .32; forearm.rotation.z = -.25;
      const lamp = lantern(g, .43, .78, -.05, 0xf4d69a); lamp.name = 'vale_caged_lantern'; lamp.scale.setScalar(.65);
      for (const y of [-.25, .25]) { const plate = mesh(lamp, box, bronze, 0, y, 0); plate.scale.set(.46, .045, .46); }
      for (const x of [-.18, .18]) for (const z of [-.18, .18]) { const bar = mesh(lamp, cylinder, bronze, x, 0, z); bar.scale.set(.3, .5, .3); }
      const handle = mesh(lamp, new THREE.TorusGeometry(.13, .02, 4, 16), bronze, 0, .38, 0); handle.name = 'vale_lantern_handle';
    }
    if (person.id === 'iona') {
      const tool = mesh(g, new THREE.TorusGeometry(.18, .045, 6, 20, Math.PI * 1.5), bronze, -.47, 1.55, 0); tool.name = 'iona_spanner'; tool.rotation.z = .7;
      part('engineer_apron', dark, 0, .91, -.25, .45, .6, .04);
      for (const side of [-1, 1]) { const lapel = part('high_collar_' + side, stone, side * .14, 1.38, -.12, .17, .22, .17); lapel.rotation.z = side * -.2; }
      const harness = part('tool_harness', bronze, .21, 1.06, -.29, .065, .62, .025); harness.rotation.z = .13;
    }
    if (person.id === 'mara') {
      for (const side of [-1, 1]) {
        const bob = mesh(g, headGeometry, hair, side * .2, 1.64, .07); bob.name = 'mara_bob_' + side; bob.scale.set(.35, .76, .6);
        const glasses = mesh(g, new THREE.TorusGeometry(.087, .009, 4, 16), bronze, side * .092, 1.68, -.231); glasses.name = 'mara_spectacles_' + side;
        const book = part('ledger_page_' + side, stone, side * .16, .99, -.35, .31, .44, .055); book.rotation.z = side * -.13;
      }
      part('spectacles_bridge', bronze, 0, 1.68, -.231, .035, .015, .015);
      part('ledger_spine', bronze, 0, .99, -.35, .035, .45, .075);
      part('silver_hair_streak', stone, -.18, 1.78, -.115, .025, .24, .025);
    }
    const foot = mesh(g, new THREE.RingGeometry(.41, .49, 32), new THREE.MeshBasicMaterial({ color: colors[person.id], transparent: true, opacity: .5 }), 0, .035, 0); foot.rotation.x = -Math.PI / 2;
    const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(person.name), transparent: true, depthWrite: false, opacity: .85 })); name.name = 'crew_name_' + person.id; name.scale.set(2.5, .4, 1); name.position.y = 2.2; g.add(name);
    const grip = person.id === 'iona' ? [-1, 1].map(side => { const arm = g.getObjectByName('iona_arm_' + side), hand = g.getObjectByName('iona_hand_' + side); return { side, arm, hand, position: arm.position.clone(), rotation: arm.rotation.clone(), handPosition: hand.position.clone() }; }) : null;
    personViews.set(person.id, { person, group: g, collar, emblem, staff, foot, name, grip, spanner: person.id === 'iona' ? g.getObjectByName('iona_spanner') : null, lastX: person.x, lastZ: person.z });
  }

  const moteCount = 310, motePositions = new Float32Array(moteCount * 3), moteSeeds = [];
  for (let i = 0; i < moteCount; i++) {
    const zone = ZONES[i % ZONES.length], a = rnd() * TAU, r = rnd() * (zone.radius + 5);
    moteSeeds.push({ x: zone.x + Math.sin(a) * r, y: .4 + rnd() * 9, z: zone.z + Math.cos(a) * r, phase: rnd() * TAU, speed: .12 + rnd() * .15 });
  }
  const moteGeometry = new THREE.BufferGeometry(); moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMaterial = new THREE.PointsMaterial({ color: 0xc5e7cc, size: .075, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false });
  root.add(new THREE.Points(moteGeometry, moteMaterial));
  const pulsePool = Array.from({ length: 6 }, () => { const m = ring(root, 1, .035, new THREE.MeshBasicMaterial({ color: PALETTE.mint, transparent: true, opacity: 0, depthWrite: false }), .1); m.visible = false; return { mesh: m, age: 2 }; });
  let nextPulse = 0;
  const point = new THREE.Vector3(), targetLight = new THREE.Vector3(), pale = new THREE.Color(PALETTE.ivory), warm = new THREE.Color(0xe4d5ad);

  function heightAt(x, z, run = {}) { return groundHeightAt(x, z, run.flags || []); }
  function insideServiceCounter(x, z) {
    return pantryServiceFootprints.some(p => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ);
  }
  function crossesServiceCounter(from, x, z) {
    const dx = x - from.x, dz = z - from.z;
    return pantryServiceFootprints.some(p => {
      let enter = 0, leave = 1;
      for (const [start, delta, low, high] of [[from.x, dx, p.minX, p.maxX], [from.z, dz, p.minZ, p.maxZ]]) {
        if (delta === 0) { if (start < low || start > high) return false; continue; }
        const a = (low - start) / delta, b = (high - start) / delta;
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
        if (enter > leave) return false;
      }
      return true;
    });
  }
  function blockedAt(x, z, run) {
    const from = run?.pos;
    // A save inside the new counter may leave it; ordinary outside movement cannot enter.
    if (!from) { if (insideServiceCounter(x, z)) return true; }
    else if (!insideServiceCounter(from.x, from.z) && crossesServiceCounter(from, x, z)) return true;
    let nextOverlap = 0;
    for (const p of blockers) {
      const depth = p.radius - Math.hypot(x - p.x, z - p.z);
      if (depth > 0) { if (!from) return true; nextOverlap += depth * depth; }
    }
    if (nextOverlap === 0) return false;
    // A restored save may overlap new masonry; permit only movement out of it.
    let currentOverlap = 0;
    for (const p of blockers) {
      const depth = p.radius - Math.hypot(from.x - p.x, from.z - p.z);
      if (depth > 0) currentOverlap += depth * depth;
    }
    return !(currentOverlap > 0 && nextOverlap < currentOverlap - 1e-9);
  }
  function pulse(position, color = PALETTE.mint) {
    const entry = pulsePool[nextPulse++ % pulsePool.length]; entry.age = 0; entry.mesh.position.set(position.x, (groundHeightAt(position.x, position.z) ?? 0) + .09, position.z); entry.mesh.material.color.set(color); entry.mesh.visible = true;
  }
  function getSpawn() { return { x: hub.x, z: hub.z + Math.min(7.5, hub.radius * .55) }; }
  function reset() { secondaryRoles[0] = secondaryRoles[1] = null; for (const p of pulsePool) { p.age = 2; p.mesh.visible = false; } if (returnLineRig) { returnLineRig.serial = null; returnLineRig.began = -Infinity; returnLineRig.pulseClosed = true; } if (windRig) windRig.initialized = false; }

  const motionLabels = {
    lift_raise: 'Dock passenger lift',
    span_rescue: 'Rescue cradle',
    index_drain: 'Archive waterline',
    index_raise: 'Archive shelves',
    crossing_first: 'First passenger cradle',
    crossing_return: 'Empty carrier return',
    crossing_second: 'Second passenger cradle',
  };
  function motionFocus(run, motionId) {
    const part = motionParts.find(part => part.stages.some(stage => stage.id === motionId));
    if (!part) return null;
    const stage = part.stages.find(stage => stage.id === motionId);
    if (!(run.motions || []).some(motion => motion.id === motionId) && !(run.flags || []).includes(stage.flag)) return null;
    part.object.getWorldPosition(point);
    return { target: { x: point.x, y: point.y, z: point.z }, label: motionLabels[motionId] };
  }

  function update(time, dt, run = {}, projection = {}) {
    seaUniforms.time.value = time; stars.rotation.y = time * .0008;
    const voice = (projection.machines || []).find(machine => machine.fixture === 'choir_voice_signal')?.chamber;
    voiceTable.group.visible = voiceStand.visible = !!voice && (run.flags || []).includes('voice_attuned');
    if (voiceTable.group.visible) { const key = JSON.stringify([voice.stage, voice.complete, voice.cells, voice.beams, voice.report]); if (key !== voiceTableKey) { voiceTableKey = key; voiceTable.update(voice); } voiceTable.animate(time); }
    const flags = new Set(run.flags || []), facts = new Set(run.facts || []), mission = typeof run.mission === 'number' ? run.mission : 0;
    const pantryReady = flags.has('heater_tested');
    if (pantryGlazing) pantryGlazing.emissiveIntensity = pantryReady ? THREE.MathUtils.damp(pantryGlazing.emissiveIntensity, .28, 3, Math.max(0, dt)) : 0;
    if (pantryFirebox) pantryFirebox.emissiveIntensity = pantryReady ? THREE.MathUtils.damp(pantryFirebox.emissiveIntensity, 1.4, 3, Math.max(0, dt)) : 0;
    if (pantryBoilerEmitter) pantryBoilerEmitter.material.emissiveIntensity = pantryReady ? THREE.MathUtils.damp(pantryBoilerEmitter.material.emissiveIntensity, 1, 3, Math.max(0, dt)) : 0;
    if (pantryGrowEmitter) pantryGrowEmitter.material.emissiveIntensity = pantryReady ? THREE.MathUtils.damp(pantryGrowEmitter.material.emissiveIntensity, 1, 3, Math.max(0, dt)) : 0;
    if (pantryLantern) { const color = pantryReady ? pantryWarm : pantryCold; pantryLantern.children[0].material.color.copy(color); pantryLantern.children[1].material.color.copy(color); pantryLantern.children[1].material.opacity = pantryReady ? .42 : .22; }
    const currentMission = projection.mission?.id;
    const projected = new Map((projection.fixtures || []).map(f => [f.id, f]));
    const pos = run.pos || getSpawn();
    shadowFocus.set(pos.x, 0, pos.z);
    const shadowTexel = 48 / 2048, shadowX = shadowFocus.dot(shadowRight), shadowY = shadowFocus.dot(shadowUp);
    shadowFocus.addScaledVector(shadowRight, Math.round(shadowX / shadowTexel) * shadowTexel - shadowX).addScaledVector(shadowUp, Math.round(shadowY / shadowTexel) * shadowTexel - shadowY);
    sun.target.position.copy(shadowFocus); sun.position.copy(shadowFocus).add(shadowOffset);
    const visibleZones = [...ZONES].sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z));
    const refugeDistance = Math.hypot(pos.x - hub.x, pos.z - hub.z);
    const guideMode = refugeDistance < hub.radius + 3;
    const guideFade = Math.max(0, Math.min(1, (hub.radius + 3 - refugeDistance) / 6));
    const districtFade = Math.max(0, Math.min(1, (refugeDistance - hub.radius - 3) / 6));
    const pantryDistance = Math.hypot(pos.x - pantryZone.x, pos.z - pantryZone.z);
    const localGain = Math.max(0, Math.min(1, (pantryZone.radius + 3 - pantryDistance) / 6));
    for (let i = 0; i < lightPool.length; i++) {
      if (i > 0) {
        const emitter = i === 1 ? pantryBoilerEmitter : pantryGrowEmitter, localRole = i === 1 ? 'boiler' : 'grow';
        let sourceVisible = !!emitter && emitter.material.visible; for (let parent = emitter; parent && sourceVisible; parent = parent.parent) sourceVisible = parent.visible;
        const sourcePowered = pantryReady && sourceVisible;
        const districtGain = sourcePowered ? Math.max(0, Math.min(1, (pantryDistance - pantryZone.radius - 3) / 6)) : 1;
        const desiredRole = guideMode ? 'refuge' : sourcePowered && localGain > 0 ? localRole : 'district';
        const light = lightPool[i], role = secondaryRoles[i - 1], changing = role !== null && role !== desiredRole, initial = role === null;
        if (changing) { light.intensity = role === localRole && !sourcePowered ? 0 : Math.max(0, light.intensity - 40 * Math.max(0, dt)); if (light.intensity > 0) continue; }
        secondaryRoles[i - 1] = desiredRole;
        let goal = 0;
        if (desiredRole === 'refuge') {
          const guide = refugeGuideLanterns[i - 1]; guide.getWorldPosition(targetLight); light.color.copy(guide.children[0].material.color); light.distance = 9;
          let visible = guide.children[0].visible && guide.children[0].material.visible; for (let parent = guide; parent && visible; parent = parent.parent) visible = parent.visible;
          goal = visible ? (16 + Math.sin(time * .7 + i) * .12) * guideFade : 0;
          if (!visible) light.intensity = 0;
        } else if (desiredRole === localRole) {
          emitter.getWorldPosition(targetLight); light.color.copy(emitter.material.emissive); light.distance = i === 1 ? 6 : 5.5;
          goal = (i === 1 ? 18 : 10) * localGain * Math.max(0, Math.min(1, emitter.material.emissiveIntensity));
        } else {
          const zone = visibleZones[i] || hub, refuge = zone.id === hub.id, awake = flags.has('refuge_lit');
          targetLight.set(zone.x, refuge ? 4.5 : 4, zone.z); light.color.set(refuge ? awake ? 0xffbc78 : 0x72c8d3 : zone.color || PALETTE.mint); light.distance = 28;
          goal = ((refuge ? awake ? 78 : 34 : 10) + Math.sin(time * .7 + i) * .7) * districtFade * districtGain;
        }
        if (initial || changing || desiredRole !== 'district') light.position.copy(targetLight);
        else light.position.lerp(targetLight, Math.min(1, Math.max(.05, dt * 2)));
        if (changing) { light.intensity = 0; continue; }
        light.intensity += (goal - light.intensity) * Math.min(1, Math.max(.05, dt * 3));
        continue;
      }
      lightPool[i].distance = 32;
      const zone = visibleZones[0] || hub;
      const refuge = zone.id === hub.id, gallery = zone.id === 'gallery', pantry = zone.id === 'pantry', awake = flags.has('refuge_lit');
      targetLight.set(zone.x, refuge ? 4.5 : gallery ? 5.2 : 6, zone.z - (gallery ? 4 : 0));
      if (pantry && pantryLantern) { pantryLantern.getWorldPosition(targetLight); lightPool[i].distance = 18; }
      lightPool[i].position.lerp(targetLight, Math.min(1, Math.max(.05, dt * 2)));
      if (pantry) lightPool[i].color.lerp(pantryReady ? pantryWarm : pantryCold, Math.min(1, Math.max(.05, dt * 3)));
      else lightPool[i].color.set(refuge ? awake ? 0xffbc78 : 0x72c8d3 : zone.color || PALETTE.mint);
      const intensity = refuge ? awake ? 180 : 34 : gallery ? 34 : pantry ? pantryReady ? 150 : 80 : 18;
      lightPool[i].intensity += (intensity + Math.sin(time * .7 + i) * .7 - lightPool[i].intensity) * Math.min(1, Math.max(.05, dt * 3));
    }
    for (const { zone, wake, floorMat, core, heart, sail, mechanics } of districtViews.values()) {
      const progress = Math.min(1, (run.phase === 'victory' ? 12 : mission) / 12);
      wake.material.opacity = .24 + (Math.sin(time * .9 + zone.x) + 1) * .07 + progress * .18;
      floorMat.color.set(zone.color || PALETTE.mint).lerp(pale, .84).lerp(warm, progress * .05);
      if (core) { core.rotation.y = time * .035; core.position.y = 8.2 + Math.sin(time * .5) * .11; core.scale.setScalar(1.3 + progress * .1); }
      if (heart) { const awake = flags.has('refuge_lit'); heart.material.color.set(awake ? 0xe8be76 : 0x9ad9db); heart.material.emissive.set(awake ? 0xc68136 : 0x397c8b); heart.material.emissiveIntensity = awake ? 1.1 : .35; }
      if (sail) { sail.visible = flags.has('sail_installed'); const p = sail.geometry.attributes.position, uv = sail.geometry.attributes.uv; for (let j = 0; j < p.count; j++) { const drop = 1 - uv.getY(j), across = uv.getX(j) === 0 || uv.getX(j) === 1 ? 0 : Math.cos((uv.getX(j) - .5) * Math.PI); p.setZ(j, across * ((.5 + .05 * Math.sin(time * 1.8)) * Math.sin(drop * Math.PI) + .03 * Math.sin(time * 1.8) * drop) * (1 + (run.strain || 0) / 100)); } p.needsUpdate = true; sail.geometry.computeVertexNormals(); }
      for (const mechanic of mechanics) mechanic.rotation.y = time * .09;
    }
    for (const rotor of rotors) rotor.object.rotation[rotor.axis] += dt * rotor.speed * (1 + (run.strain || 0) / 130);
    if (windRig) {
      for (const baffle of windRig.baffles) {
        const setting = run.settings?.[baffle.id] ?? Object.keys(baffle.poses)[0];
        const target = baffle.poses[setting];
        if (!windRig.initialized) baffle.vane.rotation.y = target;
        else baffle.vane.rotation.y += (target - baffle.vane.rotation.y) * Math.min(1, Math.max(0, dt) * 6);
        baffle.plate.material.map = baffle.maps[setting]; baffle.current = setting;
      }
      windRig.initialized = true;
      const settings = run.settings || {};
      const testing = (run.motions || []).some(motion => motion.id === 'wind_clear');
      const aligned = settings.wind_west === 'leeward' && settings.wind_east === 'spill' && settings.wind_center === 'pass';
      const settled = windRig.baffles.every(baffle => Math.abs(baffle.vane.rotation.y - baffle.poses[baffle.current]) < .015);
      windRig.sheltered.visible = flags.has('baffles_aligned') && aligned && settled && !testing;
      windRig.windUniforms.time.value = time; windRig.windUniforms.baffles.value.set(windRig.baffles[0].vane.rotation.y, windRig.baffles[1].vane.rotation.y, windRig.baffles[2].vane.rotation.y);
      windRig.windUniforms.sheltered.value = windRig.sheltered.visible ? 1 : 0; windRig.windUniforms.testing.value = testing ? 1 : 0;
      windRig.status.material.map = windRig.statusMaps[testing ? 'GUST TEST RUNNING' : windRig.sheltered.visible ? 'SHELTER TESTED' : flags.has('baffles_aligned') ? 'SETUP CHANGED' : 'ROUTE UNTESTED'];
    }
    const line = projection.returnLine;
    if (returnLineRig) {
      const rig = returnLineRig; rig.group.visible = !!line;
      if (line) {
        if (rig.serial === null) { rig.serial = line.measurementSerial; rig.pulseClosed = true; }
        else if (line.measurementSerial !== rig.serial) { rig.serial = line.measurementSerial; rig.began = performance.now(); rig.pulseClosed = false; }
        if (!line.currentFlow && line.revision !== line.measurementRevision) rig.pulseClosed = true;
        const elapsed = rig.pulseClosed ? Infinity : performance.now() - rig.began;
        rig.wheels.forEach((wheel, index) => { wheel.rotation.z += Math.max(0, dt) * returnLineMotion(line, index + 1, elapsed); });
        rig.pickups.forEach((pickup, index) => pickup.material.color.set(Number(line.settings.tap) === index + 1 ? PALETTE.gold : 0xb39868));
        rig.fitted.visible = !!line.fixture;
        if (line.fixture) { rig.fitted.position.set((line.fixture.site - 2) * 1.6, .48, .9); rig.insert.material = line.fixture.part === 'bushing' ? stone : enamel; }
        rig.outlets.forEach((outlet, index) => {
          const flowing = index === 0 ? !!line.currentFlow : line.currentFlow === 'full_clinic_return';
          outlet.stream.visible = flowing; outlet.closed.visible = !flowing;
        });
        rig.outletStatus.material.map = rig.outletStatusMaps[line.currentFlow === 'full_clinic_return' ? 2 : line.currentFlow ? 1 : 0];
        rig.pawl.rotation.z = line.currentFlow === 'essential_basin_only' ? 0 : -.3;
      }
    }
    if (clinicReturnCue) { clinicReturnCue.group.visible = !!line?.currentFlow; clinicReturnCue.stream.visible = !!line?.currentFlow; clinicReturnCue.loop.visible = line?.currentFlow === 'full_clinic_return'; }

    for (const { route, group } of bridgeViews) group.visible = !route.flag || flags.has(route.flag);
    for (const crate of dockFreight) crate.visible = !flags.has('freight_released');
    for (const part of motionParts) {
      let value = part.initial;
      const current = part.stages.find(stage => (run.motions || []).some(m => m.id === stage.id));
      if (current) {
        const motion = run.motions.find(m => m.id === current.id);
        const fraction = Math.max(0, Math.min(1, motion.elapsed / Math.max(.01, motion.seconds)));
        const smooth = fraction * fraction * (3 - 2 * fraction);
        value = THREE.MathUtils.lerp(current.from, current.to, smooth);
      } else {
        for (const stage of part.stages) if (flags.has(stage.flag)) value = stage.to;
      }
      part.object.position[part.axis] = value;
    }
    for (const passenger of passengerViews) {
      if (passenger.kind === 'dock') passenger.group.visible = !flags.has('passengers_safe');
      if (passenger.kind === 'refuge_dock') passenger.group.visible = flags.has('passengers_safe') && (!flags.has('transfer_complete') || run.epilogue === true);
      if (passenger.kind === 'refuge_span') passenger.group.visible = flags.has('span_rescued') && (!flags.has('transfer_complete') || run.epilogue === true);
      if (passenger.kind === 'span') passenger.group.visible = !flags.has('span_rescued');
      if (passenger.kind === 'first') passenger.group.visible = !flags.has('first_cradle_arrived');
      if (passenger.kind === 'second') passenger.group.visible = flags.has('second_cradle_sent') && !flags.has('transfer_complete');
      if (passenger.kind === 'landing') passenger.group.visible = flags.has('first_cradle_arrived');
      if (passenger.kind === 'landing_second') passenger.group.visible = flags.has('transfer_complete');
    }
    for (const [id, v] of fixtureViews) {
      const f = projected.get(id), definition = v.fixture;
      const item = definition.item && run.items?.[definition.item];
      const installed = !!f?.installed || item?.kind === 'installed' || item?.location?.kind === 'installed';
      const carried = !!f?.carried || item?.kind === 'carried' || item?.location?.kind === 'carried';
      const complete = !!f?.complete || !!definition.flag && flags.has(definition.flag) || !!definition.fact && facts.has(definition.fact) || installed;
      const active = f ? f.active !== false : !definition.missions?.length || definition.missions.includes(currentMission) || definition.missions.includes(mission);
      v.group.visible = (active || installed || complete) && !carried;
      if (definition.kind === 'item') {
        v.group.visible = !carried && !installed && active;
        const worldItem = item?.kind === 'world' ? item : item?.location?.kind === 'world' ? item.location : null;
        if (worldItem) v.group.position.set(worldItem.x ?? definition.x, 0, worldItem.z ?? definition.z);
        v.focus.position.y = .35 + Math.sin(time * 1.8 + definition.x) * .08;
      }
      v.group.position.y = groundHeightAt(v.group.position.x, v.group.position.z, run.flags || []) ?? 0;
      v.glowMat.color.set(complete ? 0xd8edb6 : (ZONES.find(z => z.id === definition.zone)?.color || PALETTE.mint));
      v.ringMat.color.copy(v.glowMat.color); v.ringMat.opacity = active && !complete ? .52 + Math.sin(time * 2) * .12 : .22;
      v.glow.material.opacity = active && !complete ? .2 : .07;
      if (definition.kind === 'socket' && v.bits[0]) v.bits[0].visible = installed || complete;
      if (definition.kind === 'console' || definition.kind === 'attune') v.bits[0].rotation.y = time * .5;
      if (definition.kind === 'report' && v.bits[0]) v.bits[0].rotation.y = time * .3;
      v.circle.scale.setScalar(active && !complete ? 1 + Math.sin(time * 1.5) * .04 : 1);
    }
    const mixture = projection.mixture || run.mixture || [1/3,1/3,1/3], weights = projection.mixWeights || run.mixWeights || [70,20,10];
    const totalWeight = weights.reduce((a,b) => a + Math.max(0, b), 0) || 1;
    for (const p of signalPrisms) {
      const present = !!(projection.spectra || run.spectra || {})[p.signal];
      p.material.color.set(present ? [0x9ee5db,0xf1ce91,0xb9acf1][p.index] : 0x526d6b);
      p.prism.rotation.y = time * .3 + p.index; p.prism.position.y = 1.1 + Math.sin(time * 1.2 + p.index) * .06;
      p.beam.visible = present; p.beam.material.opacity = .18 + Math.max(0, weights[p.index]) / totalWeight * .5;
    }
    const crown = districtViews.get('crown'); if (crown && mixture.length === 3) { crown.wake.material.color.setRGB(.62 * mixture[0] + .94 * mixture[1] + .73 * mixture[2], .9 * mixture[0] + .81 * mixture[1] + .67 * mixture[2], .86 * mixture[0] + .57 * mixture[1] + .95 * mixture[2]); }
    for (const [id, view] of personViews) {
      const state = (projection.people || []).find(p => p.id === id) || run.people?.[id] || view.person;
      const targetX = state.x ?? view.person.x, targetZ = state.z ?? view.person.z;
      view.group.position.x += (targetX - view.group.position.x) * Math.min(1, Math.max(.05, dt * 3));
      view.group.position.z += (targetZ - view.group.position.z) * Math.min(1, Math.max(.05, dt * 3));
      view.group.position.y = (groundHeightAt(view.group.position.x, view.group.position.z, run.flags || []) ?? 0) + Math.sin(time * 1.2 + view.person.x) * .035;
      point.set(pos.x - view.group.position.x, 0, pos.z - view.group.position.z);
      view.name.visible = point.lengthSq() < 36;
      if (point.lengthSq() < 49) view.group.rotation.y = Math.atan2(point.x, point.z) + Math.PI;
      const duty = state.duty || state.role;
      if (view.grip) { const holding = duty === 'holding_return_brace'; if (holding) { view.group.rotation.y = 0; view.group.position.y = 0; } for (const hand of view.grip) { if (holding) { hand.arm.position.set(hand.side * .24, 1.1, -.22); hand.arm.rotation.set(-Math.PI / 2, 0, 0); hand.hand.position.set(hand.side * .24, 1.1, -.51); } else { hand.arm.position.copy(hand.position); hand.arm.rotation.copy(hand.rotation); hand.hand.position.copy(hand.handPosition); } } view.staff.visible = view.emblem.visible = view.spanner.visible = !holding; }
      view.staff.rotation.z = duty === 'mechanic' ? .55 + Math.sin(time * 2) * .08 : (duty === 'holding_span' || duty === 'holding_return_brace') ? -.4 : Math.sin(time * .6) * .025;
      view.group.rotation.z = duty === 'mechanic' ? Math.sin(time * 1.1) * .025 : 0;
      view.emblem.rotation.y = time; view.collar.rotation.z = time * .1;
      view.foot.material.opacity = .3 + Math.sin(time * 1.5) * .08;
    }
    for (let i = 0; i < moteCount; i++) {
      const s = moteSeeds[i]; motePositions[i * 3] = s.x + Math.sin(time * s.speed + s.phase) * .75;
      motePositions[i * 3 + 1] = s.y + Math.sin(time * s.speed * .6 + s.phase) * .55;
      motePositions[i * 3 + 2] = s.z + Math.cos(time * s.speed * .8 + s.phase) * .3;
    }
    moteGeometry.attributes.position.needsUpdate = true;
    for (const p of pulsePool) {
      if (p.age >= 1.2) { p.mesh.visible = false; continue; }
      p.age += dt; const t = p.age / 1.2; p.mesh.scale.setScalar(.5 + t * 7); p.mesh.material.opacity = (1 - t) * .65;
    }
  }

  function updateRoofOcclusion(camera, avatar, dt) {
    if (avatar) avatar.updateWorldMatrix(true, false);
    for (const surface of avatarOccluders) {
      let obscured = false;
      if (avatar) {
        surface.updateWorldMatrix(true, false);
        const cutaway = surface.userData.cutawayBounds;
        if (cutaway) { roofBounds.copy(cutaway).applyMatrix4(surface.matrixWorld); roofInterior.copy(surface.userData.cutawayInterior).applyMatrix4(surface.matrixWorld); avatar.getWorldPosition(roofAvatarPosition); }
        for (const sample of avatarRoofSamples) {
          if (cutaway && !roofInterior.containsPoint(roofAvatarPosition)) break;
          roofTarget.copy(sample).applyMatrix4(avatar.matrixWorld); roofDirection.copy(roofTarget).sub(camera.position);
          const distance = roofDirection.length(); if (distance <= .05) continue;
          roofRay.set(camera.position, roofDirection.multiplyScalar(1 / distance)); roofRay.far = distance - .05; roofHits.length = 0;
          if (cutaway) {
            if (roofRay.ray.intersectBox(roofBounds, roofIntersection) && camera.position.distanceTo(roofIntersection) < distance - .05) { obscured = true; break; }
          } else {
            surface.raycast(roofRay, roofHits);
            if (!roofHits.length) for (const linked of surface.userData.linkedOccluders || []) { linked.updateWorldMatrix(true, false); linked.raycast(roofRay, roofHits); if (roofHits.length) break; }
            if (roofHits.length) { obscured = true; break; }
          }
        }
      }
      const material = surface.material, restOpacity = surface.userData.restOpacity ?? 1, target = obscured ? Math.min(.12, restOpacity * .25) : restOpacity;
      material.opacity = THREE.MathUtils.damp(material.opacity, target, obscured ? 24 : 8, Math.max(0, dt));
      if (!obscured && material.opacity > restOpacity - .005) material.opacity = restOpacity;
      const fading = material.opacity < 1;
      if (material.transparent !== fading) { material.transparent = fading; material.needsUpdate = true; }
      material.depthWrite = !fading; material.forceSinglePass = fading;
    }
  }

  return { update, updateRoofOcclusion, heightAt, blockedAt, pulse, getSpawn, reset, motionFocus, voiceTable };
}
