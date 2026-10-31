import * as THREE from './vendor/three.module.js';

const BANDS = ['BRIDGE', 'SHELTER', 'SURGE'];
const COLORS = { BRIDGE: 0xf0bd66, SHELTER: 0x57cde3, SURGE: 0xf08073 };
const TURN_NOTE = 'Turns follow the incoming ray: 0 straight · 1 right · 2 back · 3 left. PRISM adds Bridge left (−1), Shelter straight (0), Surge right (+1). Click changes BASE; highlight a band for its net turn. Br / Sh / Su mark checkpoints. Dry traces are safe. Lines show routes; readouts show flux.';
const PRISM_OFFSETS = { BRIDGE: -1, SHELTER: 0, SURGE: 1 };
const TURN_PATHS = [
  'M12 25V4M8 9L12 4L16 9',
  'M6 25V16Q6 10 12 10H25M20 6L25 10L20 14',
  'M6 25V11Q6 4 13 4Q21 4 21 11V24M17 19L21 24L25 19',
  'M25 25V16Q25 10 19 10H5M10 6L5 10L10 14',
];
const turnGlyph = turn => `<svg viewBox="0 0 30 30" aria-hidden="true"><path d="${TURN_PATHS[turn]}"/><circle cx="${turn === 0 ? 12 : turn === 3 ? 25 : 6}" cy="25" r="1.9"/></svg>`;
const TURNS = ['Straight', 'Right', 'Back', 'Left'];
const cellName = index => String.fromCharCode(65 + Math.floor(index / 3)) + (index % 3 + 1);
const point = (value, y = .48) => new THREE.Vector3((value.x - 1) * 1.48, y, (value.z - 1) * 1.48);
const percent = value => Number.isFinite(value) ? (value * 100).toFixed(value < .01 && value > 0 ? 2 : 1) + '%' : '—';
const portName = port => port ? `${port.edge}${port.index + 1}` : '';
const bandGlyph = band => ({ BRIDGE: 'Br', SHELTER: 'Sh', SURGE: 'Su' })[band];

export function createChamberRig({ nameplates = false } = {}) {
  const group = new THREE.Group(), rotors = [], beams = [], portGroup = new THREE.Group(), markerGroup = new THREE.Group();
  const materials = new Set(), geometries = new Set(), textures = new Set();
  const material = options => { const value = new THREE.MeshStandardMaterial(options); materials.add(value); return value; };
  const unlit = options => { const value = new THREE.MeshBasicMaterial({ ...options, toneMapped: false }); materials.add(value); return value; };
  const geometry = value => { geometries.add(value); return value; };
  const bronze = material({ color: 0xc9a166, roughness: .28, metalness: .72 });
  const dark = material({ color: 0x102b36, roughness: .38, metalness: .5 });
  const glass = material({ color: 0x79d5c4, roughness: .19, metalness: .18, transparent: true, opacity: .88, depthWrite: false, flatShading: true });
  const mirror = material({ color: 0xc7e6db, roughness: .14, metalness: .54, emissive: 0x39594f, emissiveIntensity: .16 });
  const rim = material({ color: 0x84a793, emissive: 0x304d46, emissiveIntensity: .24, roughness: .5, metalness: .5 });
  const plateShape = geometry(new THREE.BoxGeometry(5.5, .16, 5.5));
  const plate = new THREE.Mesh(plateShape, dark); plate.position.y = -.12; plate.castShadow = true; plate.receiveShadow = true; group.add(plate);
  const casework = new THREE.Mesh(geometry(new THREE.BoxGeometry(5.36, .24, 5.36)), bronze); casework.position.y = -.31; group.add(casework);
  const undercase = new THREE.Mesh(geometry(new THREE.BoxGeometry(5.42, .08, 5.42)), dark); undercase.position.y = -.44; group.add(undercase);
  const edgeShape = geometry(new THREE.BoxGeometry(5.56, .035, .035));
  for (let side = 0; side < 4; side++) {
    const edge = new THREE.Mesh(edgeShape, bronze); edge.rotation.y = side * Math.PI / 2;
    edge.position.set(side % 2 ? (side === 1 ? 2.76 : -2.76) : 0, -.01, side % 2 ? 0 : side === 0 ? 2.76 : -2.76); group.add(edge);
  }
  const gridLine = geometry(new THREE.BoxGeometry(4.95, .012, .014));
  for (const offset of [-.74, .74]) {
    const a = new THREE.Mesh(gridLine, rim); a.position.set(0, .005, offset); group.add(a);
    const b = new THREE.Mesh(gridLine, rim); b.rotation.y = Math.PI / 2; b.position.set(offset, .005, 0); group.add(b);
  }
  const baseShape = geometry(new THREE.CylinderGeometry(.57, .6, .12, 32));
  const ringShape = geometry(new THREE.TorusGeometry(.46, .025, 6, 32));
  const roundShape = geometry(new THREE.BoxGeometry(.68, .4, .1)), mirrorFace = geometry(new THREE.BoxGeometry(.55, .27, .012)), mirrorSlot = geometry(new THREE.BoxGeometry(.025, .27, .018));
  const prismShape = geometry(new THREE.CylinderGeometry(.22, .48, .48, 3));
  const nameplateShape = nameplates ? geometry(new THREE.PlaneGeometry(1.1, .32)) : null;
  const graduations = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(.014, .012, .055)), bronze, 9 * 12), graduationPose = new THREE.Object3D();
  for (let cell = 0; cell < 9; cell++) for (let tick = 0; tick < 12; tick++) {
    const a = tick / 12 * Math.PI * 2;
    graduationPose.position.set((cell % 3 - 1) * 1.48 + Math.sin(a) * .55, .174, (Math.floor(cell / 3) - 1) * 1.48 + Math.cos(a) * .55); graduationPose.rotation.y = a; graduationPose.updateMatrix(); graduations.setMatrixAt(cell * 12 + tick, graduationPose.matrix);
  }
  group.add(graduations);
  if (nameplates) {
    const stands = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(.025, .75, .025)), bronze, 18), pose = new THREE.Object3D();
    for (let cell = 0; cell < 9; cell++) for (let side = 0; side < 2; side++) { pose.position.set((cell % 3 - 1) * 1.48 + (side ? .48 : -.48), .385, (Math.floor(cell / 3) - 1) * 1.48 + .57); pose.updateMatrix(); stands.setMatrixAt(cell * 2 + side, pose.matrix); }
    group.add(stands);
  }
  for (let index = 0; index < 9; index++) {
    const cell = new THREE.Group(); cell.name = 'chamber_cell_' + index; cell.userData.cellIndex = index; cell.position.copy(point({ x: index % 3, z: Math.floor(index / 3) }, .1));
    const base = new THREE.Mesh(baseShape, dark); cell.add(base);
    const ring = new THREE.Mesh(ringShape, bronze); ring.rotation.x = Math.PI / 2; ring.position.y = .09; cell.add(ring);
    const rotor = new THREE.Group(); rotor.position.y = .19; cell.add(rotor);
    const round = new THREE.Group(), prism = new THREE.Mesh(prismShape, glass); prism.position.y = .15;
    const mirrorFrame = new THREE.Mesh(roundShape, bronze); mirrorFrame.position.y = .22; round.add(mirrorFrame);
    for (const sign of [-1, 1]) { const face = new THREE.Mesh(mirrorFace, mirror); face.position.set(0, .25, sign * .057); round.add(face); const slot = new THREE.Mesh(mirrorSlot, dark); slot.position.set(0, .25, sign * .066); round.add(slot); }
    rotor.add(round, prism);
    const baseIndex = new THREE.Mesh(geometry(new THREE.BoxGeometry(.09, .035, .22)), bronze); baseIndex.name = 'chamber_base_index_' + index; baseIndex.position.set(.19, .11, -.46); rotor.add(baseIndex);
    let plate = null, canvas = null, texture = null;
    if (nameplates) { canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64; texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture); plate = new THREE.Mesh(nameplateShape, unlit({ map: texture, depthTest: true, depthWrite: true })); plate.name = 'chamber_nameplate_' + index; plate.rotation.x = -Math.PI / 2; plate.position.set(0, .66, .57); cell.add(plate); }
    rotors.push({ cell, rotor, round, prism, plate, canvas, texture, labelKey: '', target: 0 }); group.add(cell);
  }
  const beamShape = geometry(new THREE.CylinderGeometry(1, 1, 1, 6));
  const arrowShape = geometry(new THREE.ConeGeometry(.065, .18, 3));
  const beamMaterials = Object.fromEntries(BANDS.map(band => [band, [
    unlit({ color: COLORS[band], transparent: true, opacity: .95, depthWrite: false }),
    unlit({ color: COLORS[band], transparent: true, opacity: .36, depthWrite: false, blending: THREE.AdditiveBlending }),
  ]]));
  for (let index = 0; index < 111; index++) {
    const coreMaterial = beamMaterials.BRIDGE[0].clone(), haloMaterial = beamMaterials.BRIDGE[1].clone(); materials.add(coreMaterial); materials.add(haloMaterial);
    const core = new THREE.Mesh(beamShape, coreMaterial), halo = new THREE.Mesh(beamShape, haloMaterial);
    const arrow = new THREE.Mesh(arrowShape, coreMaterial); arrow.name = 'chamber_trace_arrow_' + index;
    core.name = 'chamber_trace_core_' + index; halo.name = 'chamber_trace_halo_' + index; core.visible = halo.visible = arrow.visible = false; group.add(core, halo, arrow); beams.push({ core, halo, arrow });
  }
  const portRing = geometry(new THREE.TorusGeometry(.13, .025, 6, 20));
  const portStem = geometry(new THREE.CylinderGeometry(.05, .05, .4, 8));
  const warningShape = geometry(new THREE.BoxGeometry(.3, .035, .045));
  const warning = material({ color: 0xf3a28d, emissive: 0xd46d66, emissiveIntensity: 1, roughness: .7 });
  const portMaterials = Object.fromEntries(BANDS.map(band => [band, unlit({ color: COLORS[band] })]));
  const sourceMaterial = material({ color: 0xe3ead1, emissive: 0xc6dec6, emissiveIntensity: .8, roughness: .35 });
  group.add(portGroup, markerGroup);
  const up = new THREE.Vector3(0, 1, 0);
  let focusedBand = null;
  function setBandFocus(band = null) {
    focusedBand = BANDS.includes(band) ? band : null;
    for (const entry of beams) { entry.arrow.visible = entry.core.visible && entry.band === focusedBand; entry.arrow.scale.setScalar(1); if (entry.from && entry.to) entry.arrow.position.copy(entry.from).lerp(entry.to, .5); if (entry.core.visible) { const dimmed = focusedBand && entry.band !== focusedBand; entry.core.material.opacity = dimmed ? .075 : .97; entry.halo.material.opacity = dimmed ? 0 : .36; } }
  }
  function setTraceCursor(segment = null, fraction = 0) {
    const ordered = beams.filter(entry => entry.core.visible && entry.band === focusedBand);
    for (const entry of beams) { entry.arrow.visible = segment === null && entry.core.visible && entry.band === focusedBand; entry.arrow.scale.setScalar(1); if (entry.from && entry.to) entry.arrow.position.copy(entry.from).lerp(entry.to, .5); }
    const entry = Number.isInteger(segment) ? ordered[segment] : null;
    if (entry) { entry.arrow.visible = true; entry.arrow.scale.setScalar(2.2); entry.arrow.position.copy(entry.from).lerp(entry.to, Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0); }
  }
  function clearChildren(parent) { while (parent.children.length) parent.remove(parent.children[0]); }
  function addPort(port, mat, fragile = false) {
    const at = point(port, .34), ring = new THREE.Mesh(portRing, mat); ring.rotation.x = Math.PI / 2; ring.position.copy(at); portGroup.add(ring);
    const stem = new THREE.Mesh(portStem, mat); stem.position.copy(at).add(new THREE.Vector3(0, -.18, 0)); portGroup.add(stem);
    if (fragile) for (const sign of [-1, 1]) { const cross = new THREE.Mesh(warningShape, warning); cross.rotation.y = sign * Math.PI / 4; cross.position.copy(at).add(new THREE.Vector3(0, .07, 0)); portGroup.add(cross); }
  }
  function update(view) {
    for (const cell of view.cells || []) {
      const part = rotors[cell.index]; if (!part) continue;
      part.target = -cell.orientation * Math.PI / 2; part.prism.visible = cell.kind === 'prism'; part.round.visible = cell.kind !== 'prism';
      if (part.plate) { const key = [cell.label, cell.kind, cell.checkpoints.join('/')].join(':'); if (part.labelKey !== key) { part.labelKey = key; const ctx = part.canvas.getContext('2d'); ctx.clearRect(0, 0, 256, 64); ctx.fillStyle = '#18353d'; ctx.fillRect(0, 0, 256, 64); ctx.strokeStyle = '#b89a65'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, 252, 60); ctx.fillStyle = '#e5e0c9'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = 'bold 34px sans-serif'; ctx.fillText(cell.label + '  ' + cell.kind.toUpperCase(), 128, cell.checkpoints.length ? 29 : 43, 244); if (cell.checkpoints.length) { ctx.beginPath(); ctx.moveTo(8, 35); ctx.lineTo(248, 35); ctx.stroke(); ctx.font = '25px sans-serif'; ctx.fillText('VIA ' + cell.checkpoints.map(bandGlyph).join(' / '), 128, 59, 244); } part.texture.needsUpdate = true; } }
    }
    beams.forEach(beam => { beam.core.visible = beam.halo.visible = beam.arrow.visible = false; });
    (view.beams || []).filter(beam => beam.value > 0 && BANDS.includes(beam.band)).slice(0, beams.length).forEach((beam, index) => {
      const bandIndex = BANDS.indexOf(beam.band), a = point(beam.from, .6 + bandIndex * .035), b = point(beam.to, .6 + bandIndex * .035);
      const delta = b.clone().sub(a), length = delta.length(); if (!Number.isFinite(length) || length < .001) return;
      const offset = new THREE.Vector3(-delta.z, 0, delta.x).normalize().multiplyScalar((bandIndex - 1) * .065); a.add(offset); b.add(offset);
      const width = .008 + Math.sqrt(Math.max(0, Math.min(1, beam.value))) * .005;
      const entry = beams[index]; entry.band = beam.band; entry.from = a; entry.to = b;
      for (const [mesh, radius, halo] of [[entry.core, width, false], [entry.halo, .038, true]]) {
        mesh.material.color.setHex(COLORS[beam.band]); if (!halo) mesh.material.color.lerp(new THREE.Color(0xfff7df), .18); mesh.material.opacity = focusedBand && beam.band !== focusedBand ? (halo ? 0 : .075) : halo ? .36 : .97;
        mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(up, delta.normalize()); mesh.scale.set(radius, length, radius); mesh.visible = true;
      }
      entry.arrow.position.copy(a).lerp(b, .5); entry.arrow.quaternion.copy(entry.core.quaternion); entry.arrow.visible = focusedBand === beam.band;
    });
    clearChildren(portGroup); clearChildren(markerGroup);
    if (view.sourcePort) addPort(view.sourcePort, sourceMaterial);
    for (const sink of view.sinks || []) if (sink.port) addPort(sink.port, portMaterials[sink.band] || sourceMaterial);
    for (const port of view.fragilePorts || []) addPort(port, warning, true);
    for (const leak of view.report?.leaks || []) if (leak.port && leak.value > 0) {
      const at = point(leak.port, .67); for (const sign of [-1, 1]) { const cross = new THREE.Mesh(warningShape, leak.value > .025 ? warning : bronze); cross.rotation.y = sign * Math.PI / 4; cross.position.copy(at); markerGroup.add(cross); }
    }
    group.userData.beamCount = beams.filter(b => b.core.visible).length;
  }
  let previousTime = null;
  function animate(time) {
    const dt = previousTime === null ? 1 / 60 : Math.max(0, Math.min(.1, time - previousTime)); previousTime = time;
    for (const part of rotors) {
      const difference = Math.atan2(Math.sin(part.target - part.rotor.rotation.y), Math.cos(part.target - part.rotor.rotation.y));
      part.rotor.rotation.y += difference * (1 - Math.exp(-dt * 13));
    }
  }
  function dispose() { geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); group.clear(); }
  return { group, cells: rotors.map(part => part.cell), update, animate, dispose, setBandFocus, setTraceCursor };
}

export function createChamberDisplay(container, { onRotate = () => {}, summaryContainer = null } = {}) {
  const wrapper = document.createElement('section'); wrapper.className = 'chamber-instrument';
  const frame = document.createElement('div'); frame.className = 'chamber-instrument-frame';
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'Three-dimensional dry trace of the neural routing instrument'); canvas.setAttribute('role', 'img');
  const tag = document.createElement('div'); tag.className = 'chamber-instrument-tag';
  const phase = document.createElement('span'), status = document.createElement('b'); tag.append(phase, status);
  const labels = document.createElement('div'); labels.className = 'chamber-port-labels'; labels.setAttribute('aria-hidden', 'true');
  frame.append(canvas, labels); wrapper.append(tag, frame);
  const controls = document.createElement('div'); controls.className = 'chamber-rotor-grid chamber-rotor-overlay'; controls.setAttribute('aria-label', 'Routing rotors');
  const buttons = Array.from({ length: 9 }, (_, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.rotor = String(index);
    const name = document.createElement('b'), turn = document.createElement('span'), glyph = document.createElement('span'), checkpoints = document.createElement('span'), kind = document.createElement('span'), effective = document.createElement('span'); name.textContent = cellName(index);
    turn.className = 'chamber-turn-name'; glyph.className = 'chamber-turn-glyph'; glyph.setAttribute('aria-hidden', 'true'); checkpoints.className = 'chamber-checkpoint-badges';
    kind.className = 'chamber-cell-kind'; effective.className = 'chamber-effective-turn'; effective.hidden = true;
    button.append(name, kind, glyph, turn, checkpoints, effective); button.onclick = () => onRotate(index); controls.append(button); return { button, turn, glyph, checkpoints, kind, effective };
  });
  frame.append(controls);
  const legend = document.createElement('div'); legend.className = 'chamber-flux-legend'; legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', 'Highlight routes; percentages are the normalized source mixture');
  let selectedBand = null, layoutKey = '';
  const allBands = document.createElement('button'); allBands.type = 'button'; allBands.textContent = 'Show all'; allBands.setAttribute('aria-label', 'Show all signal routes'); allBands.setAttribute('aria-pressed', 'true'); legend.append(allBands);
  const bandButtons = [];
  const channels = BANDS.map(band => { const item = document.createElement('button'); item.type = 'button'; item.dataset.band = band; item.setAttribute('aria-label', 'Highlight ' + band.toLowerCase() + ' route'); item.setAttribute('aria-pressed', 'false'); const label = document.createElement('b'), value = document.createElement('span'); label.textContent = band; item.append(label, value); legend.append(item); bandButtons.push(item); return value; });
  function highlightBand(band = null) { selectedBand = band; allBands.setAttribute('aria-pressed', String(band === null)); bandButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(BANDS[index] === band))); rig?.setBandFocus(band); refreshRotorCommands(); }
  allBands.onclick = () => highlightBand(); bandButtons.forEach((button, index) => { button.onclick = () => highlightBand(BANDS[index]); });
  const readings = document.createElement('div'); readings.className = 'chamber-readings'; readings.setAttribute('aria-live', 'polite'); readings.setAttribute('aria-label', 'Dry-trace receiver predictions');
  const traceCaption = document.createElement('p'); traceCaption.className = 'chamber-trace-caption'; traceCaption.textContent = 'DRY TRACE · SAFE PREVIEW';
  const goals = document.createElement('div'); goals.className = 'chamber-goals'; goals.setAttribute('aria-label', 'Routing constraints');
  const note = document.createElement('p'); note.className = 'chamber-instrument-note'; note.textContent = TURN_NOTE;
  const summary = document.createElement('div'); summary.className = 'chamber-instrument-summary';
  summary.append(legend, traceCaption, readings, goals); (summaryContainer || wrapper).append(summary); wrapper.append(note); container.append(wrapper);
  let renderer = null, rig = null, scene = null, camera = null, lastKey = '', currentView = null, dimensions = [0, 0], disposed = false;
  const portLabels = [];
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-4, 4, 2.55, -2.55, .1, 30); camera.position.set(0, 8, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    scene.add(new THREE.HemisphereLight(0xdcead5, 0x102939, 2.8));
    const key = new THREE.DirectionalLight(0xffe4b0, 3); key.position.set(-3, 6, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0x77bed5, 2); fill.position.set(4, 3, -4); scene.add(fill);
    rig = createChamberRig(); scene.add(rig.group);
  } catch {
    rig?.dispose(); renderer?.dispose(); renderer = rig = scene = camera = null;
    frame.classList.add('chamber-diagram-unavailable'); canvas.hidden = true; canvas.style.display = 'none'; controls.className = 'chamber-rotor-grid chamber-rotor-fallback'; wrapper.append(controls);
    const fallback = document.createElement('p'); fallback.textContent = '3D instrument unavailable. Rotor controls and measured readouts remain available.'; frame.append(fallback);
  }
  function resize() {
    if (!renderer || disposed) return;
    const width = Math.round(frame.clientWidth), height = Math.round(frame.clientHeight); if (width < 1 || height < 1) return;
    if (width === dimensions[0] && height === dimensions[1]) return;
    dimensions = [width, height]; renderer.setSize(width, height, false);
    const halfHeight = Math.max(2.7, 3.1 * height / width), halfWidth = halfHeight * width / height; camera.left = -halfWidth; camera.right = halfWidth; camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
  }
  function placeLabels() {
    if (!camera || dimensions[0] < 1) return;
    for (const [index, item] of buttons.entries()) { const p = point({ x: index % 3, z: Math.floor(index / 3) }, .46).project(camera); item.button.style.left = `${(p.x * .5 + .5) * dimensions[0]}px`; item.button.style.top = `${(-p.y * .5 + .5) * dimensions[1]}px`; }
    for (const item of portLabels) {
      const p = point(item.port, .5).project(camera), halfWidth = item.element.offsetWidth / 2, halfHeight = item.element.offsetHeight / 2;
      const x = (p.x * .5 + .5) * dimensions[0], y = (-p.y * .5 + .5) * dimensions[1] + (item.port.edge === 'N' ? -10 : 15);
      item.element.style.left = `${Math.max(halfWidth + 6, Math.min(dimensions[0] - halfWidth - 6, x))}px`;
      item.element.style.top = `${Math.max(halfHeight + 6, Math.min(dimensions[1] - halfHeight - 6, y))}px`;
    }
  }
  function refreshRotorCommands() {
    for (const cell of currentView?.cells || []) {
      const item = buttons[cell.index], prism = cell.kind === 'prism';
      const effective = prism && selectedBand ? (cell.orientation + PRISM_OFFSETS[selectedBand] + 4) % 4 : cell.orientation;
      item.kind.textContent = prism ? 'PRISM' : ''; item.kind.hidden = !prism;
      item.turn.textContent = prism ? 'BASE ' + cell.orientation : cell.orientation + ' ' + (cell.orientation === 0 ? 'KEEP' : TURNS[cell.orientation].toUpperCase());
      item.glyph.innerHTML = turnGlyph(effective); item.glyph.dataset.band = selectedBand || '';
      item.effective.hidden = !(prism && selectedBand); item.effective.dataset.band = selectedBand || '';
      item.effective.textContent = prism && selectedBand ? `${bandGlyph(selectedBand)} ${effective} ${TURNS[effective].toUpperCase()}` : '';
      const net = prism && selectedBand ? ` ${selectedBand.toLowerCase()} effective turn ${effective}: ${TURNS[effective].toLowerCase()}.` : '';
      item.button.setAttribute('aria-label', `Rotate ${cellName(cell.index)} clockwise. ${prism ? 'Prism' : 'Rotator'}, base setting ${cell.orientation}: ${TURNS[cell.orientation].toLowerCase()}.${net}${cell.checkpoints?.length ? ' Required checkpoint for ' + cell.checkpoints.join(', ') + '.' : ''}`);
      item.button.title = `${cellName(cell.index)} · ${prism ? 'PRISM' : 'rotator'} · click changes base setting ${cell.orientation}.${net}`;
    }
  }
  function update(view) {
    if (disposed || !view) return; currentView = view;
    const nextLayout = [view.site, view.stage, view.complete].join(':'); if (nextLayout !== layoutKey) { layoutKey = nextLayout; highlightBand(); }
    const key = JSON.stringify([view.site, view.stage, view.index, view.complete, view.cells, view.beams, view.sourcePort, view.sinks, view.fragilePorts, view.report, view.disabled]);
    if (key === lastKey) return; lastKey = key;
    phase.textContent = `CHAMBER ${Math.min(view.total || 3, (view.index || 0) + 1)} / ${view.total || 3}`;
    const state = view.complete ? 'complete' : view.report?.pass ? 'ready' : view.report?.powered ? 'routing' : 'unpowered';
    wrapper.dataset.state = state; traceCaption.textContent = view.complete ? 'COMMITTED ROUTE · FINAL READOUT' : 'DRY TRACE · SAFE PREVIEW'; status.textContent = state === 'complete' ? 'ROUTE COMMITTED' : state === 'ready' ? 'DRY TRACE · READY' : state === 'unpowered' ? 'DRY TRACE · NO SOURCE' : 'DRY TRACE · PREVIEW';
    for (const cell of view.cells || []) {
      const item = buttons[cell.index]; if (!item) continue;
      item.button.disabled = !!view.complete || !!view.disabled;
      item.checkpoints.replaceChildren();
      for (const band of cell.checkpoints || []) { const badge = document.createElement('b'); badge.dataset.band = band; badge.textContent = bandGlyph(band); item.checkpoints.append(badge); }
      item.button.dataset.kind = cell.kind;
    }
    refreshRotorCommands();
    note.textContent = view.complete ? 'Sealed. PRISM adds Bridge left, Shelter straight and Surge right to BASE. Highlight a band for its net turn and directional trace.' : TURN_NOTE;
    BANDS.forEach((band, index) => channels[index].textContent = percent(view.report?.source?.[band]));
    readings.replaceChildren();
    for (const sink of view.report?.sinks || []) {
      const row = document.createElement('div'); row.className = 'chamber-reading' + (sink.pass ? ' is-good' : '');
      const name = document.createElement('span'), value = document.createElement('b'); name.textContent = `${sink.pass ? '✓' : '○'} ${sink.label}`; value.textContent = percent(sink.received); row.append(name, value); readings.append(row);
    }
    for (const fragile of view.report?.fragile || []) {
      const row = document.createElement('div'); row.className = 'chamber-reading is-reserve' + (fragile.pass ? ' is-good' : ' is-danger');
      const name = document.createElement('span'), value = document.createElement('b'); name.textContent = `${fragile.pass ? '✓' : '!'} ${fragile.label}`; value.textContent = `${percent(fragile.received)} / ≤${percent(fragile.max)}`; row.append(name, value); readings.append(row);
    }
    goals.replaceChildren();
    for (const goal of view.report?.goals || view.goals || []) { const row = document.createElement('div'); row.className = 'chamber-goal' + (goal.pass ? ' is-good' : ''); const mark = document.createElement('span'), text = document.createElement('span'); mark.textContent = goal.pass ? '✓' : '○'; text.textContent = goal.text; row.append(mark, text); goals.append(row); }
    labels.replaceChildren(); portLabels.length = 0;
    const addLabel = (port, text, band) => {
      if (!port) return; const existing = portLabels.find(item => item.port.x === port.x && item.port.z === port.z);
      if (existing) { existing.element.textContent += ' / ' + text; delete existing.element.dataset.band; return; }
      const label = document.createElement('span'); label.textContent = text; if (band) label.dataset.band = band; labels.append(label); portLabels.push({ port, element: label });
    };
    addLabel(view.sourcePort, 'IN');
    for (const sink of view.sinks || []) addLabel(sink.port, `${bandGlyph(sink.band)} · ${portName(sink.port)}`, sink.band);
    for (const port of view.fragilePorts || []) addLabel(port, '! · ' + portName(port));
    rig?.update(view); rig?.setBandFocus(selectedBand); resize(); placeLabels();
    canvas.setAttribute('aria-label', `${view.title || 'Neural routing instrument'}. ${view.complete ? 'All three phases are committed.' : 'Safe dry-trace preview; Commit energizes the route. ' + (view.report?.diagnosis || '')}`);
  }
  function render(time = 0) {
    if (!renderer || disposed || !currentView || frame.getClientRects().length === 0) return;
    resize(); rig.animate(time); renderer.render(scene, camera); placeLabels();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; observer?.observe(frame);
  function destroy() { if (disposed) return; disposed = true; observer?.disconnect(); rig?.dispose(); renderer?.dispose(); renderer?.forceContextLoss(); summary.remove(); wrapper.remove(); }
  return { update, render, resize, destroy };
}

export { turnGlyph };
