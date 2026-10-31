import * as THREE from './vendor/three.module.js';
import * as Campaign from './campaign.js';
import { ZONES, PEOPLE, FIXTURES, MISSIONS, FACTS } from './campaign-data.js';
import { createCampaignWorld } from './campaign-world.js';
import { ROUTES, slideBridgeMove } from './campaign-ground.js';
import { createChamberDisplay } from './chamber-display.js';
import { createSoundscape } from './audio.js';

const $ = id => document.getElementById(id);
async function detectLocalMind() {
  const fallback = { available: false, status: 'authored-demo' };
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return fallback;
  try {
    const response = await fetch(new URL('./api/health', location.href), { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return fallback;
    const health = await response.json();
    if (health.application !== 'threadwake-public' || health.api_version !== 3 || health.mode !== 'local-model' || health.native_available !== true) return fallback;
    return { available: true, status: health.status, message: health.message };
  } catch { return fallback; }
}
const localMind = await detectLocalMind();
const browserEdition = !localMind.available;
const edition = browserEdition ? 'authored-demo' : 'local-model';
document.body.dataset.edition = edition;
const apiBase = new URL('./api/', location.href);
const ACTIONS = ['BRIDGE', 'SHELTER', 'SURGE'];
const SIGNALS = ['voice', 'shelter', 'storm'];
const soundscape = createSoundscape();
const AUDIO_PREFERENCES_KEY = 'threadwake-audio-v1';
const soundPreferences = { muted: false, master: .75, music: .6, ambience: .75, effects: .8 };
try {
  const stored = JSON.parse(localStorage.getItem(AUDIO_PREFERENCES_KEY));
  for (const channel of ['master', 'music', 'ambience', 'effects']) if (Number.isFinite(stored?.[channel])) soundPreferences[channel] = Math.max(0, Math.min(1, stored[channel]));
  soundPreferences.muted = stored?.muted === true;
} catch {}
soundscape.setMix(soundPreferences); soundscape.setMuted(soundPreferences.muted);
let soundUnlocked = false, lastSoundUpdate = -Infinity;
const soundCueTimes = new Map();
const PORTRAITS = { marin: './assets/portraits/marin.png', vale: './assets/portraits/vale.png', iona: './assets/portraits/iona.png', mara: './assets/portraits/mara.png' };
const slot = new URLSearchParams(location.search).get('slot')?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 26) || 'main';
const saveKey = 'threadwake-public-v3:' + edition + ':' + encodeURIComponent(new URL('.', location.href).pathname) + ':' + slot;
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ canvas: $('world'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .1, 420);
const world = createCampaignWorld(scene);
const timer = new THREE.Clock();
const keys = new Set();
const revealedHints = new Set();
const revealedChamberHints = new Set();
const openEchoRecords = new Set();
const velocity = new THREE.Vector2();
let run = Campaign.start(), projection = Campaign.view(run), mode = 'title', panel = null, paused = false;
let saved = null, started = false, activePerson = 'iona', activeMachine = null, activeAttune = null;
let yaw = .35, zoom = 30, simTime = 0, realTime = 0, lastInput = performance.now(), hiddenAt = null;
let falling = 0, pulseCooldown = 0, pulseVisual = 0, hurtCooldown = 0, physicsAccumulator = 0;
let dragging = false, pointerX = 0, job = null, scope = 'focused', bias = 'SURGE', strength = .5;
let lastHud = 0, lastDiagnostics = 0, lastSave = 0, toastUntil = 0, factUntil = 0;
let journalTab = 'facts', epilogue = false, fps = 60, frameCount = 0, fpsTime = 0;
let chamberDisplay = null, lastChamberStage = '', dialogueReturnMachine = null, cinematic = null;
let healthStatus = localMind.status, lastDialogueKey = '', lastWorkbenchKey = '', lastMission = 0;
let workOrderFeedback = null;
let worldTableSession = null, worldTableGesture = null, worldTableSelected = 0, worldTableBand = null, worldTableUiKey = '', worldTableHoverAt = -Infinity;
const WORLD_TRACE_LEG_SECONDS = .9;
let worldTrace = { key: null, index: 0, elapsed: 0, paused: false, done: false, plan: null };
const worldTableRay = new THREE.Raycaster();
const worldTablePortLabels = Array.from({ length: 5 }, () => { const label = document.createElement('div'); label.className = 'world-port-label'; $('worldTableLabels').append(label); return label; });
const stats = { errors: [], frames: 0, localConversations: 0, localPlans: 0, localThoughts: 0, saves: 0, stalledFrames: 0, frameIntervals: { session: null, playing: frameBucket(), inference: frameBucket() } };
let frameIntervalActive = false;
const panelIds = ['dialogue', 'workbench', 'attune', 'journal', 'map', 'composer', 'help'];
const geometry = new THREE.IcosahedronGeometry(.45, 2);
const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xb87742, roughness: .25, metalness: .58, emissive: 0x8a5930, emissiveIntensity: .4 });
const player = new THREE.Group();
const mindVisual = new THREE.Group(); player.add(mindVisual);
const body = new THREE.Mesh(geometry, bodyMaterial); mindVisual.add(body);
const wings = [];
for (const sign of [-1, 1]) {
  const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 9), new THREE.MeshStandardMaterial({ color: 0xd0ead8, emissive: 0x579c8d, emissiveIntensity: .35, roughness: .3, metalness: .4 }));
  wing.scale.set(.92, .11, .35); wing.position.set(sign * .78, -.03, .12); mindVisual.add(wing); wings.push(wing);
}
const eye = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe9ac })); eye.position.set(0, .08, -.4); mindVisual.add(eye);
const halo = new THREE.Mesh(new THREE.TorusGeometry(.75, .017, 6, 48), new THREE.MeshBasicMaterial({ color: 0xbfe6c0, transparent: true, opacity: .6 })); halo.rotation.x = Math.PI / 2; mindVisual.add(halo);
player.scale.setScalar(1.3); scene.add(player);
const playerLight = new THREE.PointLight(0xa1e3d1, 6, 10, 2); scene.add(playerLight);
const groundRing = new THREE.Mesh(new THREE.RingGeometry(.62, .72, 40), new THREE.MeshBasicMaterial({ color: 0xb9efc9, transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false, depthTest: false })); groundRing.rotation.x = -Math.PI / 2; scene.add(groundRing);
const pulseRing = new THREE.Mesh(new THREE.TorusGeometry(1, .035, 6, 48), new THREE.MeshBasicMaterial({ color: 0xc7e6b8, transparent: true, opacity: 0, depthWrite: false })); pulseRing.rotation.x = Math.PI / 2; scene.add(pulseRing);
const carriedVisual = new THREE.Mesh(new THREE.OctahedronGeometry(.25), new THREE.MeshStandardMaterial({ color: 0xe9c687, emissive: 0x9c7849, emissiveIntensity: .8, metalness: .5, roughness: .3 })); carriedVisual.position.set(0, .8, .1); player.add(carriedVisual);
const waypointNodes = Array.from({ length: 13 }, () => { const e = document.createElement('div'); e.className = 'waypoint'; const name = document.createElement('span'), hint = document.createElement('small'), pin = document.createElement('i'); e.append(name, hint, pin); $('waypoints').append(e); return e; });
const waypointLabels = waypointNodes.map(element => ({ element, name: element.querySelector('span'), hint: element.querySelector('small'), pin: element.querySelector('i'), key: null, target: null, metrics: null }));
let waypointViewport = '';
let hudCrewName = null;

function updateMindClearance() {
  let distance = Infinity;
  for (const person of projection.people) distance = Math.min(distance, Math.hypot(player.position.x - person.x, player.position.z - person.z));
  const near = 1 - THREE.MathUtils.smoothstep(distance, 1.8, 4.8);
  mindVisual.scale.setScalar(1 - .8 * near);
  mindVisual.position.y = .8 * near;
}

function visible(id, value) { $(id).classList.toggle('hidden', !value); }
function touch() { lastInput = performance.now(); cinematic = null; }
function clearInput() { keys.clear(); dragging = false; worldTableGesture = null; velocity.set(0, 0); }
function message(text, duration = 6) { if (!text) return; $('toast').textContent = text; toastUntil = realTime + duration; visible('toast', true); }
function factMessage(id) { const text = FACTS[id] || id; $('factTitle').textContent = 'Kept in the record.'; $('factBody').textContent = text; factUntil = realTime + 10; visible('factToast', true); }
function engaged() { return run.clock.exploration + run.clock.deliberation; }
function formatTime(seconds) { const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60).toString().padStart(2, '0'); return `${m}:${s}`; }
function escapeInputFocus() { document.activeElement?.blur(); }
function save() {
  if (!started) return;
  try { localStorage.setItem(saveKey, JSON.stringify({ version: 3, run: Campaign.snapshot(run), savedAt: new Date().toISOString() })); stats.saves++; } catch (error) { message('This browser could not save the crossing. Keep the tab open.'); }
}
function commit(outcome, options = {}) {
  if (!outcome) return;
  const before = run, beforeFacts = new Set(run.facts), beforeMission = run.mission, beforePhase = run.phase;
  if (outcome.state.preview?.kind === 'work_order') workOrderFeedback = null;
  run = outcome.state; projection = Campaign.view(run);
  playCampaignAudio(before, outcome);
  if (outcome.message && !options.quiet) message(outcome.message, outcome.message.length > 170 ? 9 : 6);
  for (const id of run.facts) if (!beforeFacts.has(id)) factMessage(id);
  for (const cue of outcome.cues || []) {
    if (cue.kind === 'motion' && cue.id?.startsWith('crossing_') && !keys.size) cinematic = { motion: cue.id, until: simTime + (cue.seconds || 4) + .7 };
    if (cue.kind === 'motion-complete' && cue.id?.startsWith('crossing_')) message(({ crossing_first: 'The first cradle reached the far anchorage.', crossing_return: 'The empty carrier returned safely.', crossing_second: 'The second cradle arrived. Everyone in the manifest is across.' })[cue.id] || 'The carrier arrived.', 7);
    if (cue.kind === 'message' && cue.text) message(cue.text === projection.returnLine?.lastMeasurement?.text ? returnLineMessage(projection.returnLine) : cue.text, 9);
    const target = FIXTURES.find(f => f.id === cue.fixture) || run.pos;
    world.pulse(target, cue.kind === 'attuned' ? 0xddc184 : 0xc0e3b2);
  }
  if (run.mission !== beforeMission) {
    closePanel(); clearInput(); activeMachine = null; workOrderFeedback = null; lastWorkbenchKey = ''; lastDialogueKey = '';
    message(`CHAPTER ${String(run.mission + 1).padStart(2, '0')} · ${projection.mission.title}`, 9);
  }
  if (beforePhase !== 'victory' && run.phase === 'victory') showEnding();
  if (!options.noSave && run !== outcome.previous) save();
  refreshHud();
  if (panel === 'dialogue') renderDialogue();
  if (panel === 'workbench') renderWorkbench();
  if (panel === 'composer') updateComposer();
  publishDiagnostics();
}
function act(intent, options) { const outcome = Campaign.act(run, intent); if (outcome.state === run && outcome.message && ['manual', 'interact', 'confirm', 'acceptTerm'].includes(intent.kind)) soundCue('interlock', { id: intent.console || intent.id || intent.term, position: { ...run.pos } }); commit(outcome, options); }
function begin(continuing = false) {
  if (worldTableSession) exitWorldTable();
  cinematic = null; workOrderFeedback = null; run = Campaign.start(continuing ? saved : null); projection = Campaign.view(run);
  mode = run.phase === 'victory' ? 'ending' : 'playing'; started = true; epilogue = false; paused = false; job = null;
  stats.frameIntervals = { session: run.epoch, playing: frameBucket(), inference: frameBucket() }; frameIntervalActive = false;
  falling = pulseCooldown = pulseVisual = hurtCooldown = physicsAccumulator = 0; clearInput(); touch(); world.reset();
  for (const id of panelIds) visible(id, false); panel = null; visible('pause', false); visible('title', false); visible('ending', false); visible('hud', true);
  lastDialogueKey = lastWorkbenchKey = ''; unlockSound(); updateSound();
  if (run.restoreWarning) message('The saved crossing could not be restored: ' + run.restoreWarning, 12);
  else message(continuing ? 'Your people, parts and promises are right where you left them.' : 'Explore the refuge. E works with the nearby object or person.', 10);
  camera.position.set(run.pos.x + Math.sin(yaw) * zoom, zoom * .72 + 1.5, run.pos.z + Math.cos(yaw) * zoom);
  player.position.set(run.pos.x, 1.2, run.pos.z); refreshHud(); save();
  if (mode === 'ending') showEnding();
  else if (!continuing) openHelp(true);
  else $('world').focus({ preventScroll: true });
  publishDiagnostics();
}
function openHelp(welcome = false) {
  if (paused) return;
  visible('helpWelcome', welcome); visible('helpReference', !welcome); visible('skipWelcome', welcome);
  $('helpEyebrow').textContent = welcome ? 'YOUR FIRST CROSSING' : 'A FIELD GUIDE TO THE LONG WAKE';
  $('helpTitle').textContent = welcome ? 'Find the first light.' : 'Repairs are promises.';
  $('helpPlayButton').textContent = welcome ? 'Start exploring' : mode === 'title' ? 'Back to title' : 'Return to the crossing';
  $('helpStatus').textContent = welcome ? 'Esc closes this welcome. Press Esc again whenever you need to pause.' : 'This guide stops movement, but machinery keeps running. Close it, then press Esc to pause.';
  openPanel('help'); $('helpTitle').focus({ preventScroll: true });
}
function openPanel(name) {
  if (worldTableSession) exitWorldTable();
  if (paused || mode === 'title' && name !== 'help') return;
  escapeInputFocus(); clearInput(); for (const id of panelIds) visible(id, id === name); panel = name; touch();
  if (name === 'journal') renderJournal(); if (name === 'map') renderMap();
}
function closePanel(options = {}) {
  const wasHelp = panel === 'help';
  escapeInputFocus(); for (const id of panelIds) visible(id, false); panel = null; clearInput(); if (options.automatic) lastInput = performance.now(); else touch(); save();
  if (wasHelp) {
    const titleControl = $('continueButton').classList.contains('hidden') ? $('startButton') : $('continueButton');
    (mode === 'title' ? titleControl : $('world')).focus({ preventScroll: true });
  }
}
function togglePause(force) {
  if (mode !== 'playing' || panel) return;
  paused = typeof force === 'boolean' ? force : !paused; frameIntervalActive = false; clearInput(); escapeInputFocus(); visible('pause', paused); touch(); if (paused) save(); updateSoundscape(true); if (!paused) unlockSound();
  $(paused ? 'resumeButton' : 'world').focus({ preventScroll: true });
}
function toTitle() { save(); closePanel(); mode = 'title'; paused = false; epilogue = false; visible('pause', false); visible('ending', false); visible('hud', false); visible('title', true); try { saved = JSON.parse(localStorage.getItem(saveKey)); visible('continueButton', !!saved); } catch {} }
function unlockSound() {
  if (soundPreferences.muted) return;
  void soundscape.unlock().then(ready => { soundUnlocked = ready; updateSound(); }).catch(() => { soundUnlocked = false; updateSound(); });
}
function updateSound(persist = false) {
  soundscape.setMix(soundPreferences); soundscape.setMuted(soundPreferences.muted);
  $('soundButton').textContent = soundPreferences.muted ? '♩' : '♫';
  $('soundButton').title = (soundPreferences.muted ? 'Unmute sound' : 'Mute sound') + ' · M';
  $('soundButton').setAttribute('aria-label', $('soundButton').title);
  $('soundButton').setAttribute('aria-pressed', String(soundPreferences.muted));
  document.querySelectorAll('[data-audio-mute]').forEach(button => { button.textContent = soundPreferences.muted ? 'Unmute sound · M' : 'Mute sound · M'; button.setAttribute('aria-pressed', String(soundPreferences.muted)); });
  document.querySelectorAll('[data-audio-channel]').forEach(input => { input.value = Math.round(soundPreferences[input.dataset.audioChannel] * 100); input.previousElementSibling.querySelector('output').textContent = input.value + '%'; });
  const statusText = soundPreferences.muted ? 'Sound is muted. Your mix is kept.' : soundUnlocked ? 'Sound is on. M mutes without changing your mix.' : 'Sound begins when you start the crossing or use a sound control.';
  document.querySelectorAll('[data-audio-status]').forEach(status => { if (status.textContent !== statusText) status.textContent = statusText; });
  if (persist) try { localStorage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(soundPreferences)); } catch {}
}
function toggleSound() { soundPreferences.muted = !soundPreferences.muted; updateSound(true); unlockSound(); }
function soundCue(kind, details = {}) {
  const key = kind + ':' + (details.id || ''), now = performance.now();
  const gap = kind === 'signal' ? 150 : kind === 'fact' ? 180 : 70;
  if (now - (soundCueTimes.get(key) ?? -Infinity) < gap) return;
  soundCueTimes.set(key, now); soundscape.cue(kind, details);
}
function updateSoundscape(force = false) {
  if (!force && realTime - lastSoundUpdate < .1) return;
  lastSoundUpdate = realTime;
  const zone = ZONES.find(z => Math.hypot(run.pos.x - z.x, run.pos.z - z.z) <= z.radius);
  const sheltered = scene.getObjectByName('gallery_weather_strands')?.material.uniforms.sheltered.value || 0;
  const wind = zone?.id === 'gallery' ? 1 - sheltered * .8 : zone ? .25 : .7;
  const emitters = [];
  for (const fixture of FIXTURES) {
    let kind, active = false;
    if (fixture.id === 'gallery_return_console') { kind = 'water'; active = run.flags.includes('return_line_commissioned'); }
    else if (fixture.id === 'gallery_console') { kind = 'wind'; active = 1 - sheltered * .8; }
    else if (fixture.id === 'wake_console') { kind = 'machine'; active = run.flags.includes('refuge_lit') || run.motions.some(motion => motion.source === fixture.id); }
    else if (fixture.kind === 'attune') { kind = 'signal'; active = !!run.spectra[fixture.signal]; }
    else if (fixture.id === 'pantry_console') { kind = 'machine'; active = run.flags.includes('heater_tested'); }
    else if (fixture.kind === 'console') { kind = 'machine'; active = run.motions.some(motion => motion.source === fixture.id); }
    if (kind && active && Math.hypot(run.pos.x - fixture.x, run.pos.z - fixture.z) < 38) emitters.push({ id: fixture.id, kind, position: { x: fixture.x, z: fixture.z }, active });
  }
  emitters.sort((a, b) => Math.hypot(a.position.x - run.pos.x, a.position.z - run.pos.z) - Math.hypot(b.position.x - run.pos.x, b.position.z - run.pos.z));
  const direction = cameraGroundForward();
  const machine = panel === 'workbench' ? machinePanel() : worldTableAvailable() ? worldTableMachine() : null;
  const signalFixture = FIXTURES.find(f => f.kind === 'attune' && (panel === 'attune' && f.id === activeAttune || Math.hypot(run.pos.x - f.x, run.pos.z - f.z) < 6));
  const signal = run.spectra[signalFixture?.signal];
  const signalBands = panel === 'composer' ? Object.fromEntries(ACTIONS.map((action, i) => [action, run.mixture[i]])) : machine?.chamber ? machine.chamber.report.source : signal?.probabilities_after || signal?.authored_spectrum || { BRIDGE: 0, SHELTER: 0, SURGE: 0 };
  soundscape.update({ signalBands, position: { ...run.pos }, yaw: Math.atan2(-direction.x, -direction.y), zone: zone?.id || 'threads', wind, strain: run.strain, health: run.health, speed: mode === 'playing' && !panel && !paused && falling === 0 ? velocity.length() : 0, pending: !!run.pending, paused: paused || mode === 'title', hidden: document.hidden, completed: run.phase === 'victory' ? 1 : run.mission / MISSIONS.length, emitters: emitters.slice(0, 8) });
}
function playCampaignAudio(before, outcome) {
  const previous = JSON.stringify(before.events.at(-1));
  const events = previous === JSON.stringify(run.events.at(-1)) ? [] : run.events.slice(previous ? run.events.findLastIndex(row => JSON.stringify(row) === previous) + 1 : 0);
  const fixtureFor = row => FIXTURES.find(f => f.id === row.console || f.id === row.fixture || row.fact && f.fact === row.fact || row.site && f.signal === row.site || row.item && f.item === row.item);
  const detailsFor = row => { const fixture = fixtureFor(row); return { id: row.console || row.fixture || row.id || row.fact || row.site || row.item || row.type, position: fixture ? { x: fixture.x, z: fixture.z } : { ...run.pos }, material: fixture?.zone === 'index' ? 'paper' : 'metal' }; };
  for (const cue of outcome.cues || []) {
    const details = detailsFor(cue), fixture = fixtureFor(cue);
    if (cue.kind === 'control') soundCue(fixture?.chamber ? 'chamber-turn' : fixture?.machine.handles.find(handle => handle.id === cue.handle)?.op === 'route' ? 'route' : 'control', { ...details, id: cue.console, value: cue.value });
    else if (cue.kind === 'trigger') soundCue('trigger', { ...details, id: cue.trigger });
    else if (cue.kind === 'motion' || cue.kind === 'motion-complete') { const motion = (cue.kind === 'motion' ? run : before).motions.find(m => m.id === cue.id), source = FIXTURES.find(f => f.id === motion?.source); soundCue(cue.kind, { ...details, id: cue.id, seconds: cue.seconds, position: source ? { x: source.x, z: source.z } : details.position }); }
    else if (cue.kind === 'installed' || cue.kind === 'fact') soundCue(cue.kind, details);
    else if (cue.kind === 'attuned') { const signal = run.spectra[fixture?.signal]; soundCue('signal', { ...details, action: cue.action, vector: signal?.probabilities_after || signal?.authored_spectrum }); }
    else if (cue.kind === 'chapter' || cue.kind === 'victory') soundCue(cue.kind, details);
  }
  for (const event of events) {
    const details = detailsFor(event);
    if (event.type === 'item-carried' || event.type === 'item-dropped') soundCue(event.type === 'item-carried' ? 'pickup' : 'drop', details);
    else if (event.type === 'agreement') soundCue('agreement', { ...details, id: event.term, material: 'paper' });
    else if (event.type === 'chamber-probe' || event.type === 'chamber-commit') soundCue(event.type, { ...details, pass: event.pass, complete: event.complete, vector: event.mixture || run.toolMixture });
    else if (event.type === 'return-line-operation') { const op = event.operation; soundCue(op.op === 'set' ? 'control' : op.trigger === 'return_line_fit' ? 'installed' : 'trigger', { ...detailsFor({ console: 'gallery_return_console' }), id: op.handle || op.trigger }); }
    else if (event.type === 'return-line-commissioned' || event.type === 'return-line-parked') soundCue('return-flow', { ...detailsFor({ console: 'gallery_return_console' }), active: true });
    else if (['tool-mix', 'mix', 'reference-tool', 'tool-source'].includes(event.type)) soundCue('signal', { ...details, vector: event.type === 'mix' ? Object.fromEntries(ACTIONS.map((action, i) => [action, run.mixture[i]])) : run.toolMixture, action: event.action });
    else if (event.type === 'recovered') soundCue('recover', details);
  }
}
function nearestInteraction() {
  let nearest = null, distance = 3.4;
  const interactions = (projection.interactions || []).filter(f => f.kind !== 'report' || projection.mission.ready);
  for (const f of interactions) { const d = Math.hypot(run.pos.x - f.x, run.pos.z - f.z); if (d < distance) { nearest = f; distance = d; } }
  if (nearest?.kind !== 'npc' || !projection.carried) return nearest;
  let socket = null, socketDistance = 3.4;
  for (const f of interactions) {
    if (f.kind !== 'socket' || f.complete || f.item !== projection.carried) continue;
    const d = Math.hypot(run.pos.x - f.x, run.pos.z - f.z);
    if (d < socketDistance) { socket = f; socketDistance = d; }
  }
  return socket || nearest;
}
function machinePanel() { return projection.machines.find(m => m.fixture === activeMachine || m.id === activeMachine); }
function talk(person = 'iona', returnMachine = null) {
  dialogueReturnMachine = returnMachine; activePerson = person; lastDialogueKey = '';
  const companion = PEOPLE.find(p => p.id === person), text = contextualBriefing(companion, run);
  const previous = run.conversation.findLast(row => row.person === person && row.provenance === 'authored');
  if (previous?.text !== text) act({ kind: 'authoredTalk', person, text }, { quiet: true });
  openPanel('dialogue'); renderDialogue(); soundscape.companion(person);
}
function openMachine(f) { if (activeMachine !== f.id) { $('planInput').value = ''; workOrderFeedback = null; } activeMachine = f.id; lastWorkbenchKey = ''; openPanel('workbench'); renderWorkbench(); }
function openSignal(f) { activeAttune = f.id; openPanel('attune'); $('attuneName').textContent = f.label; $('attuneDescription').textContent = browserEdition ? 'Choose an authored calibration spectrum to carry into this routing chamber. Its sidebands and the machine’s consequences are playable; this browser edition performs no model inference or activation edit.' : f.description || 'Capture a living signal to carry through the crossing.'; $('signalInput').value = `Help us carry the ${f.signal} signal through the Last Crossing.`; renderTuning(); }
function interact() {
  const f = nearestInteraction(); if (!f) return;
  if (f.kind === 'npc') return talk(f.person || f.id.replace('person_', ''));
  if (f.kind === 'console') return openMachine(f);
  if (f.kind === 'attune') return openSignal(f);
  if (f.kind === 'report' && run.mission === MISSIONS.length - 1) { if (projection.mission.ready) return openComposer(); }
  act({ kind: 'interact', id: f.id });
}
function radio() { const f = nearestInteraction(); if (f?.kind === 'console') openMachine(f); else if (f?.kind === 'attune') openSignal(f); else talk(f?.person || 'iona'); }
async function submitMind(kind, text, subject, tuning = {}) {
  if (browserEdition) return message('Browser edition uses authored briefings, manual controls and calibration spectra. Local inference is available in the local edition.');
  if (run.pending) return message('A local thought is already forming. You can cancel it or keep exploring.');
  const next = Campaign.request(run, { kind, subject, text, ...tuning }); run = next.state; projection = Campaign.view(run);
  if (!next.packet) {
    if (kind === 'work_order' && activeMachine === subject) { workOrderFeedback = { console: subject, epoch: run.epoch, message: next.message || 'No request could be made.', status: 'not_started' }; renderWorkbench(); }
    return message(next.message || 'No request could be made.');
  }
  if (kind === 'work_order') workOrderFeedback = null;
  const packet = next.packet, ticket = packet.ticket, epoch = run.epoch;
  const legacy = kind === 'thought';
  const body = legacy ? Object.fromEntries(['relay', 'scope', 'strength', 'bias', 'request', 'context'].map(k => [k, packet[k]])) : packet;
  refreshHud(); save(); renderPending(); publishDiagnostics();
  try {
    const response = await fetch(new URL(legacy ? 'consult' : 'mind', apiBase), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const queued = await response.json(); if (!response.ok) throw new Error(queued.error || 'The local mind is occupied.');
    job = { id: queued.id, ticket, kind, epoch }; const began = performance.now();
    while (run.epoch === epoch && run.pending?.nonce === ticket.nonce && performance.now() - began < 125000) {
      await new Promise(resolve => setTimeout(resolve, 450));
      const response = await fetch(new URL('job/' + encodeURIComponent(queued.id), apiBase), { signal: AbortSignal.timeout(5000) }); const row = await response.json();
      if (row.status === 'error' || row.status === 'missing') throw new Error(row.message || row.result?.message || 'The local mind could not complete that request.');
      if (row.status === 'complete') {
        if (run.epoch !== epoch || run.pending?.nonce !== ticket.nonce) return;
        const before = run;
        const outcome = Campaign.act(run, legacy ? { kind: 'attuned', fixture: subject, ticket, result: row.result } : { kind: 'receive', ticket, result: row.result });
        if (kind === 'work_order' && activeMachine === subject) {
          const received = outcome.state !== before ? outcome.state.events.at(-1) : null;
          workOrderFeedback = received?.type === 'work-order-clarification' ? { console: subject, epoch, message: outcome.message, status: 'clarify' } : received?.type === 'reply-rejected' ? { console: subject, epoch, message: outcome.message } : null;
        }
        commit(outcome);
        const acceptedEvent = run !== before ? run.events.at(-1)?.type : null;
        if (acceptedEvent === 'conversation') stats.localConversations++; if (acceptedEvent === 'plan-preview') stats.localPlans++; if (acceptedEvent === 'attunement') stats.localThoughts++;
        job = null; renderPending(); return;
      }
    }
    if (run.epoch === epoch && run.pending?.nonce === ticket.nonce) throw new Error('The request reached its deadline. Manual controls and authored briefings are available.');
  } catch (error) {
    if (run.epoch !== epoch || run.pending?.nonce !== ticket.nonce) return;
    const detail = typeof error?.message === 'string' ? error.message : String(error);
    if (kind === 'work_order' && activeMachine === subject) workOrderFeedback = { console: subject, epoch, message: detail, status: 'failed' };
    act({ kind: 'cancelPending', ticket, message: detail }); job = null; renderPending();
  }
}
function cancelPending() { act({ kind: 'cancelPending' }); job = null; renderPending(); }
function renderPending() {
  const pending = run.pending;
  visible('dialoguePending', pending?.kind === 'conversation'); visible('planPending', pending?.kind === 'work_order');
  $('askButton').disabled = browserEdition || !!pending; $('interpretButton').disabled = browserEdition || !!pending; $('captureButton').disabled = browserEdition || !!pending;
  $('brainStatus').textContent = browserEdition ? '◇ AUTHORED BROWSER EDITION' : pending ? '✦ A LOCAL THOUGHT IS FORMING' : '• LOCAL MODEL AVAILABLE';
  $('brainStatus').title = browserEdition ? 'Authored crew briefings, manual machines and labeled calibration spectra. No live model or activation edits.' : localMind.message || 'The loopback server reports native inference available. Actual measurements appear only in capture receipts.';
}
function sealedEndingDetails(state) {
  const ending = state.ending;
  if (!ending) return '';
  const flags = new Set(ending.flags || state.flags || []), agreements = ending.agreements || state.agreements || [];
  const nameFor = role => PEOPLE.find(person => agreements.includes(role + '_' + person.id))?.name;
  const navigator = nameFor('navigator'), keeper = nameFor('keeper'), parts = [];
  if (navigator) parts.push(`${navigator} guided the first cradle.`);
  if (keeper) parts.push(`${keeper} kept the crossing record and accompanied the second.`);
  if (flags.has('record_public')) parts.push('The testimony remained public.');
  else if (flags.has('record_guarded')) parts.push(flags.has('mara_keeper_reserved') && keeper === 'Mara' ? 'The testimony stayed private in Mara’s promised custody.' : 'The testimony remained under guarded custody.');
  if (flags.has('original_records')) parts.push(ending.distribution === 'archive' ? 'The copied original names crossed with the people.' : 'The full names were copied; the final reserve was given to the people.');
  else if (flags.has('digest_records')) parts.push('The chosen record was a digest of totals, not the original names.');
  return parts.join(' ');
}
function afterglowBriefing(person, state) {
  const ending = state.ending, flags = new Set(ending.flags || state.flags || []), facts = new Set(ending.facts || state.facts || []), agreements = new Set(ending.agreements || state.agreements || []);
  const archive = ending.distribution === 'archive', people = ending.distribution === 'people';
  const nameFor = role => PEOPLE.find(person => agreements.has(role + '_' + person.id))?.name;
  const navigator = nameFor('navigator'), keeper = nameFor('keeper');
  const scanPaid = facts.has('named_copy_paid'), bundleCost = facts.has('named_bundle_kept') ? 1 : facts.has('all_freight_kept') ? 2 : null;
  const archiveName = flags.has('original_records') ? 'the named archive' : 'the archive';
  const outcome = archive ? `The people and ${archiveName} both made it.` : people ? 'The last reserve went to the people.' : 'The crossing is behind us.';
  if (person.id === 'marin') {
    const cleared = flags.has('responsibility_proven');
    let work;
    if (facts.has('span_assisted_rescue') || facts.has('witness_span_rescue')) work = cleared ? 'Being doubted stung; I held that span with my name finally clear.' : 'I held the span while they crossed.';
    else if (flags.has('witness_retained')) work = facts.has('span_manual_rescue') ? cleared ? 'With my name clear, I stayed as your witness and let the latch earn its keep.' : 'I stayed as your witness while the latch held the span.' : 'I stayed here as your witness.';
    else if (facts.has('span_manual_rescue')) work = cleared ? 'My name was cleared, and the latch brought the passengers home.' : 'The latch held, and the passengers made it.';
    else if (flags.has('witness_support_ready')) work = 'You trusted me with the lookout.';
    else work = cleared ? 'Thank you for clearing my name.' : 'Good to see familiar faces on solid ground.';
    const dock = flags.has('passengers_safe') && flags.has('freight_saved') && !flags.has('freight_released') ? 'We even got the dock freight up with its people.' : flags.has('passengers_safe') && flags.has('freight_released') && !flags.has('freight_saved') ? 'We let the dock freight go to get its people up.' : '';
    const cargo = archive && flags.has('manifest_all') && flags.has('all_freight_loaded') ? `${archiveName[0].toUpperCase() + archiveName.slice(1)} and the remaining crates were on the final manifest too.` : archive ? 'The archive came with everyone.' : people ? 'You put the last reserve behind the people.' : 'We can breathe for a minute.';
    return [work, dock, cargo].filter(Boolean).join(' ');
  }
  if (person.id === 'vale') {
    const care = agreements.has('pantry_vale') || flags.has('clinic_warm') ? 'I stayed with the injured; that one heat kept us warm.' : agreements.has('pantry_marin') || agreements.has('pantry_iona') ? 'We made do with the repaired heater.' : 'Everyone who came through needs a rest.';
    const crossing = archive ? 'The people and their records came through together; I can think about beds now.' : people ? 'You gave the last reserve to the people; we can think about beds instead of load limits.' : 'We can finally take a breath.';
    const price = scanPaid && bundleCost !== null ? `One heat saved the names, and ${bundleCost === 1 ? 'one' : 'two'} bought room for the freight.` : scanPaid ? 'You spent one heat to keep their names, too.' : bundleCost !== null ? `You spent ${bundleCost === 1 ? 'one' : 'two'} heat to make room for the freight.` : '';
    return [care, crossing, price].filter(Boolean).join(' ');
  }
  if (person.id === 'iona') {
    const duty = agreements.has('navigator_iona') ? 'I guided the first cradle.' : agreements.has('keeper_iona') ? 'I rode with the second cradle and kept the record.' : navigator && keeper ? `${navigator} guided the first; ${keeper} kept the record on the second.` : flags.has('transfer_complete') ? 'The cradles reached their stops.' : 'The crossing is done.';
    const rest = archive && flags.has('manifest_archive') && !flags.has('manifest_all') ? 'No extra crates on that manifest; my kind of tidy.' : 'The brakes can rest, and so can I.';
    return `${duty} ${outcome} ${rest}`;
  }
  if (person.id === 'mara') {
    const duty = agreements.has('keeper_mara') ? 'I carried the record on the second cradle.' : agreements.has('navigator_mara') ? `I guided the first cradle${keeper ? ', while ' + keeper + ' carried the record' : ''}.` : keeper ? `${keeper} carried the record through.` : 'There are still people here to argue with my pages.';
    const crossing = archive ? flags.has('original_records') ? 'The names came with their people' : 'The records came with their people' : people ? 'You put the people first' : 'We made it through';
    const endingLine = crossing + (flags.has('record_public') ? ', and anyone can read the testimony now.' : flags.has('record_guarded') ? ', and the testimony is still under guard.' : '.');
    const price = scanPaid && bundleCost !== null ? `You spent one heat on their names and ${bundleCost === 1 ? 'one' : 'two'} on room for the freight; I remember both.` : scanPaid ? 'One heat kept those names from becoming just a total.' : bundleCost !== null ? `You spent ${bundleCost === 1 ? 'one' : 'two'} heat to make room for the freight.` : flags.has('original_records') ? 'These names belong to people who can answer me.' : flags.has('digest_records') ? 'A total can hide someone; I want to keep listening for them.' : 'I still want the people in these pages to have the last word.';
    return `${duty} ${endingLine} ${price}`;
  }
  return outcome;
}
function investigationBriefing(person, state) {
  const flags = new Set(state.flags || []), facts = new Set(state.facts || []);
  const allRecords = ['dock_tally', 'archive_margin', 'relay_sequence', 'release_maintenance'].every(id => facts.has(id));
  if (flags.has('sequence_proven')) {
    if (person.id === 'marin') return 'Now we know when the messages came through. Being nearest a lever doesn’t make it your hand on it.';
    if (person.id === 'iona') return facts.has('release_maintenance') ? 'The timing is settled. Now make the explanation fit the iron.' : 'The timing is settled. We still need the inspection before I blame a person for it.';
    if (person.id === 'mara') return 'The timing is clear. I won’t turn it into a verdict about a person without the rest.';
    if (person.id === 'vale') return 'Knowing when they were held matters. It still doesn’t tell us whom to blame.';
  }
  if (flags.has('contradiction_proven')) {
    if (person.id === 'marin') return 'That’s one part nailed down. I’d like the messages put in order before anyone fills in the rest.';
    if (person.id === 'iona') return facts.has('relay_sequence') ? 'We’ve got the first answer. Now let the receiver tell us what came before what.' : 'One answer, then. I’ll want the receiver’s log before I trust the timing.';
    if (person.id === 'mara') return 'That much can stay on the page. I won’t let it grow into a claim we have not earned.';
    if (person.id === 'vale') return 'That’s one thing we can tell them plainly. It isn’t the whole answer yet.';
  }
  if (allRecords) {
    if (person.id === 'marin') return 'Four records beat another rumour. I can wait for an answer that fits them.';
    if (person.id === 'iona') return 'We’ve got the paper trail and a look inside the machine. Let’s see which story can carry both.';
    if (person.id === 'mara') return 'You brought all four back. I don’t want a neat answer at the price of someone’s name.';
    if (person.id === 'vale') return 'That’s a lot of pages about people who had to wait. I want an answer I could tell them to their faces.';
  }
  if (person.id === 'marin') return facts.has('dock_tally') ? 'That’s my tally. Give its times a fair hearing before you decide what to make of me.' : 'My name keeps coming up. Let’s see what the dock books actually kept.';
  if (person.id === 'iona') return facts.has('relay_sequence') ? 'The receiver kept the order of the messages. Mercifully, it has no opinion about anyone’s character.' : facts.has('release_maintenance') ? 'The cable and brake were sound. An explanation ought to respect the iron.' : 'A departure stopped. I’d rather look at the machinery than argue with a rumour.';
  if (person.id === 'mara') return facts.has('archive_margin') ? 'The margin survived. I wish the shorter version had been so careful with people.' : 'I know how tidy a story can look once it’s been shortened. I’d like the pages laid beside each other.';
  if (person.id === 'vale') return facts.has('release_maintenance') ? 'The brake was working. Those passengers deserve to know why they still had to wait.' : flags.has('passengers_safe') ? 'They’re safe now. I’d like them heard before anyone is handed the blame.' : 'There are people on both sides of this argument. I want them to be able to live with the answer.';
  return person.greeting || person.voice;
}

function contextualBriefing(person, state) {
  const flags = new Set(state.flags || []), facts = new Set(state.facts || []), agreements = new Set(state.agreements || []);
  const accepted = id => agreements.has(id), assisted = facts.has('span_assisted_rescue') || facts.has('witness_span_rescue');
  if (state.phase === 'victory' && state.ending) return afterglowBriefing(person, state);
  if (state.mission === 6 && !flags.has('responsibility_proven')) return investigationBriefing(person, state);

  if (person.id === 'marin') {
    if (state.phase === 'playing' && state.mission === 0 && flags.has('refuge_lit')) return `The horn is steady. They can hear us now. Use the ${FIXTURES.find(f => f.id === 'wake_report').label} in the refuge to call the waiting passengers. I’ll keep watch here.`;
    if (flags.has('span_rescued')) return assisted ? 'You cleared my name. I held the line, and the passengers made it across. That is a better use for my hands.' : 'You got them over on the latch. All those names have people attached again.';
    if (flags.has('responsibility_proven')) {
      if (flags.has('witness_retained')) return 'You cleared my name and kept me here to speak for the record. I’ll stay as your witness. The span will need its latch.';
      if (flags.has('witness_support_ready')) return 'You cleared my name and put me back on the line. I can hold the support when you bring the cradle across.';
      return 'That is my name cleared. I asked for the departure; I did not hold it. Thank you for finding the difference. You can send me to the lookout or keep me as your witness.';
    }
    if (accepted('pantry_marin')) return 'You kept your reserve and gave me the scouting job. The prepared line can recover one heat later, if I am assigned to the lookout.';
    if (accepted('pantry_iona')) return 'You chose Iona’s latch instead of my scouting. Good iron holds no grudge. We can still get those people over.';
    if (accepted('pantry_vale')) return 'Vale is staying with the injured. That heat has a job now. We will need the physical supports for the crossing.';
    if (flags.has('heater_tested')) return 'The heater has passed. I can offer scouting, but that job is not mine until you accept its exact terms.';
    if (flags.has('passengers_safe')) return flags.has('freight_saved') ? 'Passengers and freight, both up. We spent one heat. They can complain about their luggage from solid ground now.' : 'The passengers are safe. Their cargo is gone. Thank you for deciding which loss we could live with.';
  }
  if (person.id === 'vale') {
    if (flags.has('responsibility_proven')) return flags.has('witness_retained') ? 'Keeping Marin as a witness preserves an independent voice. It also leaves the span to its mechanical latch.' : flags.has('witness_support_ready') ? 'Marin can take the lookout now. Make sure every person on that span has a way back.' : 'The records clear Marin. His next duty still needs a decision, and that decision belongs in the book.';
    if (accepted('pantry_vale')) return 'That heat is reserved for the injured. I am staying with them. Thank you for making their warmth a decision rather than a hope.';
    if (accepted('pantry_marin') || accepted('pantry_iona')) return 'The reserve stays available for a hard crossing. The clinic has not received an extra heat cell.';
    if (flags.has('heater_tested')) return 'A working heater gives us options. Warm the injured now, keep the reserve, or assign help. I need your actual choice.';
    if (flags.has('passengers_safe')) return 'The passengers are safe. Let them rest before we ask them for another decision.';
  }
  if (person.id === 'iona') {
    if (flags.has('span_rescued')) return assisted ? 'A person held the support this time. The latch was not required. The passengers are safe.' : 'The latch held. I prefer a satisfied interlock to a dramatic rescue. The passengers are safe.';
    if (flags.has('responsibility_proven')) return flags.has('witness_retained') ? 'A witness at the refuge cannot hold a remote span. Use the latch. Geography remains annoyingly consistent.' : 'The maintenance record rules out a broken cable. The hold came from dispatch. That is a cause we can actually name.';
    if (accepted('pantry_iona')) return 'The latch plan is recorded. Keep the anchor and sail in mind. A plan is not a fitted part.';
    if (accepted('pantry_marin')) return 'Marin’s scouting agreement prepares a line. His later duty still matters. Check it before relying on that support.';
    if (accepted('pantry_vale')) return 'One heat went to the clinic. The crossing still has a mechanical route; inspect its supports before spending more.';
    if (flags.has('heater_tested')) return 'Pressure test passed. Good. The next question is allocation, not another test.';
    if (flags.has('passengers_safe')) return 'The cradle reached its upper stop. The load choice is history now, not a setting you can quietly reverse.';
  }
  if (person.id === 'mara') {
    if (flags.has('mara_keeper_reserved')) return accepted('keeper_mara') ? 'My keeper’s duty is confirmed. The guarded record stays in my custody; the navigator is a different person.' : 'You reserved me for guarded custody. The hearing must still confirm me as keeper and choose a different navigator.';
    if (flags.has('record_guarded')) return accepted('keeper_mara') ? 'The testimony remained guarded. You later confirmed me as keeper.' : 'The testimony is guarded rather than public. That custody choice did not assign me the keeper’s duty.';
    if (flags.has('record_public')) return 'The finding is public now: Marin did not give the hold order. Anyone can read the record and test that conclusion.';
    if (flags.has('responsibility_proven')) return 'The records clear Marin. The hold came from dispatch. We still have to decide who may carry and read that finding.';
    if (accepted('pantry_marin') || accepted('pantry_iona') || accepted('pantry_vale')) return 'We have an exact agreement now. It records who will help and what was paid. Let us keep both when we tell the story.';
    if (flags.has('passengers_safe')) return flags.has('freight_saved') ? 'The passengers and their freight arrived. The record also keeps the heat that bought that choice.' : 'The passengers arrived and the freight did not. Both belong in the record.';
  }
  return person.greeting || person.voice;
}
function approximateSpectrum(vector) {
  if (!vector || ACTIONS.some(action => !Number.isFinite(vector[action]))) return 'No recorded spectrum.';
  const labels = { BRIDGE: 'Br', SHELTER: 'Sh', SURGE: 'Su' };
  return ACTIONS.map(action => `${labels[action]} ≈${(100 * vector[action]).toFixed(1)}%`).join(' · ');
}
function tuningSpectrumDetails(signal) {
  if (signal.provenance === 'local' && signal.probabilities_before && signal.probabilities_after) return 'Native → retained, approximate percentages:\n' + ACTIONS.map(action => `${action} ≈${(100 * signal.probabilities_before[action]).toFixed(1)}% → ≈${(100 * signal.probabilities_after[action]).toFixed(1)}%`).join('\n');
  return (signal.provenance === 'local' ? 'Retained local profile: ' : signal.provenance === 'authored' ? 'Retained authored profile: ' : 'Retained legacy profile: ') + approximateSpectrum(signal.probabilities_after || signal.authored_spectrum);
}

function composerSourceDetails(source) {
  if (!source) return { provenance: 'MISSING SOURCE', spectrum: 'No recorded spectrum.', components: [] };
  const provenance = (source.sourceLabel || (source.kind === 'sealed_chamber_mix' ? 'SEALED CHAMBER MIX' : source.kind === 'legacy_capture' ? 'LEGACY CAPTURE' : 'MISSING SOURCE')) + (source.provenanceKnown === false ? ' · COMPONENT ORIGINS INCOMPLETE' : '');
  const components = (source.components || []).map(component => {
    const origin = component.provenance === 'local' ? 'LOCAL CAPTURE' : component.provenance === 'authored' ? 'AUTHORED CALIBRATION' : 'ORIGIN UNRECORDED';
    const weight = Number.isFinite(component.weight) ? `≈${(100 * component.weight).toFixed(1)}% of this source` : 'share unrecorded';
    const detail = component.provenance === 'local' ? `Capture record: ${component.recordId || 'unrecorded'}. Model revision: ${component.modelRevision || 'not retained in this record'}.` : component.provenance === 'authored' ? 'Authored calibration, not a model measurement.' : 'The source vector is retained; its component origin was not recorded.';
    const side = component.sourceMode ? ` · ${component.sourceMode.toUpperCase()} RECORD` : '';
    return { text: `${component.action} · ${weight} · ${origin}${side}`, detail };
  });
  return { provenance, spectrum: approximateSpectrum(source.vector), components };
}
function composerBasisMessage(finale) {
  if (finale.mixFeasibility?.possible === false) return 'This source basis cannot reach the final balance. ' + finale.mixFeasibility.reason + ' No allocation setting can solve this basis.';
  if (finale.mixFeasibility?.possible !== true) return 'The final source basis is not ready. ' + (finale.mixFeasibility?.reason || 'No qualified three-source basis is recorded.');
  return '';
}

function renderDialogue() {
  renderPending();
  const person = projection.people.find(p => p.id === activePerson) || PEOPLE.find(p => p.id === activePerson);
  if (!person) return;
  const terms = projection.terms.filter(t => t.person === activePerson);
  const rows = projection.conversation.filter(r => r.person === activePerson && (r.provenance !== 'local' || Array.isArray(r.records)));
  const key = [activePerson, rows.length, run.revision, run.pending?.nonce, run.preview?.id].join(':');
  if (key === lastDialogueKey) return; lastDialogueKey = key;
  $('personRole').textContent = dutyLabel(dutyLabel(person.duty || person.role)); $('personName').textContent = person.name;
  $('personDescription').textContent = ({ marin: 'A courier who puts names before cargo.', vale: 'The refuge steward. Warmth, beds, and a place for every person.', iona: 'An engineer who trusts a tested mechanism and a promise kept.', mara: 'The archive keeper, learning to let its people be heard.' })[person.id];
  $('portraitImage').src = PORTRAITS[person.id]; $('portraitImage').alt = 'Portrait of ' + person.name;
  $('memoryCards').replaceChildren();
  for (const fact of projection.journal.slice(-5)) { const e = document.createElement('div'); e.className = 'memory-card'; e.textContent = fact.text; $('memoryCards').append(e); }
  if (!projection.journal.length) $('memoryCards').textContent = 'No evidence discovered yet. The observatory’s records are waiting in the world.';
  $('termCards').replaceChildren();
  for (const term of terms) {
    const card = document.createElement('div'); card.className = 'term-card';
    const title = document.createElement('b'), body = document.createElement('p'), cost = document.createElement('small'), button = document.createElement('button');
    title.textContent = term.label; body.textContent = term.description;
    cost.textContent = term.accepted ? 'AGREEMENT RECORDED' : `${term.heatCost || 0} HEAT · ${term.eligible ? 'AVAILABLE' : term.missing.join(' · ')}`;
    button.textContent = term.accepted ? 'Terms kept in the record' : 'Accept these exact terms'; button.disabled = !term.eligible;
    button.onclick = () => act({ kind: 'acceptTerm', term: term.id });
    if (run.preview?.kind === 'agreement' && run.preview.term === term.id) { const proposed = document.createElement('small'); proposed.textContent = 'PROPOSED BY THE LOCAL MODEL'; card.append(proposed); }
    card.append(title, body, cost, button); $('termCards').append(card);
  }
  if (!terms.length) { const e = document.createElement('p'); e.className = 'hint'; e.textContent = epilogue ? 'The crossing is complete. Its promises remain in the journal.' : 'No new agreement is needed here. Search the discovered record for this situation.'; $('termCards').append(e); }
  const container = $('conversationRows'); container.replaceChildren();
  if (!rows.length) {
    const greeting = document.createElement('div'); greeting.className = 'speech';
    const label = document.createElement('small'), text = document.createElement('p'); label.textContent = person.name.toUpperCase() + ' · AUTHORED REACTION'; text.textContent = contextualBriefing(person, run); greeting.append(label, text); container.append(greeting);
  }
  for (const row of rows.slice(-10)) {
    const e = document.createElement('div'); e.className = 'speech' + (row.speaker === 'player' ? ' player' : '');
    const label = document.createElement('small'), text = document.createElement('p');
    label.textContent = row.speaker === 'player' ? 'YOU' : row.provenance === 'local' ? 'LOCAL RECORD MATCH · REVIEW THE SOURCES' : `${person.name.toUpperCase()} · ${row.text === person.greeting ? 'ARRIVAL NOTE / EARLIER IN THE RECORD' : row.text === contextualBriefing(person, run) ? 'CURRENT AUTHORED REACTION' : 'EARLIER BRIEFING / KEPT IN THE RECORD'}`;
    text.textContent = row.text;
    if (row.provenance === 'local') text.textContent = Array.isArray(row.records)
      ? (row.records.length ? 'The local model selected these recorded observations.' : 'The local model selected no recorded observations.')
      : 'Historical local reply; no source cards were preserved.';
    e.append(label, text);
    if (row.provenance === 'local') for (const record of row.records || []) { const card = document.createElement('div'), source = document.createElement('small'), fact = document.createElement('p'); card.className = 'memory-card'; source.textContent = 'LEDGER · ' + recordLabel(record.id); fact.textContent = record.text; card.append(source, fact); e.append(card); }
    const cited = row.cited || row.cited_facts || [];
    if (cited.length) { const refs = document.createElement('div'); refs.className = 'citations'; refs.textContent = 'RECORDED SOURCES · ' + cited.map(recordLabel).join(' / '); e.append(refs); }
    container.append(e);
  }
  container.scrollTop = container.scrollHeight;
  $('dialogueTopics').replaceChildren();
  const prompts = [run.phase === 'victory' ? 'Find the crossing records and what we paid to keep.' : 'Find the records about this repair and its reserve cost.', 'Find the consequences of our earlier choices.'];
  if (run.phase !== 'victory' && terms.some(term => term.eligible)) prompts.push('Find an available agreement for this crossing.');
  for (const prompt of prompts) { const button = document.createElement('button'); button.textContent = prompt; button.onclick = () => { $('dialogueInput').value = prompt; $('dialogueInput').focus(); touch(); }; $('dialogueTopics').append(button); }
}
function authoredBrief() {
  const person = PEOPLE.find(p => p.id === activePerson);
  const text = contextualBriefing(person, run), previous = run.conversation.findLast(row => row.person === person.id && row.provenance === 'authored');
  if (previous?.text !== text) act({ kind: 'authoredTalk', person: person.id, text });
  else { $('conversationRows').scrollTop = $('conversationRows').scrollHeight; touch(); }
}
function returnPercent(value) { return Number.isFinite(value) ? `≈${(value * 100).toFixed(2)}%` : 'not read'; }
function returnLineMessage(line) {
  const row = line?.lastMeasurement;
  if (!row || line.message !== row.text) return line?.message || '';
  const place = row.type === 'probe' ? `Pickup after housing ${row.tap}` : 'Terminal operating trial';
  const insert = row.fixture ? `${row.fixture.part === 'bushing' ? 'bushing' : 'clutch sleeve'} at housing ${row.fixture.site}` : 'no insert';
  return `${place}: input ${returnPercent(row.input)}, output ${returnPercent(row.output)} · ${row.source} · ${insert}. This is a recorded reading.`;
}
function returnSourceLabel(profile) { return profile ? `${profile.id} · Bridge ${returnPercent(profile.vector.BRIDGE)} · Shelter ${returnPercent(profile.vector.SHELTER)} · Surge ${returnPercent(profile.vector.SURGE)}` : 'Recorded input'; }
function returnEvidenceRows(observations) {
  const rows = new Map();
  for (const observed of observations) {
    const insert = observed.fixture ? `Housing ${observed.fixture.site} · ${observed.fixture.part === 'bushing' ? 'bushing' : 'clutch sleeve'}` : 'No insert';
    const key = observed.source + '/' + insert;
    if (!rows.has(key)) rows.set(key, { source: observed.source, insert, input: observed.input, pickups: {}, trials: [] });
    const row = rows.get(key);
    if (observed.type === 'probe') row.pickups[observed.tap] = observed.output;
    else row.trials.push({ output: observed.output, support: observed.support });
  }
  return [...rows.values()];
}
function renderReturnLine(machine) {
  const line = machine.returnLine, panel = $('workbench').querySelector('.panel'), grid = panel.querySelector('.workbench-grid');
  let section = $('returnLineReadout');
  if (!section) { section = document.createElement('section'); section.id = 'returnLineReadout'; section.className = 'return-line-readout'; grid.before(section); }
  let records = $('returnLineRecords');
  if (!records) { records = document.createElement('section'); records.id = 'returnLineRecords'; records.className = 'return-line-records'; grid.after(records); }
  section.hidden = records.hidden = !line; panel.classList.toggle('return-line-active', !!line); panel.classList.toggle('return-line-sealed', !!line?.outcome); grid.hidden = !!line?.outcome;
  if (!line) return;
  const open = new Set([...records.querySelectorAll('details[open]')].map(node => node.dataset.detail)); section.replaceChildren(); records.replaceChildren();
  const text = (tag, value, className = '') => { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; };
  const details = (key, label) => { const node = document.createElement('details'); node.dataset.detail = key; node.open = open.has(key); node.append(text('summary', label)); return node; };
  const flow = line.currentFlow === 'full_clinic_return' ? 'Full clinic return is running' : line.currentFlow === 'essential_basin_only' ? 'Essential basin return is running' : 'Find where the return loses its pull';
  section.append(text('h3', flow));
  const status = document.createElement('div'); status.className = 'return-line-status';
  status.append(text('span', `Reserve: ${line.heat} heat`), text('span', `Brace: ${line.crewDuty === 'holding_return_brace' ? 'Iona holding' : line.crewDuty === 'return_brace_ready' ? 'Iona agreed · ready' : 'not occupied'}`), text('span', line.fixture ? `${line.fixture.part === 'bushing' ? 'Bushing' : 'Clutch sleeve'} fitted at housing ${line.fixture.site}` : 'Service insert in its case'));
  section.append(status);
  const outlets = document.createElement('div'); outlets.className = 'return-line-outlets';
  outlets.append(text('span', `Essential basin · ${line.currentFlow ? 'flowing' : 'not commissioned'}`, line.currentFlow ? 'is-flowing' : ''), text('span', `Full clinic loop · ${line.currentFlow === 'full_clinic_return' ? 'flowing' : 'closed'}`, line.currentFlow === 'full_clinic_return' ? 'is-flowing' : ''));
  records.append(outlets);
  if (line.message && line.message !== line.lastMeasurement?.text) section.append(text('p', returnLineMessage(line), 'return-line-message'));
  const evidence = document.createElement('div'); evidence.className = 'return-line-working-evidence';
  if (line.lastMeasurement) {
    const reading = line.lastMeasurement, comparison = document.createElement('div'); comparison.className = 'return-line-comparison';
    comparison.append(text('strong', line.revision === line.measurementRevision ? 'Last actual reading · current setup' : 'Historical reading · setup has changed'));
    const fitted = reading.fixture ? `${reading.fixture.part === 'bushing' ? 'bushing' : 'clutch sleeve'} at housing ${reading.fixture.site}` : 'no insert';
    comparison.append(text('small', `${reading.source} · ${reading.type === 'probe' ? 'after housing ' + reading.tap : 'terminal trial'} · ${fitted}`));
    for (const [label, value] of [['Recorded input', reading.input], ['Recorded output', reading.output]]) { const row = document.createElement('label'), meter = document.createElement('meter'); meter.min = 0; meter.max = 1; meter.value = value; meter.setAttribute('aria-label', label + ' force'); row.append(text('span', label + ' ' + returnPercent(value)), meter); comparison.append(row); }
    evidence.append(comparison);
  }
  const selected = document.createElement('div'); selected.className = 'return-line-selected-evidence';
  selected.append(text('strong', 'Observed at selected setup'));
  const insert = line.fixture ? `Housing ${line.fixture.site} · ${line.fixture.part === 'bushing' ? 'bushing' : 'clutch sleeve'}` : 'No insert';
  selected.append(text('small', `${line.settings.source} · ${insert}`));
  const observed = returnEvidenceRows(line.observations).find(row => row.source === line.settings.source && row.insert === insert), pickups = document.createElement('div'); pickups.className = 'return-line-pickups';
  for (const tap of [1, 2, 3]) pickups.append(text('span', `After ${tap}: ${returnPercent(observed?.pickups[tap])}`));
  selected.append(pickups); evidence.append(selected); section.append(evidence);
  if (!line.lastMeasurement) section.append(text('p', 'Safe pickups are free. Binding subtracts force; slipping caps it. Read along the three housings to compare.', 'hint'));
  if (line.parked) records.append(text('p', 'At the hearing, Iona parked the full loop on the fixed pawl. The essential basin still runs; she is released from the brace for departure.', 'hint'));
  if (line.outcome) { const history = details('outcome', 'Historical commissioning receipt'); history.append(text('p', `${line.outcome.flow === 'full_clinic_return' ? 'Full clinic return' : 'Essential basin'} was commissioned with input ${returnPercent(line.outcome.input)} and terminal output ${returnPercent(line.outcome.output)}. Current service is shown above.`, 'hint')); records.append(history); }
  const notes = document.createElement('div'); notes.className = 'return-line-notes';
  notes.append(text('p', 'Healthy housings pass pull unchanged. Binding subtracts force; slipping caps it. With almost no Shelter, compare about a 22-point loss with a 12% ceiling. Safe pickups are free; a fitted insert remains a hypothesis until tested.'));
  const rules = details('rules', 'Service notes · binding versus slipping'); rules.append(notes); for (const rule of line.rules) rules.append(text('p', rule.text, 'hint')); records.append(rules);
  if (line.phase !== 'complete' && !line.agreement) {
    const discuss = document.createElement('button'); discuss.className = 'secondary'; discuss.textContent = 'Discuss brace support with Iona'; discuss.disabled = !line.ionaOffer || !!run.pending || !!run.program; discuss.onclick = () => talk('iona', activeMachine);
    status.append(discuss); records.append(text('p', 'Only an explicit accepted promise reserves Iona. She holds through preparations, then parks to essential flow at the hearing and leaves with everyone.', 'hint'));
  }
  const sources = details('sources', 'Three historical input spectra · exact receipts');
  sources.append(text('p', 'B = Bridge, S = Shelter, G = Surge. Exact historical E2B action spectra replay through authored machinery; selecting one makes no fresh inference or activation edit.', 'hint'));
  for (const profile of line.profiles) { const row = document.createElement('div'); row.className = 'return-line-source'; row.append(text('strong', returnSourceLabel(profile)), text('small', 'ARCHIVED NATIVE INPUT · ' + profile.source_label)); const receipt = document.createElement('details'); receipt.append(text('summary', 'Original archived receipt'), text('pre', JSON.stringify(profile, null, 2))); row.append(receipt); sources.append(row); }
  records.append(sources);
  const readings = details('readings', `All discovered force readings · ${line.observations.length} actual observations`);
  const scroll = document.createElement('div'); scroll.className = 'return-line-table-scroll'; const table = document.createElement('table');
  table.append(text('caption', 'Approximate percentages of the force scale. Blank pickups are unmeasured; the full log below retains six-decimal readings.'));
  const head = document.createElement('tr'); for (const label of ['Input record', 'Fitted insert', 'Input', 'After 1', 'After 2', 'After 3', 'Actual trial']) { const th = text('th', label); th.scope = 'col'; head.append(th); } const thead = document.createElement('thead'); thead.append(head); table.append(thead);
  const body = document.createElement('tbody');
  for (const row of returnEvidenceRows(line.observations)) { const tr = document.createElement('tr'); for (const value of [row.source, row.insert, returnPercent(row.input), ...[1, 2, 3].map(tap => returnPercent(row.pickups[tap])), row.trials.map(trial => `${returnPercent(trial.output)} · ${{reserve:'reserve',iona:'Iona',pawl:'fixed pawl'}[trial.support] || trial.support}`).join('; ') || 'not trialled']) tr.append(text('td', value)); body.append(tr); }
  table.append(body); scroll.append(table); readings.append(scroll); records.append(readings);
  if (!line.observations.length) records.append(text('p', 'No pickup has been read. Select a recorded input, then use Read pickup after housing 1, 2 or 3.', 'hint'));
  const log = details('log', `Full instrument log · ${line.observations.length} actual readings`); for (const row of line.observations) log.append(text('p', row.text, 'hint')); records.append(log);
}

function renderWorkbench() {
  renderPending(); const machine = machinePanel(); if (!machine) return;
  const triggerRoot = machine.chamber ? $('chamberTriggerControls') : $('triggerControls'), conditionRoot = machine.chamber ? $('chamberMachineConditions') : $('machineConditions');
  const feedback = workOrderFeedback?.epoch === run.epoch && workOrderFeedback.console === activeMachine ? workOrderFeedback : null;
  const key = [activeMachine, run.revision, run.pending?.nonce, run.preview?.id, run.program?.cursor, run.program?.waiting, feedback?.message, feedback?.status].join(':');
  if (key === lastWorkbenchKey) return; lastWorkbenchKey = key;
  $('machineZone').textContent = 'FIELD APPARATUS / ' + projection.mission.title;
  $('planInput').placeholder = machine.chamber ? 'Set A1 to a right turn, make B2 straight, then trace the chamber…' : 'Describe the controls and sequence you want to operate…';
  $('machineName').textContent = machine.chamber?.title || machine.label; $('machineDescription').textContent = machine.chamber ? `PHASE ${machine.chamber.index + 1} / ${machine.chamber.total} · ${machine.chamber.stageTitle}` : machine.returnLine?.outcome ? 'The return is commissioned. Controls are sealed; current flow and its historical readings remain in this record and Journal → Signals.' : machine.description || projection.mission.summary;
  renderChamber(machine); renderReturnLine(machine);
  let worldButton = $('operateWorldTable'); if (!worldButton) { worldButton = document.createElement('button'); worldButton.id = 'operateWorldTable'; worldButton.className = 'primary'; worldButton.textContent = 'Operate in world ↗'; worldButton.onclick = enterWorldTable; $('machineDescription').after(worldButton); } visible('operateWorldTable', machine.fixture === 'choir_voice_signal');
  $('rotorControls').classList.toggle('ordinary-controls', !machine.chamber);
  if (!machine.chamber) $('rotorControls').open = true;
  $('manualControls').replaceChildren();
  for (const handle of machine.handles) {
    const row = document.createElement('div'); row.className = 'manual-row';
    const label = document.createElement('label'); label.textContent = handle.label;
    const line = document.createElement('div'), select = document.createElement('select'), apply = document.createElement('button');
    select.setAttribute('aria-label', handle.label); select.disabled = !handle.known || !!run.program || !!machine.chamber?.complete || !!machine.returnLine?.outcome;
    for (const value of handle.values) { const option = document.createElement('option'); option.value = value.id; option.textContent = machine.returnLine && handle.id === 'return_line_source' ? returnSourceLabel(machine.returnLine.profiles.find(profile => profile.id === value.id)) : value.label; select.append(option); }
    select.value = handle.current; apply.textContent = 'Set'; apply.disabled = !handle.known || !!run.program || !!machine.chamber?.complete || !!machine.returnLine?.outcome;
    apply.onclick = () => act({ kind: 'manual', console: activeMachine, operation: { op: handle.op, handle: handle.id, value: select.value } });
    line.append(select, apply); row.append(label, line);
    if (!handle.known) { const missing = document.createElement('small'); missing.textContent = 'Collect its supporting evidence and complete any required finding.'; row.append(missing); }
    $('manualControls').append(row);
  }
  triggerRoot.replaceChildren();
  for (const trigger of machine.triggers) {
    if (machine.chamber && (machine.chamber.complete || trigger.id.endsWith('_probe'))) continue; // The instrument already traces every edit live.
    const wrap = document.createElement('div'), button = document.createElement('button'); button.className = 'trigger-button'; button.textContent = trigger.label; if (machine.returnLine && trigger.id === 'return_line_commission') { const line = machine.returnLine, key = line.fixture && `trial:${line.settings.source}:${line.fixture.site}:${line.fixture.part}:${line.settings.support}`, repeated = key && line.observations.some(row => row.key === key); button.textContent = line.settings.support === 'reserve' ? repeated ? 'Repeat trial · no new heat' : 'Try return · 1 heat' : line.settings.support === 'iona' ? 'Try return · Iona brace' : line.settings.support === 'pawl' ? 'Try essential return' : 'Try the return'; } button.disabled = !trigger.enabled || !!run.program;
    button.onclick = () => { const before = run.motions.length; act({ kind: 'manual', console: activeMachine, operation: { op: 'trigger', trigger: trigger.id } }); if (run.motions.length > before) closePanel({ automatic: true }); };
    wrap.append(button);
    if (trigger.missing.length) {
      const hint = document.createElement('details'), summary = document.createElement('summary'), why = document.createElement('p');
      hint.className = 'interlock-hint'; hint.open = revealedHints.has(trigger.id); summary.textContent = 'Need a hint? Reveal interlock requirements'; why.className = 'hint'; why.textContent = trigger.missing.join(' · ');
      hint.ontoggle = () => { if (hint.open) revealedHints.add(trigger.id); else revealedHints.delete(trigger.id); }; hint.append(summary, why); wrap.append(hint);
    }
    triggerRoot.append(wrap);
  }
  conditionRoot.replaceChildren();
  for (const condition of machine.conditions) {
    const row = document.createElement('div'); row.className = 'condition-row' + (condition.satisfied ? ' good' : '');
    const changedBaffles = machine.fixture === 'gallery_console' && condition.id === 'gallery_clear' && condition.satisfied && (run.settings.wind_west !== 'leeward' || run.settings.wind_east !== 'spill' || run.settings.wind_center !== 'pass');
    row.textContent = (condition.satisfied ? '✓ ' : '○ ') + (changedBaffles ? 'Recorded gust test passed; current settings have changed.' : condition.label); conditionRoot.append(row);
  }
  if (run.program) { const stop = document.createElement('button'); stop.className = 'trigger-button'; stop.textContent = 'Stop current work order'; stop.onclick = () => act({ kind: 'cancelProgram' }); conditionRoot.append(stop); }
  const preview = projection.preview;
  const ready = preview?.kind === 'work_order' && preview.console === activeMachine;
  visible('planPreview', !!feedback || ready); visible('executeButton', ready);
  if (feedback) {
    $('planSource').textContent = feedback.status === 'clarify' ? 'LOCAL WORK ORDER / CLARIFICATION NEEDED' : feedback.status === 'failed' ? 'LOCAL WORK ORDER / REQUEST FAILED' : feedback.status === 'not_started' ? 'LOCAL WORK ORDER / REQUEST NOT STARTED' : 'LAST LOCAL WORK ORDER / NOT ACCEPTED';
    $('planSteps').replaceChildren();
    $('planExplanation').textContent = feedback.message + ' Your draft is kept. You can try again or use the manual controls.';
    $('executeButton').disabled = true;
  } else if (ready) {
    $('planSource').textContent = preview.provenance === 'local' ? 'TRANSLATED BY THE LOCAL MODEL / REVIEW BEFORE EXECUTION' : 'AUTHORED REHEARSAL / NO INFERENCE';
    $('planSteps').replaceChildren();
    const labels = machine.returnLine ? preview.operations.map(operationLabel) : preview.changes?.length ? preview.changes : preview.operations.map(operationLabel);
    labels.forEach((text, index) => { const row = document.createElement('div'); row.className = 'plan-step'; const number = document.createElement('span'), line = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0'); line.textContent = text; row.append(number, line); $('planSteps').append(row); });
    $('planExplanation').textContent = preview.nonPredictive ? `${preview.note} Potential reserve cost: up to ${preview.potentialHeatCost} heat across these literal steps; actual new reserve trials pay when executed.` : `Projected heat change: ${Number(preview.heat || 0) >= 0 ? '+' : ''}${Number(preview.heat || 0)}. Strain change: ${Number(preview.strain || 0)}. Historical fractures: +${Number(preview.scars || 0)}. Rechecked against the current machine when you execute.`;
    $('executeButton').disabled = !!run.program;
  }
  const form = $('workOrderForm'), body = form.querySelector('.work-order-body');
  if (machine.returnLine) { form.before($('planPreview')); form.open = !ready; }
  else if (form.previousElementSibling === $('planPreview')) body.querySelector('.provenance').before($('planPreview'));
}
function worldTableMachine() { return projection.machines.find(machine => machine.fixture === 'choir_voice_signal'); }
function worldTableAvailable() {
  const machine = worldTableMachine();
  return !!worldTableSession && mode === 'playing' && !panel && !paused && !!machine?.chamber && Math.hypot(run.pos.x - 4, run.pos.z + 63) <= 3.4;
}
function worldTableEditable() { return worldTableAvailable() && !run.program && !worldTableMachine().chamber.complete; }
function exitWorldTable() {
  if (worldTableSession?.restore) { yaw = worldTableSession.restore.yaw; zoom = worldTableSession.restore.zoom; }
  worldTableSession = null; worldTrace.key = null; worldTrace.plan = null; worldTableGesture = null; worldTableHoverAt = -Infinity; document.body.classList.remove('world-table-operating'); world.voiceTable.setBandFocus(); visible('worldTableHud', false); visible('worldTableLabels', false);
}
function enterWorldTable() {
  if (machinePanel()?.fixture !== 'choir_voice_signal') return;
  closePanel(); worldTableSession = { restore: null }; worldTrace.key = null; worldTrace.plan = null; worldTableHoverAt = -Infinity; worldTableSelected = 0; worldTableBand = null; worldTableUiKey = ''; touch(); renderWorldTable();
}
function rotateWorldCell(index) {
  if (!worldTableEditable()) return;
  const handle = worldTableMachine().handles[index]; if (!handle?.known) return;
  const before = worldTableMachine().chamber.cells[index].orientation;
  act({ kind: 'manual', console: 'choir_voice_signal', operation: { op: handle.op, handle: handle.id, value: String((Number(handle.current) + 1) % 4) } });
  const cell = worldTableMachine().chamber.cells[index];
  if (cell.orientation !== before) { const turn = ['straight', 'right', 'back', 'left'], net = worldTableBand && cell.kind === 'prism' ? (cell.orientation + { BRIDGE: 3, SHELTER: 0, SURGE: 1 }[worldTableBand]) % 4 : null; message(`${cell.label} ${cell.kind.toUpperCase()}: ${turn[cell.orientation]} relative to its incoming ray.${net === null ? '' : ` ${worldTableBand} net turn: ${turn[net]}.`}`); }
}
function worldCellHit(clientX, clientY, inspect = false) {
  if (!(inspect ? worldTableAvailable() : worldTableEditable())) return null;
  const rect = $('world').getBoundingClientRect(); if (!rect.width || !rect.height || clientX < rect.left || clientY < rect.top || clientX > rect.left + rect.width || clientY > rect.top + rect.height) return null;
  worldTableRay.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
  const visibleObject = object => { for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false; return true; };
  const hit = worldTableRay.intersectObjects(world.voiceTable.cells, true).find(hit => visibleObject(hit.object)); if (!hit) return null;
  const belongs = (object, ancestor) => { for (let parent = object; parent; parent = parent.parent) if (parent === ancestor) return true; return false; };
  const occluded = worldTableRay.intersectObjects(scene.children, true).some(other => other.distance < hit.distance - .015 && other.object.isMesh && visibleObject(other.object) && !belongs(other.object, world.voiceTable.group) && (Array.isArray(other.object.material) ? other.object.material : [other.object.material]).some(material => material.visible !== false && (!material.transparent || material.opacity >= .85)));
  if (occluded) return null;
  for (let object = hit.object; object; object = object.parent) if (Number.isInteger(object.userData.cellIndex)) return object.userData.cellIndex;
  return null;
}
function startWorldCellGesture(event) {
  worldTableGesture = null; if (event.button !== 0 || !worldTableEditable()) return;
  const cell = worldCellHit(event.clientX, event.clientY); if (cell === null) return;
  worldTableSelected = cell; worldTableUiKey = ''; worldTableGesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY, distance: 0, cell };
}
function moveWorldCellGesture(event) {
  const gesture = worldTableGesture; if (gesture?.pointer === event.pointerId) gesture.distance = Math.max(gesture.distance, Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y));
}
function endWorldCellGesture(event) {
  const gesture = worldTableGesture; worldTableGesture = null;
  if (!gesture || gesture.pointer !== event.pointerId || gesture.distance > 6 || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6 || !worldTableEditable()) return;
  if (worldCellHit(event.clientX, event.clientY) === gesture.cell) rotateWorldCell(gesture.cell);
}
function renderWorldCellSelection(chamber) {
  const cell = chamber.cells[worldTableSelected], net = worldTableBand && cell.kind === 'prism' ? (cell.orientation + { BRIDGE: 3, SHELTER: 0, SURGE: 1 }[worldTableBand]) % 4 : cell.orientation;
  const turns = ['straight', 'right', 'back', 'left'], bands = { BRIDGE: 'Br', SHELTER: 'Sh', SURGE: 'Su' }, via = cell.checkpoints.length ? 'VIA ' + cell.checkpoints.map(band => bands[band]).join(' / ') : 'No required checkpoint';
  $('worldTableSelected').textContent = `${cell.label} · ${cell.kind.toUpperCase()} BASE ${cell.orientation} ${turns[cell.orientation]}${worldTableBand ? ` / ${bands[worldTableBand]} net ${net} ${turns[net]}` : ''} · ${via} · incoming-relative.`;
}
function hoverWorldCell(event) {
  if (event.buttons !== 0 || dragging || !worldTableAvailable()) return;
  const now = performance.now(); if (now - worldTableHoverAt < 100) return; worldTableHoverAt = now;
  const cell = worldCellHit(event.clientX, event.clientY, true);
  if (cell !== null && cell !== worldTableSelected) { worldTableSelected = cell; renderWorldCellSelection(worldTableMachine().chamber); }
}
function orderedWorldTrace(chamber, band) {
  const path = chamber.report.paths.find(path => path.band === band), segments = chamber.beams.filter(segment => segment.band === band && segment.value > 0), counts = {};
  const name = point => point.label || chamber.cells[point.z * 3 + point.x].label;
  const visits = segments.length ? path.visited.map((index, ordinal) => {
    const cell = chamber.cells[index], incoming = segments[ordinal], outgoing = segments[ordinal + 1]; counts[index] = (counts[index] || 0) + 1;
    return { cell: cell.label, kind: cell.kind.toUpperCase(), arrival: counts[index], from: name(incoming.from), to: name(outgoing.to), incoming: incoming.direction, outgoing: outgoing.direction, base: cell.orientation, net: (outgoing.direction - incoming.direction + 4) % 4 };
  }) : [];
  return { band, segments, visits, path, receiver: chamber.report.sinks.find(sink => sink.band === band) };
}
function worldTraceVisitText(visit) {
  const turns = ['straight', 'right', 'back', 'left'];
  return `${visit.from} → ${visit.cell} ${visit.kind}${visit.arrival > 1 ? ' (arrival ' + visit.arrival + ')' : ''} → ${visit.to} · BASE ${turns[visit.base]} / net ${turns[visit.net]}`;
}
function renderWorldTrace(chamber, dt) {
  const active = !!worldTableBand; visible('worldTraceReadout', active); $('worldTraceContacts').hidden = !active; $('worldTableHud').classList.toggle('trace-inspecting', active);
  if (!active) { worldTrace.key = null; worldTrace.plan = null; return; }
  const path = chamber.report.paths.find(path => path.band === worldTableBand), segments = chamber.beams.filter(segment => segment.band === worldTableBand && segment.value > 0);
  const key = JSON.stringify([chamber.site, chamber.stage, chamber.complete, worldTableBand, chamber.report.source, path, segments]);
  if (worldTrace.key !== key) {
    worldTrace = { key, index: 0, elapsed: 0, paused: false, done: false, plan: orderedWorldTrace(chamber, worldTableBand) }; world.voiceTable.setBandFocus(worldTableBand);
    const title = document.createElement('h4'); title.textContent = 'Ordered ' + worldTableBand.toLowerCase() + ' visits · repeats retained'; const list = document.createElement('ol');
    for (const visit of worldTrace.plan.visits) { const row = document.createElement('li'); row.textContent = worldTraceVisitText(visit) + ` · enters from ${['West', 'North', 'East', 'South'][visit.incoming]}, leaves ${['East', 'South', 'West', 'North'][visit.outgoing]}`; list.append(row); }
    const minimum = document.createElement('p'); minimum.textContent = worldTrace.plan.receiver.minimumCells > 0 ? 'A powered route needs at least ' + worldTrace.plan.receiver.minimumCells + ' distinct relays. Repeated arrivals are visits only.' : 'This receiver has no minimum relay count. Repeated arrivals are visits only.'; $('worldTraceContacts').replaceChildren(title, minimum, list);
  }
  const plan = worldTrace.plan;
  if (!plan.segments.length) { $('worldTraceStep').textContent = worldTableBand + ' · no powered dry-trace segments. No path is animated.'; $('worldTracePause').disabled = $('worldTraceNext').disabled = true; world.voiceTable.setTraceCursor(0, 0); return; }
  if (!worldTrace.paused && !worldTrace.done) {
    worldTrace.elapsed += Number.isFinite(dt) ? Math.max(0, Math.min(.1, dt)) : 0;
    while (worldTrace.elapsed >= WORLD_TRACE_LEG_SECONDS) { if (worldTrace.index === plan.segments.length - 1) { worldTrace.elapsed = WORLD_TRACE_LEG_SECONDS; worldTrace.done = true; break; } worldTrace.index++; worldTrace.elapsed -= WORLD_TRACE_LEG_SECONDS; }
  }
  const visit = plan.visits[worldTrace.index], label = worldTableBand[0] + worldTableBand.slice(1).toLowerCase(), ordinal = `${worldTrace.index + 1}/${plan.segments.length}`;
  $('worldTraceStep').textContent = 'DRY TRACE · ' + label + ' leg ' + ordinal + ' · ' + (visit ? worldTraceVisitText(visit) : plan.path.cycle ? 'stops at reported feedback termination' : `${plan.visits.at(-1).cell} → ${plan.path.exit.label} · receiver requirements ${plan.receiver.pass ? 'pass' : 'incomplete'}`);
  if (worldTrace.done) $('worldTraceStep').textContent += ' · reselect band to replay';
  $('worldTracePause').disabled = worldTrace.done; $('worldTracePause').textContent = worldTrace.paused ? 'Resume' : 'Pause'; $('worldTracePause').setAttribute('aria-label', worldTrace.paused ? 'Resume ordered dry trace' : 'Pause ordered dry trace'); $('worldTraceNext').disabled = worldTrace.done;
  world.voiceTable.setTraceCursor(worldTrace.index, worldTrace.elapsed / WORLD_TRACE_LEG_SECONDS);
}

function chamberFailureReading(report) {
  const failed = report.sinks.find(sink => !sink.pass);
  if (!failed) return report.goals.find(goal => !goal.pass)?.text || report.diagnosis;
  const name = failed.band[0] + failed.band.slice(1).toLowerCase();
  const reason = failed.received < failed.min - 1e-9 || failed.received > failed.max + 1e-9
    ? `${(failed.received * 100).toFixed(1)}% · window ${(failed.min * 100).toFixed(0)}–${(failed.max * 100).toFixed(0)}%`
    : failed.wrong > .025 + 1e-9 ? `cross-feed ${(failed.wrong * 100).toFixed(1)}% · limit 2.5%`
      : 'required readheads or relay contacts not reached';
  return `${name} receiver: ${reason}`;
}

function appendSourceReplay(parent, chamber, fixture) {
  if (chamber.complete) return;
  const make = (tag, text, className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
  const replay = make('section', '', 'source-replay'); replay.setAttribute('aria-label', 'Neural echo source replay');
  const active = chamber.profiles.filter((profile, index) => profile.available && chamber.weights[index] > 0);
  const local = active.filter(profile => profile.provenance === 'local').length;
  const origin = !active.length ? 'NO POWERED RECORD' : local === active.length ? 'MEASURED PAIR' : local ? 'MIXED RECORDS' : 'AUTHORED CALIBRATION · NO MODEL EDIT';
  replay.append(make('p', 'NEURAL ECHO', 'echo-title'), make('small', origin, 'echo-origin'));
  const controls = make('div', '', 'echo-switch'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Route the before or after record');
  for (const mode of ['before', 'after']) {
    const button = make('button', mode === 'before' ? 'Before' : 'After'); button.type = 'button'; button.dataset.mode = mode;
    button.classList.toggle('selected', chamber.sourceMode === mode); button.setAttribute('aria-pressed', String(chamber.sourceMode === mode));
    button.disabled = !!run.program || !chamber.report.powered;
    button.onclick = () => {
      if (chamber.sourceMode === mode) return;
      act({ kind: 'toolSource', fixture, mode });
      if (worldTableSession) renderWorldTable();
      parent.querySelector(`.source-replay button[data-mode="${mode}"]`)?.focus({ preventScroll: true });
    };
    controls.append(button);
  }
  replay.append(controls);
  const observed = chamber.report;
  replay.append(make('p', `${chamber.sourceMode.toUpperCase()} ROUTED · ${observed.pass ? '✓ dry trace ready' : '○ dry trace incomplete'}`, 'echo-outcome'));
  if (!observed.pass) replay.append(make('p', chamberFailureReading(observed), 'echo-reading'));
  replay.append(make('p', 'Same optics. Same weights. Replaying a record makes no new capture.', 'echo-note'));
  const records = make('details', '', 'echo-records'); records.open = openEchoRecords.has(fixture);
  records.ontoggle = () => { if (!records.isConnected) return; if (records.open) openEchoRecords.add(fixture); else openEchoRecords.delete(fixture); };
  records.append(make('summary', 'Inspect the recorded pair'));
  for (const profile of active) {
    const text = profile.paired ? `${profile.action} record · before ${approximateSpectrum(profile.before)} · after ${approximateSpectrum(profile.after)}` : `${profile.action} · no before record; this retained calibration is held fixed.`;
    records.append(make('p', text));
    if (profile.provenance === 'local') records.append(make('p', profile.steeringApplied ? 'The capture records an applied activation edit.' : 'This capture records no applied activation edit.'));
  }
  replay.append(records);
  if (chamber.site === 'voice' && chamber.index === 1) replay.append(make('blockquote', '“A name may stay the same while its witnesses vanish.” — Mara', 'echo-inscription'));
  parent.append(replay);
}

function renderWorldTable(dt = 0) {
  const show = worldTableAvailable(); visible('worldTableHud', show); visible('worldTableLabels', show);
  if (show) {
    const narrow = innerWidth <= 1000, x = narrow ? 0 : 181, y = narrow ? innerHeight * .21 + 6 : 0;
    if (!camera.view?.enabled || camera.view.fullWidth !== innerWidth || camera.view.fullHeight !== innerHeight || camera.view.offsetX !== x || camera.view.offsetY !== y) camera.setViewOffset(innerWidth, innerHeight, x, y, innerWidth, innerHeight);
  } else if (camera.view?.enabled) camera.clearViewOffset();
  document.body.classList.toggle('world-table-operating', show);
  if (!show) { if (worldTableSession && mode === 'playing' && !panel && !paused) exitWorldTable(); return; }
  const machine = worldTableMachine(), chamber = machine.chamber, key = [run.revision, !!run.program, chamber.stage, chamber.complete, worldTableBand].join(':');
  if (key !== worldTableUiKey) {
    worldTableUiKey = key; const make = (tag, text, className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
    $('worldTableTitle').textContent = `${chamber.index + 1} / ${chamber.total} · ${chamber.stageTitle}`;
    $('worldTableHud').querySelector('.instrument-inspection summary').textContent = chamber.complete ? 'Route inspection · sealed, read only' : 'Route inspection · click a cell to turn';
    renderWorldCellSelection(chamber);
    $('worldTableBands').replaceChildren(); for (const band of [null, ...ACTIONS]) { const button = make('button', band ? band[0] + band.slice(1).toLowerCase() : 'Show all'); button.classList.toggle('selected', band === worldTableBand); button.setAttribute('aria-pressed', String(band === worldTableBand)); button.title = band ? 'Inspect this current trace; select the band again to replay.' : 'Show all routes and stop ordered playback.'; button.onclick = () => { worldTableBand = band; worldTrace.key = null; world.voiceTable.setBandFocus(band); worldTableUiKey = ''; renderWorldTable(); }; $('worldTableBands').append(button); }
    $('worldTableSource').textContent = `${chamber.complete ? 'SEALED OUTPUT' : 'ROUTED INPUT · ' + chamber.sourceMode.toUpperCase()} · ${approximateSpectrum(chamber.report.source)} · State totals: Heat ${run.heat} · Strain ${Math.round(run.strain)} · Scars ${run.scars}`;
    $('worldTableInputs').replaceChildren();
    if (chamber.complete) { const source = projection.finale?.sources?.find(source => source.signal === 'voice' && source.kind === 'sealed_chamber_mix'), info = source && source.provenanceKnown !== false ? composerSourceDetails(source) : { provenance: 'LEGACY SEAL · INPUT HISTORY UNRECORDED', components: [] }; $('worldTableInputs').append(make('p', info.provenance)); for (const component of info.components) $('worldTableInputs').append(make('p', component.text)); }
    else {
      appendSourceReplay($('worldTableInputs'), chamber, 'choir_voice_signal');
      $('worldTableInputs').append(make('p', 'Weights blend the selected records; they do not rewrite a capture.', 'world-table-input-note'));
      ACTIONS.forEach((action, index) => {
        const profile = chamber.profiles.find(profile => profile.action === action), row = make('label', '', 'world-table-input');
        const title = make('span', `${action[0] + action.slice(1).toLowerCase()} tool · ${profile?.available ? profile.provenance === 'local' ? 'LOCAL' : profile.provenance === 'authored' ? 'AUTHORED' : 'LEGACY' : 'MISSING'}`);
        const amount = make('b', 'WEIGHT ' + chamber.weights[index]), spectrum = make('small', profile?.available ? approximateSpectrum(profile.probabilities) : 'No retained profile.');
        row.dataset.band = action;
        const strip = make('span', '', 'profile-spectrum-strip'); strip.setAttribute('aria-hidden', 'true');
        if (profile?.available) for (const band of ACTIONS) { const segment = make('i', '', band.toLowerCase()); segment.style.flexGrow = String(profile.probabilities[band]); strip.append(segment); }
        const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = chamber.weights[index]; slider.disabled = !profile?.available || !worldTableEditable(); slider.setAttribute('aria-label', action + ' input weight, 0 to 100');
        slider.oninput = () => amount.textContent = 'WEIGHT ' + slider.value;
        slider.onchange = () => {
          if (!worldTableEditable()) return;
          const focused = document.activeElement === slider, weights = [...worldTableMachine().chamber.weights]; weights[index] = Number(slider.value);
          act({ kind: 'toolMix', fixture: 'choir_voice_signal', weights }); renderWorldTable();
          if (focused) $('worldTableInputs').querySelector(`input[aria-label="${action} input weight, 0 to 100"]`)?.focus({ preventScroll: true });
        };
        row.append(title, amount, spectrum, strip, slider); $('worldTableInputs').append(row);
      });
    }
    $('worldTableReceivers').replaceChildren();
    for (const sink of chamber.report.sinks) {
      const row = make('div', '', 'receiver-card'), name = sink.band[0] + sink.band.slice(1).toLowerCase(); row.dataset.band = sink.band;
      const state = sink.pass ? 'Ready' : sink.received < sink.min - 1e-9 ? 'Low' : sink.received > sink.max + 1e-9 ? 'High' : 'Route needed';
      row.classList.toggle('receiver-pass', sink.pass);
      row.append(make('b', name), make('strong', (sink.received * 100).toFixed(1) + '%'), make('span', `${(sink.min * 100).toFixed(0)}–${(sink.max * 100).toFixed(0)}% · ${sink.port.label}`), make('em', (sink.pass ? '✓ ' : '○ ') + state));
      $('worldTableReceivers').append(row);
    }
    $('worldTableHud').dataset.state = chamber.complete ? 'sealed' : chamber.report.dangerous ? 'dangerous' : chamber.report.pass ? 'ready' : 'incomplete';
    const goals = chamber.report.goals; $('worldTableGoalsTitle').textContent = `${goals.filter(goal => !goal.pass).length} remaining · all routing requirements`; $('worldTableGoals').replaceChildren(); for (const goal of goals) { const receiver = chamber.report.sinks.find(sink => 'receiver_' + sink.band === goal.id), text = receiver?.minimumCells > 0 ? goal.text.replace('five relay contacts', 'at least ' + receiver.minimumCells + ' distinct relays') : goal.text; $('worldTableGoals').append(make('p', (goal.pass ? '✓ ' : '○ ') + text)); }
    const tripped = run.chambers.voice.faulted.includes(chamber.stage); $('worldTableRisk').textContent = chamber.complete ? 'SEALED · recorded source and route; current global bank cannot change it.' : chamber.report.dangerous ? tripped ? 'DRY TRACE · reserve fuse already tripped; no new scar on repeat.' : 'DRY TRACE · Commit overloads the reserve: 4 strain and one permanent scar.' : chamber.report.pass ? 'DRY TRACE READY · all requirements pass. Commit is a separate action.' : `DRY TRACE · ${chamberFailureReading(chamber.report)}. Commit will not advance; no strain or scar.`;
    $('worldTableHud').querySelector('.world-table-help').textContent = chamber.complete ? 'Sealed route · hover to inspect · drag orbit · Esc leaves.' : 'Hover to inspect · click to turn · drag orbit · Esc leaves.';
    $('worldTableCommit').disabled = !worldTableEditable() || !chamber.report.powered; $('worldTableCommit').textContent = chamber.complete ? 'Route sealed' : chamber.report.dangerous ? tripped ? 'Retest tripped reserve' : 'Commit overload · +4 strain, 1 scar' : chamber.report.pass ? 'Commit phase' : 'Safe test · incomplete'; $('worldTableFrame').textContent = worldTableSession.restore ? 'Restore orbit' : 'Frame bench';
  }
  renderWorldTrace(chamber, dt);
  world.voiceTable.group.updateMatrixWorld(true); camera.updateMatrixWorld();
  const ports = [{ port: chamber.sourcePort, text: chamber.sourcePort.label }, ...chamber.sinks.map(sink => ({ port: sink.port, text: sink.band[0] + sink.band.slice(1).toLowerCase() + ' · ' + sink.port.label })), ...chamber.fragilePorts.map(port => ({ port, text: 'Fragile reserve' }))];
  for (const [index, label] of worldTablePortLabels.entries()) { const entry = ports[index]; if (!entry) { label.hidden = true; continue; } const point = world.voiceTable.group.localToWorld(new THREE.Vector3((entry.port.x - 1) * 1.48, .55, (entry.port.z - 1) * 1.48)).project(camera); label.hidden = point.z > 1 || point.z < -1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1; const direction = { N: [0, -.5], E: [.5, 0], S: [0, .5], W: [-.5, 0] }[entry.port.edge], outside = world.voiceTable.group.localToWorld(new THREE.Vector3((entry.port.x - 1 + direction[0]) * 1.48, .55, (entry.port.z - 1 + direction[1]) * 1.48)).project(camera), dx = (outside.x - point.x) * innerWidth, dy = (point.y - outside.y) * innerHeight, length = Math.hypot(dx, dy) || 1; label.style.left = `${(point.x + 1) * innerWidth / 2 + dx / length * 12}px`; label.style.top = `${(1 - point.y) * innerHeight / 2 + dy / length * 12}px`; label.style.transform = Math.abs(dx) > Math.abs(dy) ? `translate(${dx < 0 ? '-100%' : '0'}, -50%)` : `translate(-50%, ${dy < 0 ? '-100%' : '0'})`; label.textContent = entry.text; }

}

function dutyLabel(duty) {
  return ({ scout: 'Gallery lookout', holding_span: 'Holding the rescue line', witness: 'Independent witness', navigator: 'Crossing navigator', keeper: 'Keeper of the record', mechanic: 'Refuge mechanic', clinic: 'Clinic steward', return_brace_ready: 'Ready at the return brace', holding_return_brace: 'Holding the clinic return' })[duty] || duty;
}
function recordLabel(id) {
  const known = { pantry_test_started: 'The heater pressure test', freight_released_event: 'The freight left behind', freight_saved_event: 'The freight we kept', first_transfer_arrived: 'The returning carrier', second_transfer_started: 'The second crossing' };
  if (known[id]) return known[id];
  const fixture = FIXTURES.find(f => f.fact === id || f.machine?.triggers.some(t => t.effects?.facts?.includes(id) || t.effects?.incident === id));
  if (fixture) return fixture.label;
  const mission = MISSIONS.find(m => m.incident === id); if (mission) return mission.title;
  if (id.startsWith('optics_')) return 'Current instrument: ' + ({ rules: 'relay rules', grid: 'prism positions', goals: 'receiver requirements', trace: 'observed beam paths', input: 'captured input profiles' })[id.split('_').at(-1)];
  if (id.startsWith('chamber_')) return id.includes('voice') ? 'The witness ribbon restored' : id.includes('shelter') ? 'The living reserve restored' : 'The returning storm restored';
  return 'A choice kept in the record';
}
function renderChamber(machine) {
  const chamber = machine.chamber;
  visible('chamberSummary', !!chamber); visible('chamberActionPanel', !!chamber); visible('triggerControls', !chamber); visible('machineConditions', !chamber);
  visible('workOrderForm', !chamber);
  visible('chamberRule', !!chamber); visible('chamberInstrument', !!chamber); visible('chamberTools', !!chamber);
  $('workbench').querySelector('.panel').classList.toggle('chamber-active', !!chamber);
  if (!chamber) { $('workOrderForm').open = true; return; }
  $('chamberRule').textContent = chamber.description;
  const scars = run.chambers[chamber.site]?.faulted?.length || 0;
  if (scars) $('chamberRule').textContent += ` The chamber retains ${scars} historical fracture${scars === 1 ? '' : 's'} from overloaded reserves.`;
  const risk = $('chamberRisk'), tripped = run.chambers[chamber.site].faulted.includes(chamber.stage);
  risk.textContent = chamber.complete ? 'Sealed. The recorded source and all three phase results are kept in the ledger.' : chamber.report.dangerous ? tripped ? 'The reserve fuse already tripped. Another failed commit adds no damage; the historical scar remains.' : 'Committing trips the reserve fuse: up to 4 strain and one permanent scar. Dry tracing is safe.' : chamber.report.pass ? 'Every receiver and relay contact agrees. This phase is ready to commit.' : chamberFailureReading(chamber.report) + '. A failed commit will not damage the reserve.';
  risk.classList.toggle('danger-risk', !!chamber.report.dangerous);
  const stageKey = chamber.site + ':' + chamber.index;
  if (lastChamberStage !== stageKey) { $('workbench').querySelector('.panel').scrollTop = 0; $('workOrderForm').open = false; $('planInput').value = ''; $('rotorControls').open = false; lastChamberStage = stageKey; }
  if (!chamberDisplay) chamberDisplay = createChamberDisplay($('chamberInstrument'), { summaryContainer: $('chamberSummary'), onRotate(index) {
    const current = machinePanel(); if (!current?.chamber || current.chamber.complete || run.program) return;
    const handle = current.handles[index]; if (!handle) return;
    const next = String((Number(handle.current) + 1) % 4);
    act({ kind: 'manual', console: activeMachine, operation: { op: handle.op, handle: handle.id, value: next } });
  } });
  chamberDisplay.update({ ...chamber, disabled: !!run.program || chamber.complete });
  const tools = $('chamberTools'), recordedOpen = tools.querySelector('.chamber-sealed-inputs')?.open || false; tools.replaceChildren();
  const title = document.createElement('h4'); title.textContent = chamber.complete ? 'Sealed output / recorded inputs' : 'Input spectrum / captured profiles'; tools.append(title);
  const intro = document.createElement('p'); intro.className = 'hint'; intro.textContent = chamber.complete ? 'The final routed source is fixed. Its recorded input shares and origins can be inspected below.' : 'Blend the full retained profiles; their sidebands matter as much as their winning action. Input labels distinguish local captures, authored calibration and missing profiles.'; tools.append(intro);
  if (chamber.complete) {
    const source = projection.finale?.sources?.find(input => input.signal === chamber.site && input.kind === 'sealed_chamber_mix');
    const info = source && source.provenanceKnown !== false ? composerSourceDetails(source) : { provenance: 'LEGACY SEAL · COMPONENT HISTORY UNRECORDED', spectrum: approximateSpectrum(chamber.report?.source), components: [] };
    const details = document.createElement('details'), heading = document.createElement('summary');
    details.className = 'interlock-hint chamber-sealed-inputs'; details.open = recordedOpen; heading.textContent = 'Recorded inputs and allocations';
    const origin = document.createElement('p'), spectrum = document.createElement('p'); origin.className = 'hint'; origin.textContent = info.provenance; spectrum.className = 'profile-spectrum'; spectrum.textContent = info.spectrum;
    details.append(heading, origin, spectrum);
    if (info.components.length) {
      const inputs = document.createElement('ul'); inputs.className = 'mix-components'; inputs.setAttribute('aria-label', 'Input shares sealed into this chamber');
      for (const component of info.components) { const item = document.createElement('li'), record = document.createElement('small'); item.textContent = component.text; record.textContent = component.detail; item.append(record); inputs.append(item); }
      details.append(inputs);
    } else { const unknown = document.createElement('p'); unknown.className = 'hint'; unknown.textContent = 'The final source vector is retained, but the original input profiles and allocations were not recorded.'; details.append(unknown); }
    tools.append(details); return;
  }
  appendSourceReplay(tools, chamber, activeMachine);
  const recovery = document.createElement('details'), recoveryTitle = document.createElement('summary'); recovery.className = 'interlock-hint'; recovery.open = browserEdition; recoveryTitle.textContent = browserEdition ? 'Authored calibration tools / optional solution' : 'Recovery tools · authored calibration / optional solution'; recovery.append(recoveryTitle);
  const recoveryNote = document.createElement('p'); recoveryNote.className = 'hint'; recoveryNote.textContent = browserEdition ? 'These authored calibration spectra supply the browser edition’s routing puzzles. Their secondary bands affect the result. No neural measurement is made.' : 'For an unavailable local model, these authored calibration profiles preserve sideband interference. They are not measured neural signals. Replacing a captured profile cannot be undone.'; recovery.append(recoveryNote);
  ACTIONS.forEach((action, index) => {
    const row = document.createElement('div'); row.className = 'chamber-tool';
    const head = document.createElement('div'), label = document.createElement('b'), amount = document.createElement('span');
    const profile = Array.isArray(chamber.profiles) ? chamber.profiles.find(p => p.action === action) : chamber.profiles?.[action];
    label.textContent = action + ' · ' + (profile?.available ? profile.provenance === 'local' ? 'LOCAL' : 'AUTHORED' : 'NOT CAPTURED');
    amount.textContent = String(chamber.weights?.[index] ?? run.toolWeights[index]); head.append(label, amount);
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = chamber.weights?.[index] ?? run.toolWeights[index]; slider.disabled = !profile?.available || !!run.program || chamber.complete; slider.setAttribute('aria-label', action + ' input allocation');
    slider.oninput = () => { amount.textContent = slider.value; touch(); };
    slider.onchange = () => {
      const focused = document.activeElement === slider, weights = [...run.toolWeights]; weights[index] = Number(slider.value);
      act({ kind: 'toolMix', fixture: activeMachine, weights });
      if (focused) $('chamberTools').querySelector(`input[aria-label="${action} input allocation"]`)?.focus({ preventScroll: true });
    };
    const reference = document.createElement('button'); reference.className = 'secondary'; reference.textContent = (profile?.available ? 'Replace with' : 'Add') + ' authored ' + action.toLowerCase() + ' calibration'; reference.disabled = !!run.program || chamber.complete;
    reference.onclick = () => act({ kind: 'referenceTool', fixture: activeMachine, action });
    const spectrum = document.createElement('p'); spectrum.className = 'profile-spectrum'; spectrum.textContent = profile?.available ? approximateSpectrum(profile.probabilities) : 'No retained profile.';
    row.append(head, spectrum, slider); tools.append(row); recovery.append(reference);
  });
  const hint = document.createElement('details'), heading = document.createElement('summary'), body = document.createElement('p');
  hint.className = 'interlock-hint'; hint.open = revealedChamberHints.has(stageKey); hint.ontoggle = () => { if (hint.open) revealedChamberHints.add(stageKey); else revealedChamberHints.delete(stageKey); }; heading.textContent = 'Need help? Reveal the chamber’s solution'; body.className = 'hint';
  body.textContent = typeof chamber.hint === 'string' ? chamber.hint : chamber.hint?.solution || 'Use the receiver ranges and trace each marked checkpoint.';
  hint.append(heading, body); recovery.append(hint); tools.append(recovery);
}
function operationLabel(op) {
  const machine = machinePanel();
  if (op.op === 'set' || op.op === 'route') { const h = machine?.handles.find(h => h.id === op.handle); if (machine?.returnLine && op.handle === 'return_line_source') return `${h?.label || 'Recorded input'} → ${returnSourceLabel(machine.returnLine.profiles.find(profile => profile.id === op.value))}`; return `${h?.label || op.handle} → ${h?.values.find(v => v.id === op.value)?.label || op.value}`; }
  if (op.op === 'trigger') return machine?.triggers.find(t => t.id === op.trigger)?.label || op.trigger;
  return 'Wait until ' + (machine?.conditions.find(c => c.id === op.condition)?.label || op.condition);
}
function renderTuning() {
  document.querySelectorAll('[data-bias]').forEach(e => e.classList.toggle('selected', e.dataset.bias === bias));
  $('focusedButton').classList.toggle('selected', scope === 'focused'); $('broadButton').classList.toggle('selected', scope === 'broad');
  $('strengthText').textContent = Number((strength * 100).toFixed(1)) + '%';
  $('captureCost').textContent = strength === 0 ? 'Native decision. No activation edit or capture strain.' : `Measured edits add up to ${Math.ceil(6 * strength * (scope === 'broad' ? 1.5 : 1))} strain. Reusing a retained signal adds no capture cost.`;
  $('captureCost').textContent += ' Small trims can preserve secondary current; large gains can concentrate one band. Check the full measured vector.';
  $('broadButton').title = 'Scope changes edit extent; focused and broad matched in the measured control.';
  renderPending();
  visible('openChamberButton', !!activeAttune && !!run.spectra[FIXTURES.find(f => f.id === activeAttune)?.signal]);
  const f = FIXTURES.find(f => f.id === activeAttune), signal = f && run.spectra[f.signal];
  $('openChamberButton').textContent = (f && run.chambers[f.signal]?.complete ? 'Inspect the sealed chamber' : 'Open the signal chamber') + ' ↗'; visible('signalReceipt', !!signal);
  if (signal) {
    const steering = signal.steering;
    $('signalReceipt').textContent = signal.provenance === 'local' ? `${signal.baseline_action} → ${signal.action}. ${steering?.applied ? `Measured layer ${steering.layer} edit: ${steering.edited_tokens} token${steering.edited_tokens === 1 ? '' : 's'}, ΔL2 ${Number(steering.delta_l2).toFixed(3)}.` : 'Native model decision; no edit.'} Retained as a tool; completed chambers seal the final inputs.` : `${signal.action} · ${signal.provenance === 'authored' ? 'authored reference. No model inference or activation measurement.' : 'legacy retained profile. No current inference or activation measurement.'}`;
    $('signalReceipt').textContent += '\n' + tuningSpectrumDetails(signal);
  }
}
function referenceCapture() {
  if (!activeAttune) return;
  if (run.pending) act({ kind: 'cancelPending' }, { quiet: true });
  const next = Campaign.request(run, { kind: 'thought', subject: activeAttune, text: 'Use an explicitly authored reference.', bias, scope, strength: 0 });
  run = next.state;
  if (!next.packet) return message(next.message);
  act({ kind: 'attuned', fixture: activeAttune, ticket: next.packet.ticket, result: { id: crypto.randomUUID(), action: bias, provenance: 'authored' } });
  renderTuning();
}
function renderJournal() {
  for (const [id, tab] of [['factsTab', 'facts'], ['choicesTab', 'choices'], ['signalsTab', 'signals']]) $(id).classList.toggle('selected', journalTab === tab);
  const content = $('journalContent'); content.replaceChildren();
  if (journalTab === 'facts') {
    for (const fact of projection.journal) addJournalCard(content, recordLabel(fact.id), fact.text, 'ENGINE-RECORDED EVIDENCE');
    if (!projection.journal.length) addJournalCard(content, 'A blank page is a beginning.', 'Inspect the refuge service plate and the records you discover in each district.', 'YOUR DISCOVERIES STAY WITH YOU');
  } else if (journalTab === 'choices') {
    for (const incident of projection.incidents) addJournalCard(content, recordLabel(incident.id), incident.text, 'DURABLE CAMPAIGN RECORD');
    for (const person of projection.people) addJournalCard(content, person.name, dutyLabel(person.duty || person.role), 'CURRENT DUTY');
  } else {
    for (const key of SIGNALS) {
      const signal = run.spectra[key]; if (!signal) continue;
      const card = addJournalCard(content, key[0].toUpperCase() + key.slice(1) + ' / ' + signal.action, signal.utterance || 'An explicitly authored signal reference.', signal.provenance === 'local' ? 'ACTUAL LOCAL MODEL SPECTRUM' : 'AUTHORED REFERENCE / NO MODEL INFERENCE');
      if (signal.provenance === 'local') {
        const t = signal.steering; const detail = document.createElement('p'); detail.textContent = t?.applied ? `Native ${signal.baseline_action} → ${signal.action}. Layer ${t.layer}, ${t.edited_tokens} edited tokens, ${t.changed_elements} changed elements, ΔL2 ${Number(t.delta_l2).toFixed(3)}.` : 'Native decision. No activation intervention.'; card.append(detail);
        for (const action of ACTIONS) { const row = document.createElement('div'); row.className = 'prob-row'; const name = document.createElement('span'), track = document.createElement('div'), fill = document.createElement('i'), value = document.createElement('b'); name.textContent = action; fill.style.width = 100 * signal.probabilities_after[action] + '%'; track.append(fill); value.textContent = `${(100 * signal.probabilities_before[action]).toFixed(1)}% → ${(100 * signal.probabilities_after[action]).toFixed(1)}%`; row.append(name, track, value); card.append(row); }
      }
    }
    if (!Object.keys(run.spectra).length) addJournalCard(content, 'Living signals', 'Captured profiles remain in the tool bank and capture history. The final crossing uses the outputs earned by completed chambers.', 'DISCOVERED DURING THE CAMPAIGN');
    if (projection.returnLine) {
      const line = projection.returnLine, current = line.currentFlow === 'full_clinic_return' ? 'full clinic return' : line.currentFlow === 'essential_basin_only' ? 'essential basin only' : 'not commissioned';
      const history = line.outcome ? line.outcome.flow === 'full_clinic_return' ? 'full clinic return' : 'essential basin only' : 'no commissioning receipt';
      const card = addJournalCard(content, 'Clinic return-water / current record', `Current service: ${current}. Historical commissioning: ${history}. Reserve now: ${line.heat} heat. ${line.parked ? 'Iona parked the larger loop at the hearing and was released from the brace.' : line.crewDuty === 'holding_return_brace' ? 'Iona is holding the return brace through preparations.' : 'No crew member is holding this brace.'}`, 'ACTUAL OPERATING RECORD / HISTORICAL INPUT REPLAY');
      const details = document.createElement('details'), summary = document.createElement('summary'), record = document.createElement('pre'); summary.textContent = 'Service notes, all observations and exact archived sources'; record.textContent = JSON.stringify({ currentFlow: line.currentFlow, commissioning: line.outcome, parked: line.parked, observations: line.observations, profiles: line.profiles, rules: line.rules }, null, 2); details.append(summary, record); card.append(details);
    }

  }
}
function addJournalCard(parent, title, text, source) {
  const article = document.createElement('article'); article.className = 'journal-card'; const label = document.createElement('small'), h = document.createElement('h3'), p = document.createElement('p'); label.textContent = source; h.textContent = title; p.textContent = text; article.append(label, h, p); parent.append(article); return article;
}
function openComposer() { openPanel('composer'); renderComposer(); }
function renderComposer() {
  const finale = projection.finale, minimum = finale.minimumShare || 0;
  const rule = minimum > 0 ? `Every station must supply at least ${(100 * minimum).toFixed(1)}% of the final allocation to keep its pilot current.` : 'At least one input needs a positive allocation.';
  const earned = finale.sources?.every(source => source.kind === 'sealed_chamber_mix');
  $('composerDescription').textContent = (earned ? 'Blend the outputs earned by the three chambers. Each seal keeps its final routed mixture; raw captures remain in the journal. ' : 'Blend the retained inputs shown below. Legacy captures keep their recorded spectra; revisiting an unfinished chamber earns its sealed output. ') + 'Allocations are relative units, with normalized shares shown. ' + rule;
  $('mixSources').replaceChildren();
  SIGNALS.forEach((key, index) => {
    const input = finale.sources?.find(source => source.signal === key), info = composerSourceDetails(input);
    const source = document.createElement('div'); source.className = 'mix-source';
    const head = document.createElement('div'), title = document.createElement('b'), value = document.createElement('small'); title.textContent = input?.label || key; value.id = 'weightValue' + index; head.append(title, value);
    const provenance = document.createElement('p'); provenance.className = 'mix-source-provenance'; provenance.textContent = info.provenance;
    const spectrum = document.createElement('p'); spectrum.className = 'profile-spectrum'; spectrum.textContent = info.spectrum;
    const components = document.createElement('ul'); components.className = 'mix-components'; components.setAttribute('aria-label', 'Components sealed into this source');
    for (const component of info.components) { const item = document.createElement('li'); item.textContent = component.text; item.title = component.detail; components.append(item); }
    const range = document.createElement('input'); range.type = 'range'; range.min = 0; range.max = 100; range.value = run.mixWeights[index]; range.id = 'mixWeight' + index; range.disabled = !input?.vector || finale.mixFeasibility?.possible === false; range.setAttribute('aria-label', (input?.label || key) + ' relative allocation');
    range.oninput = () => { const weights = [...run.mixWeights]; weights[index] = Number(range.value); if (weights.some(weight => weight > 0)) act({ kind: 'mix', weights }, { quiet: true }); updateComposer(); };
    source.append(head, provenance, spectrum, components, range); $('mixSources').append(source);
  });
  if (finale.recoverySites?.length) {
    const guide = document.createElement('div'), text = document.createElement('p'), button = document.createElement('button'); guide.className = 'composer-recovery-guide';
    text.textContent = 'Unsealed inputs to revisit: ' + finale.recoverySites.map(site => site.label + ' at ' + (site.zoneLabel || site.zone)).join('; ') + '.';
    button.className = 'secondary'; button.textContent = 'Open the map'; button.onclick = () => { openPanel('map'); renderMap(); }; guide.append(text, button); $('mixSources').append(guide);
  }
  $('mixChannels').replaceChildren();
  for (const action of ACTIONS) { const row = document.createElement('div'); row.className = 'mix-channel'; row.id = 'mixChannel' + action; const label = document.createElement('span'), track = document.createElement('div'), fill = document.createElement('i'), value = document.createElement('b'); label.textContent = action; track.append(fill); row.append(label, track, value); $('mixChannels').append(row); }
  $('distributionChoices').replaceChildren();
  for (const option of finale.distributions) { const card = document.createElement('div'); card.className = 'distribution'; const text = document.createElement('p'), button = document.createElement('button'); text.id = 'distributionReason' + option.id; button.id = 'finish' + option.id; button.textContent = option.label; button.onclick = () => { act({ kind: 'finish', distribution: option.id }); if (run.phase === 'victory') closePanel(); }; card.append(text, button); $('distributionChoices').append(card); }
  updateComposer();
}
function updateComposer() {
  const finale = projection.finale;
  SIGNALS.forEach((signal, index) => { const value = $('weightValue' + index), range = $('mixWeight' + index), share = finale.shares?.[index]; if (value) value.textContent = run.mixWeights[index] + ' units · ' + (Number.isFinite(share) ? `≈${(100 * share).toFixed(2)}%${share < (finale.minimumShare || 0) - 1e-10 ? ' · below minimum' : ''}` : 'share unrecorded'); if (range) range.value = run.mixWeights[index]; });
  ACTIONS.forEach((a, i) => { const row = $('mixChannel' + a); if (!row) return; const n = run.mixture[i] || 0; row.querySelector('i').style.width = n * 100 + '%'; row.querySelector('b').textContent = (n * 100).toFixed(1) + '%'; row.classList.toggle('good', Math.abs(n - 1 / 3) <= .08); });
  const ready = run.flags.includes('signals_balanced'), basis = composerBasisMessage(finale);
  $('mixStatus').textContent = `${basis || (ready ? 'Three balanced channels.' : 'Bring each channel within 8 percentage points of 33.3% and keep the required pilot shares.')} Heat ${run.heat} · strain ${Math.round(run.strain)}/35. ${finale.reasons.join(' ')}`;
  $('mixStatus').classList.toggle('infeasible', finale.mixFeasibility?.possible === false);
  $('keepMixButton').disabled = !ready || finale.mixFeasibility?.possible !== true;
  for (const option of finale.distributions) { const button = $('finish' + option.id), text = $('distributionReason' + option.id); if (button) button.disabled = !option.eligible; if (text) text.textContent = option.eligible ? 'The crossing is ready for this choice.' : option.missing.join(' · '); }
}

function showEnding() {
  closePanel(); clearInput(); mode = 'ending'; paused = false; epilogue = false; visible('pause', false); visible('hud', false); visible('ending', true);
  const archive = (run.ending?.distribution || run.distribution) === 'archive';
  const namedArchive = archive && (run.ending?.flags || run.flags || []).includes('original_records');
  $('endingEyebrow').textContent = namedArchive ? 'THE LAST CROSSING / NAMES AND VOICES' : archive ? 'THE LAST CROSSING / PEOPLE AND RECORD' : 'THE LAST CROSSING / EVERYONE HOME';
  $('endingTitle').replaceChildren(); const a = document.createTextNode(archive ? namedArchive ? 'The names\n' : 'The record\n' : 'You made\n'), em = document.createElement('em'); em.textContent = archive ? 'came with us.' : 'room.'; $('endingTitle').append(a, document.createElement('br'), em);
  $('endingText').textContent = archive ? namedArchive ? 'The crossing carried the people and the records that made them more than a number. The observatory’s last light has witnesses.' : 'The crossing carried the people and their chosen record. What that record leaves out remains part of its history.' : 'The people crossed. Some things stayed behind, but nobody was mistaken for freight. In the refuge, a light stays on for every name.';
  $('endingText').textContent += '\n\n' + sealedEndingDetails(run);
  $('endingStats').replaceChildren();
  const values = [[String(MISSIONS.length).padStart(2, '0'), 'CHAPTERS REMEMBERED'], [String(run.facts.length), 'FACTS KEPT'], [String(run.agreements.length), 'PROMISES RECORDED'], [formatTime(run.ending?.engagedSeconds ?? engaged()), 'ENGAGED JOURNEY']];
  for (const [value, label] of values) { const e = document.createElement('div'), b = document.createElement('b'); b.textContent = value; e.append(b, document.createTextNode(label)); $('endingStats').append(e); }
  save();
}
function refreshHud() {
  projection = Campaign.view(run);
  const mission = projection.mission, report = FIXTURES.find(f => f.id === mission.report);
  $('chapterText').textContent = `${String(mission.index + 1).padStart(2, '0')} / ${ZONES.find(z => z.id === mission.zone)?.name || 'THE OBSERVATORY'}`;
  $('objectiveTitle').textContent = epilogue ? 'The afterglow' : mission.title;
  $('objectiveSummary').textContent = epilogue ? 'The crossing is complete. Walk the refuge, revisit the people, and ask what they remember.' : mission.ready ? `All objectives complete. Go to the gold “${report.label}” marker on the district map (J), then press E there.` : mission.summary;
  const goals = $('objectiveGoals'); goals.replaceChildren();
  if (!epilogue) for (const goal of projection.objectives) { const row = document.createElement('div'); row.className = 'goal' + (goal.complete ? ' done' : ''); const check = document.createElement('i'), text = document.createElement('span'); check.textContent = goal.complete ? '✓' : '○'; text.textContent = goal.text; row.append(check, text); goals.append(row); }
  const count = projection.objectives.filter(g => g.complete).length;
  $('chapterFill').style.width = ((run.mission + count / Math.max(1, projection.objectives.length)) / MISSIONS.length * 100) + '%';
  $('chapterCount').textContent = `${String(run.mission + 1).padStart(2, '0')} OF ${String(MISSIONS.length).padStart(2, '0')} CHAPTERS · ${count}/${projection.objectives.length} OBJECTIVES`;
  $('healthText').textContent = Math.ceil(run.health); $('healthFill').style.width = run.health + '%'; $('healthFill').style.background = run.health < 30 ? '#e39781' : '#c1e5cf';
  $('heatText').textContent = run.heat; $('strainText').textContent = Math.round(run.strain);
  $('carryText').textContent = projection.carried ? 'CARRYING ' + projection.carried.replaceAll('_', ' ').toUpperCase() + ' · G TO PUT DOWN' : (run.surgeSeconds > 0 ? `OVERDRIVE ${Math.ceil(run.surgeSeconds)}s · FASTER DRIFT / PULSE` : 'HANDS FREE');
  const target = nearestInteraction(); visible('interaction', mode === 'playing' && !panel && !paused && !!target);
  if (target) $('interactionLabel').textContent = target.kind === 'npc' ? `Talk to ${target.name || target.label}` : `${target.label} · ${target.kind === 'item' ? 'carry' : target.kind === 'socket' ? 'install part' : target.kind === 'evidence' ? 'read record' : target.kind === 'console' ? 'operate / program' : target.kind === 'attune' ? 'attune signal' : projection.mission.ready ? 'continue the crossing' : 'review progress'}`;
  const program = run.program, movingCarrier = run.motions.find(m => m.id.startsWith('crossing_'));
  visible('programBanner', (!!program || !!movingCarrier) && mode === 'playing' && !panel && !paused);
  if (movingCarrier) { $('programTitle').textContent = ({ crossing_first: 'FIRST CRADLE / OUTBOUND', crossing_return: 'EMPTY CARRIER / RETURNING', crossing_second: 'SECOND CRADLE / OUTBOUND' })[movingCarrier.id]; $('programStatus').textContent = Math.round(100 * movingCarrier.elapsed / movingCarrier.seconds) + '% of physical travel · arrival interlock pending'; }
  if (program && !movingCarrier) { $('programTitle').textContent = `${program.provenance === 'local' ? 'LOCAL WORK ORDER' : 'MACHINE PROGRAM'} / ${program.cursor + 1} OF ${program.operations.length}`; $('programStatus').textContent = program.waiting ? 'Waiting for the machine’s physical condition.' : 'The next operation is ready.'; }
  const zone = ZONES.find(z => Math.hypot(run.pos.x - z.x, run.pos.z - z.z) <= z.radius);
  $('districtText').textContent = zone?.name.toUpperCase() || 'THE THREADS BETWEEN';
  renderPending();
  if (panel === 'dialogue') renderDialogue(); if (panel === 'workbench') renderWorkbench(); if (panel === 'attune') renderTuning(); if (panel === 'composer') updateComposer();
}
function drawMap(canvas, large = false) {
  const ctx = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
  const scale = Math.min(width, height) / 165, ox = width / 2, oz = height / 2;
  const at = p => [ox + p.x * scale, oz + p.z * scale]; ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createRadialGradient(ox, oz, 1, ox, oz, Math.min(width, height) * .49); gradient.addColorStop(0, '#264d4722'); gradient.addColorStop(1, '#0b222a00'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 1; ctx.strokeStyle = '#8db49b25'; ctx.beginPath(); ctx.arc(ox, oz, Math.min(width, height) * .45, 0, Math.PI * 2); ctx.stroke();
  for (const route of ROUTES.filter(route => route.flag && run.flags.includes(route.flag))) {
    const [ax, az] = at(route.a), [bx, bz] = at(route.b); ctx.strokeStyle = '#e0c98c'; ctx.lineWidth = large ? 2.5 : 1.5; ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
  }
  ctx.lineWidth = 1;
  const home = projection.map.find(z => z.id === 'refuge') || projection.map[0];
  for (const zone of projection.map) {
    const [x, z] = at(zone), [hx, hz] = at(home); ctx.strokeStyle = zone.unlocked ? '#9cbf9b80' : '#65897b30'; ctx.setLineDash(zone.unlocked ? [] : [3, 4]); ctx.beginPath(); ctx.moveTo(hx, hz); ctx.lineTo(x, z); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, z, zone.radius * scale * .6, 0, Math.PI * 2); ctx.fillStyle = zone.unlocked ? '#507b6d50' : '#2c514838'; ctx.fill(); ctx.strokeStyle = zone.id === projection.mission.zone ? '#dfc88d' : '#8dae8355'; ctx.stroke();
    ctx.fillStyle = zone.unlocked ? '#c3d7b5' : '#6f9181'; ctx.beginPath(); ctx.arc(x, z, large ? 3 : 2, 0, Math.PI * 2); ctx.fill();
    if (large) { ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(zone.name, x, z + zone.radius * scale * .6 + 18); }
  }
  for (const f of projection.fixtures.filter(f => f.active && (f.kind === 'report' ? projection.mission.ready && run.phase !== 'victory' : !f.complete))) {
    const [x, z] = at(f); ctx.fillStyle = f.kind === 'report' ? '#edcf86' : '#a8d8b8'; ctx.beginPath(); ctx.arc(x, z, large ? 3 : 1.5, 0, Math.PI * 2); ctx.fill();
    if (large && f.kind === 'report') {
      ctx.save(); ctx.font = '12px sans-serif';
      const boxWidth = 164, lines = []; let line = '';
      for (const word of f.label.split(' ')) { const next = line ? line + ' ' + word : word; if (line && ctx.measureText(next).width > boxWidth - 20) { lines.push(line); line = word; } else line = next; }
      if (line) lines.push(line);
      const boxHeight = 46 + lines.length * 14, left = x < ox, bx = left ? 12 : width - boxWidth - 12, by = Math.max(14, Math.min(height - boxHeight - 14, z - boxHeight / 2));
      const edgeX = left ? bx + boxWidth : bx;
      ctx.strokeStyle = '#d8bd7b99'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(edgeX + (left ? 8 : -8), z); ctx.lineTo(edgeX, by + boxHeight / 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#0a202bf5'; ctx.fillRect(bx, by, boxWidth, boxHeight); ctx.strokeStyle = '#d8bd7b66'; ctx.strokeRect(bx, by, boxWidth, boxHeight);
      ctx.textAlign = 'left'; ctx.fillStyle = '#d8bd8b'; ctx.font = '8px sans-serif'; ctx.fillText('CHAPTER READY', bx + 10, by + 14);
      ctx.fillStyle = '#edcf86'; ctx.font = '12px sans-serif'; lines.forEach((text, index) => ctx.fillText(text, bx + 10, by + 30 + index * 14));
      ctx.fillStyle = '#a9c0aa'; ctx.font = '8px sans-serif'; ctx.fillText('WALK THERE · E', bx + 10, by + boxHeight - 10); ctx.restore();
    }
  }
  const [px, pz] = at(run.pos); ctx.save(); ctx.translate(px, pz); ctx.rotate(-player.rotation.y); ctx.fillStyle = '#f3d39b'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-3.4, 4); ctx.lineTo(3.4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#83a68f'; ctx.font = (large ? '10' : '8') + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', ox, large ? 15 : 13);
}
function renderMap() {
  drawMap($('mapCanvas'), true); const legend = $('mapLegend'); legend.replaceChildren(); legend.className = 'map-legend';
  for (const z of projection.map) { const e = document.createElement('span'); e.textContent = `${z.id === projection.mission.zone ? '◇ ' : '○ '}${z.name} · ${z.unlocked ? 'awake' : 'dormant'}`; legend.append(e); }
}
function waypointPlacement(bounds, previous, anchorY, allowed) {
  const nearby = previous.filter(p => bounds.left < p.right + 8 && bounds.right > p.left - 8);
  const choices = [anchorY, ...nearby.flatMap(p => [Math.min(anchorY - 8, p.top - 8), Math.max(anchorY + 8, p.bottom + 8) + bounds.height])];
  choices.sort((a, b) => Math.abs(a - anchorY) - Math.abs(b - anchorY));
  for (const y of choices) {
    const rect = { left: bounds.left, right: bounds.right, top: y - bounds.height, bottom: y, height: bounds.height };
    if (allowed(y) && !nearby.some(p => rect.top < p.bottom + 8 && rect.bottom > p.top - 8)) return rect;
  }
  return null;
}
function refreshWaypoints() {
  const targets = [];
  if (mode === 'playing' && !panel && !paused) {
    const eligible = projection.fixtures.filter(f => f.active && (!f.complete || f.kind === 'console' || f.kind === 'report') && (f.kind !== 'report' || projection.mission.ready) && (!projection.mission.ready || f.kind === 'report'));
    eligible.sort((a, b) => Math.hypot(run.pos.x - a.x, run.pos.z - a.z) - Math.hypot(run.pos.x - b.x, run.pos.z - b.z));
    for (const f of eligible.slice(0, 3)) targets.push({ ...f, subtitle: f.kind === 'report' ? 'CHAPTER COMPLETE · REPORT HERE' : f.kind === 'item' ? 'CARRY / INSTALL' : f.kind === 'evidence' ? 'READ THE RECORD' : f.kind === 'socket' ? 'INSTALL PART' : f.status });
    const nearest = nearestInteraction();
    if (nearest?.kind === 'npc') targets.push({ ...nearest, label: nearest.name, subtitle: dutyLabel(nearest.duty || nearest.role), y: 3.2 });
  }
  const focusedTarget = targets[0];
  const keyed = new Map(targets.map(target => [target.kind === 'npc' ? 'person:' + target.person : 'fixture:' + target.id, target]));
  for (const label of waypointLabels) {
    if (!keyed.has(label.key)) { label.key = null; label.target = null; label.metrics = null; label.element.style.display = 'none'; }
  }
  for (const [key, target] of keyed) {
    const label = waypointLabels.find(label => label.key === key) || waypointLabels.find(label => label.key === null);
    label.key = key; label.target = target;
    const quiet = target !== focusedTarget || (target.kind === 'console' && Math.hypot(run.pos.x - target.x, run.pos.z - target.z) > 8) || ((target.kind === 'report' || target.kind === 'console') && nearestInteraction()?.id === target.id);
    if (label.element.classList.contains('waypoint-quiet') !== quiet) { label.element.classList.toggle('waypoint-quiet', quiet); label.metrics = null; }
    label.element.setAttribute('aria-label', target.label);
    if (label.name.textContent !== target.label || label.hint.textContent !== (target.subtitle || '')) {
      label.name.textContent = target.label; label.hint.textContent = target.subtitle || ''; label.metrics = null;
    }
  }
}
function updateWaypoints() {
  hudCrewName = null;
  const inspectingBaffles = mode === 'playing' && !panel && !paused && nearestInteraction()?.id === 'gallery_console';
  document.body.classList.toggle('baffle-inspecting', inspectingBaffles);
  if (mode !== 'playing' || panel || paused || document.hidden || worldTableAvailable() || inspectingBaffles) {
    for (const label of waypointLabels) label.element.style.display = 'none';
    return;
  }
  const viewport = innerWidth + ':' + innerHeight;
  if (viewport !== waypointViewport) { waypointViewport = viewport; for (const label of waypointLabels) label.metrics = null; }
  const measure = waypointLabels.filter(label => label.target && !label.metrics);
  for (const { element, pin } of measure) {
    element.style.display = 'block'; element.style.visibility = 'hidden'; element.style.width = '';
    element.style.left = '0px'; element.style.top = '0px'; pin.style.transform = '';
  }
  for (const label of measure) {
    const bounds = label.element.getBoundingClientRect(), text = label.name.getBoundingClientRect(), pin = label.pin.getBoundingClientRect();
    label.metrics = bounds.width && bounds.height ? { width: bounds.width, height: bounds.height, left: Math.min(bounds.left, text.left), right: Math.max(bounds.right, text.right), pinCenter: pin.top + pin.height / 2 - bounds.top } : null;
  }
  const positions = [];
  for (const { element, pin, target, metrics } of waypointLabels) {
    if (!target || !metrics) { element.style.display = 'none'; continue; }
    const p = new THREE.Vector3(target.x, (world.heightAt(target.x, target.z, run) ?? 0) + (target.y || 2.7), target.z).project(camera);
    if (p.z < -1 || p.z >= 1 || Math.abs(p.x) > .98 || Math.abs(p.y) > .95) { element.style.display = 'none'; continue; }
    const x = (p.x * .5 + .5) * innerWidth, anchorY = (-p.y * .5 + .5) * innerHeight;
    const blocked = (xx, yy) => yy < 95 || yy > innerHeight - 180 || (xx < 325 && yy < 475) || (Math.abs(xx - innerWidth / 2) < 250 && yy < 190);
    if (blocked(x, anchorY)) { element.style.display = 'none'; continue; }
    const bounds = { left: x + metrics.left, right: x + metrics.right, height: metrics.height };
    const rect = waypointPlacement(bounds, positions, anchorY,
      y => !blocked(x, y) && y >= bounds.height && y <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth);
    if (!rect) { element.style.display = 'none'; continue; }
    element.style.width = metrics.width + 'px'; element.style.left = x + 'px'; element.style.top = rect.bottom + 'px';
    pin.style.transform = `translateY(${anchorY - rect.top - metrics.pinCenter}px) rotate(45deg)`;
    const leaderTop = anchorY < rect.top ? anchorY - rect.top : rect.height;
    const leaderHeight = Math.max(0, rect.top - anchorY, anchorY - rect.bottom);
    element.style.setProperty('--waypoint-leader-top', leaderTop + 'px'); element.style.setProperty('--waypoint-leader-height', leaderHeight + 'px');
    positions.push(rect); element.style.display = 'block'; element.style.visibility = '';
    if (target.kind === 'npc' && !element.classList.contains('waypoint-quiet')) hudCrewName = scene.getObjectByName('crew_name_' + target.person);
  }
}
function damage(amount) {
  if (hurtCooldown > 0 || epilogue) return; run.health = Math.max(0, run.health - amount); hurtCooldown = 1.3; soundCue('hurt', { position: { ...run.pos } });
  $('hud').classList.remove('damage-flash'); void $('hud').offsetWidth; $('hud').classList.add('damage-flash');
  if (run.health <= 0) { act({ kind: 'recover' }); velocity.set(0, 0); falling = 0; player.position.y = 1.2; hurtCooldown = 3; }
}
function cameraGroundForward() {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  return new THREE.Vector2(direction.x, direction.z).normalize();
}
function pulse() {
  if (pulseCooldown > 0 || run.energy < 20) return;
  pulseCooldown = run.surgeSeconds > 0 ? .65 : 1.3; run.energy -= 20; pulseVisual = 1; pulseRing.position.set(run.pos.x, (world.heightAt(run.pos.x, run.pos.z, run) ?? 0) + .14, run.pos.z); world.pulse(run.pos, 0xc5e5be); soundCue('pulse', { position: { ...run.pos } });
  const direction = velocity.length() > .3 ? velocity.clone().normalize() : cameraGroundForward(); velocity.addScaledVector(direction, 8);
}
function move(dt) {
  pulseCooldown = Math.max(0, pulseCooldown - dt); hurtCooldown = Math.max(0, hurtCooldown - dt); run.energy = Math.min(100, run.energy + dt * (run.surgeSeconds > 0 ? 30 : 18));
  if (run.surgeSeconds > 0 && velocity.length() > .3) run.surgeSeconds = Math.max(0, run.surgeSeconds - dt);
  const forward = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0), side = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const facing = cameraGroundForward();
  const target = new THREE.Vector2(facing.x * forward - facing.y * side, facing.y * forward + facing.x * side);
  if (target.lengthSq()) target.normalize().multiplyScalar(run.surgeSeconds > 0 ? keys.has('shift') ? 16 : 13.3 : keys.has('shift') ? 11.5 : 8.7);
  velocity.lerp(target, 1 - Math.exp(-dt * 7));
  const step = slideBridgeMove(run.pos, { x: run.pos.x + velocity.x * dt, z: run.pos.z + velocity.y * dt }, run.flags);
  if (!world.blockedAt(step.x, step.z, run)) {
    run.pos.x = step.x; run.pos.z = step.z;
    if (step.normal) { const outward = velocity.x * step.normal.x + velocity.y * step.normal.z; if (outward > 0) { velocity.x -= step.normal.x * outward; velocity.y -= step.normal.z * outward; } }
  } else { velocity.multiplyScalar(.15); }
  const floor = world.heightAt(run.pos.x, run.pos.z, run);
  if (floor === null || floor === undefined) {
    falling += dt * 16; player.position.y -= falling * dt;
    if (player.position.y < -8) { if (epilogue) { run.pos = { ...run.checkpoint }; run.health = 100; } else act({ kind: 'recover' }); clearInput(); falling = 0; player.position.y = 1.2; hurtCooldown = 3; }
  } else { falling = 0; player.position.y = floor + 1.2 + Math.sin(simTime * 3) * .1; }
  if (velocity.length() > .3) { const angle = Math.atan2(-velocity.x, -velocity.y); player.rotation.y += Math.atan2(Math.sin(angle - player.rotation.y), Math.cos(angle - player.rotation.y)) * Math.min(1, dt * 10); }
}
function frameBucket() { return { count: 0, elapsedMs: 0, maxMs: 0, over33Ms: 0, over50Ms: 0, over100Ms: 0 }; }
function recordFrameInterval(raw) {
  const active = started && mode === 'playing' && !paused && !document.hidden;
  if (active && frameIntervalActive && Number.isFinite(raw) && raw >= 0) {
    const ms = raw * 1000;
    for (const bucket of [stats.frameIntervals.playing, ...(run.pending ? [stats.frameIntervals.inference] : [])]) {
      bucket.count++; bucket.elapsedMs += ms; bucket.maxMs = Math.max(bucket.maxMs, ms);
      bucket.over33Ms += ms > 33 ? 1 : 0; bucket.over50Ms += ms > 50 ? 1 : 0; bucket.over100Ms += ms > 100 ? 1 : 0;
    }
  }
  frameIntervalActive = active;
}
function countTime(raw) {
  if (!started || mode !== 'playing') return;
  if (document.hidden) return;
  if (raw > 2) { stats.stalledFrames++; return; }
  const dt = Math.max(0, raw), idle = performance.now() - lastInput > 60000;
  const category = paused ? 'pause' : idle ? 'idle' : panel && run.pending ? 'inference' : panel ? 'deliberation' : 'exploration'; run.clock[category] += dt;
}
function animateSignal() {
  if (panel !== 'attune') return;
  const canvas = $('signalCanvas'), ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 3; i++) { ctx.beginPath(); for (let x = 0; x < canvas.width; x++) { const envelope = Math.sin(x / canvas.width * Math.PI), local = scope === 'broad' ? 1 : Math.exp(-Math.pow((x - 480) / 150, 2)); const y = 47 + Math.sin(x * .032 + realTime * 1.6 + i * .7) * (7 + strength * 25) * envelope * local + i * 3; ctx.lineTo(x, y); } ctx.strokeStyle = ['#bed8ae', '#8dbfa8', '#d4bd86'][i]; ctx.globalAlpha = .35 + i * .18; ctx.stroke(); } ctx.globalAlpha = 1;
}
function publishDiagnostics() {
  const state = { version: '3.0.0', audio: soundscape.debugSnapshot(), edition, nativeAvailable: localMind.available, mode, paused, panel, activePerson, activeMachine, activeAttune, yaw, zoom, fps, healthStatus, interaction: nearestInteraction(), projection: { mission: projection.mission, objectives: projection.objectives, fixtures: projection.fixtures, people: projection.people, machines: projection.machines, terms: projection.terms, finale: projection.finale, returnLine: projection.returnLine }, run: Campaign.snapshot(run, { diagnostics: true }), timing: { engaged: engaged(), categories: run.clock }, render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length }, stats };
  $('world').dataset.state = JSON.stringify(state);
}
function animate() {
  requestAnimationFrame(animate); const raw = timer.getDelta(), dt = Math.min(raw, .04); realTime += raw; countTime(raw); recordFrameInterval(raw);
  const playing = mode === 'playing' && !paused && !document.hidden;
  if (playing) {
    simTime += dt;
    if (!panel) move(dt); else { velocity.set(0, 0); pulseCooldown = Math.max(0, pulseCooldown - dt); hurtCooldown = Math.max(0, hurtCooldown - dt); run.energy = Math.min(100, run.energy + dt * 18); }
    if (!epilogue) { physicsAccumulator += dt; if (physicsAccumulator >= .1) { const elapsed = Math.min(1, physicsAccumulator); physicsAccumulator = 0; const next = Campaign.act(run, { kind: 'tick', seconds: elapsed }); if (next.state !== run) commit(next, { quiet: true, noSave: true }); } }
  } else if (mode === 'title' || mode === 'ending') simTime += dt * .4;
  world.update(simTime, playing ? dt : 0, run, projection);
  player.position.x = run.pos.x; player.position.z = run.pos.z;
  if (falling === 0) { const floor = world.heightAt(run.pos.x, run.pos.z, run); if (floor !== null && floor !== undefined) player.position.y = floor + 1.2 + Math.sin(simTime * 3) * .1; }
  updateMindClearance();
  player.visible = mode !== 'title'; mindVisual.visible = !worldTableAvailable(); groundRing.visible = player.visible && falling === 0 && !worldTableAvailable();
  groundRing.position.set(run.pos.x, (world.heightAt(run.pos.x, run.pos.z, run) ?? 0) + .035, run.pos.z); groundRing.scale.setScalar(1 + Math.sin(simTime * 3) * .07);
  playerLight.position.copy(player.position).add(new THREE.Vector3(0, 2, 0));
  wings.forEach((wing, index) => wing.rotation.z = (index ? 1 : -1) * (.08 + Math.sin(simTime * 6) * .085)); halo.rotation.z = simTime * .5;
  carriedVisual.visible = !!projection.carried; carriedVisual.rotation.y = simTime;
  if (pulseVisual > 0) { pulseVisual = Math.max(0, pulseVisual - dt * 1.5); pulseRing.scale.setScalar(.5 + (1 - pulseVisual) * 8); pulseRing.material.opacity = pulseVisual * .75; }
  if (mode === 'title') { const a = .6 + Math.sin(realTime * .025) * .15; camera.position.lerp(new THREE.Vector3(Math.sin(a) * 84, 52, Math.cos(a) * 84), .025); camera.lookAt(0, 2, 0); }
  else if (mode === 'ending') { camera.position.lerp(new THREE.Vector3(Math.sin(realTime * .05) * 30, 24, 58 + Math.cos(realTime * .05) * 30), .015); camera.lookAt(0, 3, 58); }
  else { const focus = cinematic && cinematic.until > simTime && !panel ? world.motionFocus?.(run, cinematic.motion) : null; if (focus) { const p = focus.target, offset = focus.offset || { x: 12, y: 10, z: 14 }; camera.position.lerp(new THREE.Vector3(p.x + offset.x, p.y + offset.y, p.z + offset.z), 1 - Math.exp(-dt * 4)); camera.lookAt(p.x, p.y, p.z); } else { camera.position.lerp(new THREE.Vector3(run.pos.x + Math.sin(yaw) * zoom, Math.max(1, player.position.y) + zoom * .72, run.pos.z + Math.cos(yaw) * zoom), 1 - Math.exp(-dt * 5)); camera.lookAt(run.pos.x, player.position.y + .4, run.pos.z); } }
  if (realTime > toastUntil) visible('toast', false); if (realTime > factUntil) visible('factToast', false);
  if (realTime - lastHud > .2) { lastHud = realTime; refreshHud(); drawMap($('minimap')); refreshWaypoints(); if (panel === 'map') renderMap(); }
  camera.updateMatrixWorld();
  renderWorldTable(playing ? dt : 0);
  world.updateRoofOcclusion(camera, player.visible && mindVisual.visible ? mindVisual : null, dt);
  updateWaypoints();
  if (mode === 'playing' && !panel && !paused && hudCrewName) hudCrewName.visible = false;
  updateSoundscape();
  animateSignal(); if (panel === 'workbench' && machinePanel()?.chamber) chamberDisplay?.render(simTime); renderer.render(scene, camera); stats.frames++; frameCount++; fpsTime += raw;
  if (fpsTime >= 1) { fps = frameCount / fpsTime; fpsTime = 0; frameCount = 0; }
  if (realTime - lastDiagnostics > .4) { lastDiagnostics = realTime; publishDiagnostics(); }
  if (started && mode === 'playing' && realTime - lastSave > 5) { lastSave = realTime; save(); }
}
$('startButton').onclick = () => begin();
$('continueButton').onclick = () => begin(true);
$('brand').onclick = event => { event.preventDefault(); if (mode === 'playing') { if (panel) closePanel(); togglePause(true); } };
$('soundButton').onclick = toggleSound;
$('pauseButton').onclick = () => { if (panel) closePanel(); togglePause(); };
$('resumeButton').onclick = () => togglePause(false);
$('restartButton').onclick = () => begin(); $('replayButton').onclick = () => begin();
$('returnTitleButton').onclick = toTitle;
$('helpButton').onclick = () => openHelp();
$('helpPlayButton').onclick = closePanel; $('closeHelp').onclick = closePanel; $('skipWelcome').onclick = closePanel;
$('mapButton').onclick = () => { if (mode === 'playing' && !paused) openPanel('map'); };
$('journalButton').onclick = () => { if (mode === 'playing' && !paused) openPanel('journal'); };
for (const id of ['closeDialogue', 'closeWorkbench', 'closeAttune', 'closeJournal', 'closeMap', 'closeComposer']) $(id).onclick = closePanel;
$('closeDialogue').onclick = () => { const id = dialogueReturnMachine; dialogueReturnMachine = null; closePanel(); const f = FIXTURES.find(f => f.id === id); if (f && mode === 'playing' && Math.hypot(run.pos.x-f.x,run.pos.z-f.z)<=3.4) openMachine(f); };
$('askButton').onclick = () => { const text = $('dialogueInput').value.trim(); if (!text) return message('Describe the record or agreement you need.'); submitMind('conversation', text, activePerson); $('dialogueInput').value = ''; };
$('briefButton').onclick = authoredBrief;
$('cancelDialogue').onclick = cancelPending; $('cancelPlan').onclick = cancelPending;
$('interpretButton').onclick = () => { const text = $('planInput').value.trim(); if (!text) return message('Describe the sequence you want the machine to carry out.'); submitMind('work_order', text, activeMachine); };
$('clearPlanButton').onclick = () => { workOrderFeedback = null; $('planInput').value = ''; if (run.pending) cancelPending(); else { act({ kind: 'cancelPending' }, { quiet: true }); visible('planPreview', false); } };
$('executeButton').onclick = () => { const id = run.preview?.id; if (!id) return; act({ kind: 'confirm', proposalId: id }); if (run.program || run.motions.length) closePanel({ automatic: true }); };
$('programOpen').onclick = () => { const f = FIXTURES.find(f => f.id === (run.program?.console || run.motions.find(m => m.id.startsWith('crossing_'))?.source)); if (f) openMachine(f); };
document.querySelectorAll('[data-bias]').forEach(button => button.onclick = () => { bias = button.dataset.bias; renderTuning(); });
$('focusedButton').onclick = () => { scope = 'focused'; renderTuning(); }; $('broadButton').onclick = () => { scope = 'broad'; renderTuning(); };
$('strengthInput').step = '0.1';
$('strengthInput').oninput = () => { strength = Number($('strengthInput').value) / 100; renderTuning(); };
$('captureButton').onclick = () => submitMind('thought', $('signalInput').value || 'Help us bring everyone home.', activeAttune, { bias, scope, strength });
$('referenceButton').onclick = referenceCapture;
$('openChamberButton').onclick = () => { const f = FIXTURES.find(f => f.id === activeAttune); if (f) openMachine(f); };
for (const [id, tab] of [['factsTab', 'facts'], ['choicesTab', 'choices'], ['signalsTab', 'signals']]) $(id).onclick = () => { journalTab = tab; renderJournal(); };
$('keepMixButton').onclick = () => { if (run.flags.includes('signals_balanced')) { $('distributionChoices').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); message('The blend is balanced. Review the manifest and choose what the crossing will carry.'); } };
$('epilogueButton').onclick = () => { act({ kind: 'epilogue' }, { quiet: true }); mode = 'playing'; epilogue = true; visible('ending', false); visible('hud', true); clearInput(); touch(); message('The afterglow. The crossing is sealed; its people and records can still be heard.', 10); };

window.addEventListener('error', event => { stats.errors.push(event.message); $('errorBanner').textContent = event.message; visible('errorBanner', true); });
window.addEventListener('unhandledrejection', event => { stats.errors.push(String(event.reason)); $('errorBanner').textContent = String(event.reason); visible('errorBanner', true); });
document.addEventListener('keydown', event => {
  const key = event.key.toLowerCase(); touch();
  if (key === 'escape') { event.preventDefault(); if (paused) { togglePause(false); return; } if (worldTableSession) { exitWorldTable(); clearInput(); return; } if (panel === 'dialogue' && dialogueReturnMachine) $('closeDialogue').onclick(); else if (panel) closePanel(); else togglePause(); return; }
  if (key === 'm') {
    const tag = document.activeElement?.tagName, typing = tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT' && document.activeElement.type !== 'range';
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || typing) return;
    event.preventDefault(); toggleSound(); return;
  }
  if (panel === 'help') {
    if (key === 'tab' && !event.ctrlKey && !event.metaKey) {
      const controls = [...$('help').querySelectorAll('button:not(:disabled), a[href], summary, input:not(:disabled), select:not(:disabled)')].filter(control => !control.closest('.hidden') && control.getClientRects().length);
      const index = controls.indexOf(document.activeElement), last = controls.length - 1;
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === last) {
        event.preventDefault(); controls[event.shiftKey ? last : 0]?.focus();
      }
    } else if (key === 'h' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); if (!event.repeat) closePanel(); }
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (started && !paused && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) unlockSound();
  if ((key === ' ' || key === 'enter') && ['BUTTON', 'SUMMARY'].includes(document.activeElement?.tagName)) return;
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
  if (event.repeat) { if (mode === 'playing' && !paused && !panel) keys.add(key); return; }
  if (key === 'h' && !paused) { openHelp(); return; }
  if (mode !== 'playing' || paused) return;
  if (key === 'j') { panel === 'map' ? closePanel() : openPanel('map'); return; }
  if (key === 'l') { panel === 'journal' ? closePanel() : openPanel('journal'); return; }
  if (panel) return; keys.add(key);
  if (key === 'e') interact(); if (key === 'r') radio(); if (key === ' ') pulse(); if (key === 'g' && !epilogue) { if (falling > 0 || world.heightAt(run.pos.x, run.pos.z, run) == null) message('Return to stable ground before putting down an essential part.'); else act({ kind: 'drop' }); }
});
document.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
document.addEventListener('pointerdown', () => { touch(); if (started && !paused && !document.hidden) unlockSound(); }); document.addEventListener('input', touch);
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
  clearInput(); frameIntervalActive = false;
  if (document.hidden) { hiddenAt = performance.now(); save(); }
  else { if (hiddenAt !== null && started && mode === 'playing') run.clock.pause += (performance.now() - hiddenAt) / 1000; hiddenAt = null; timer.getDelta(); touch(); }
  updateSoundscape(true);
});
$('world').addEventListener('pointerdown', event => { if (panel || paused) return; startWorldCellGesture(event); dragging = true; pointerX = event.clientX; $('world').setPointerCapture(event.pointerId); touch(); });
$('world').addEventListener('pointermove', event => { moveWorldCellGesture(event); if (event.buttons === 0) { dragging = false; hoverWorldCell(event); } if (!dragging || panel || paused) return; yaw -= (event.clientX - pointerX) * .006; pointerX = event.clientX; touch(); });
$('world').addEventListener('lostpointercapture', () => { dragging = false; worldTableGesture = null; });
$('world').addEventListener('pointerup', event => { dragging = false; endWorldCellGesture(event); }); $('world').addEventListener('pointercancel', clearInput);
$('world').addEventListener('wheel', event => { event.preventDefault(); if (!panel) { zoom = THREE.MathUtils.clamp(zoom + event.deltaY * .02, 15, 40); touch(); } }, { passive: false });
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); chamberDisplay?.resize(); });
$('worldTableClose').onclick = () => { exitWorldTable(); clearInput(); };
$('worldTableRecords').onclick = () => { exitWorldTable(); openPanel('workbench'); lastWorkbenchKey = ''; renderWorkbench(); };
$('worldTableFrame').onclick = () => { if (!worldTableSession) return; if (worldTableSession.restore) { yaw = worldTableSession.restore.yaw; zoom = worldTableSession.restore.zoom; worldTableSession.restore = null; } else { worldTableSession.restore = { yaw, zoom }; yaw = -.27; zoom = 15; } worldTableUiKey = ''; touch(); };
$('worldTableCommit').onclick = () => { if (!worldTableEditable()) return; const before = worldTableMachine().chamber; act({ kind: 'manual', console: 'choir_voice_signal', operation: { op: 'trigger', trigger: 'chamber_voice_commit' } }); const after = worldTableMachine().chamber; if (!before.complete && after.complete) message('Voice routing sealed. Its route and recorded inputs are kept.'); else if (before.index !== after.index) message(`Phase ${before.index + 1} committed. Phase ${after.index + 1} is now current; inspect its dry trace before committing.`); };
$('worldTracePause').onclick = () => { if (!worldTrace.plan?.segments.length || worldTrace.done) return; worldTrace.paused = !worldTrace.paused; renderWorldTable(); };
$('worldTraceNext').onclick = () => { if (!worldTrace.plan?.segments.length || worldTrace.done) return; worldTrace.paused = true; if (worldTrace.index < worldTrace.plan.segments.length - 1) { worldTrace.index++; worldTrace.elapsed = WORLD_TRACE_LEG_SECONDS / 2; } else { worldTrace.elapsed = WORLD_TRACE_LEG_SECONDS; worldTrace.done = true; } renderWorldTable(); };
window.addEventListener('pagehide', () => { save(); soundscape.update({ hidden: true, paused: true }); });
window.threadwake = { version: '3.0.0', snapshot: () => structuredClone({ run: Campaign.snapshot(run, { diagnostics: true }), mode, panel, paused, projection, stats }) };
try { saved = JSON.parse(localStorage.getItem(saveKey)); if (saved?.version !== 3) saved = null; visible('continueButton', !!saved); } catch {}
document.querySelectorAll('[data-audio-channel]').forEach(input => input.oninput = () => { soundPreferences[input.dataset.audioChannel] = Number(input.value) / 100; updateSound(true); unlockSound(); });
document.querySelectorAll('[data-audio-mute]').forEach(button => button.onclick = toggleSound);
updateSound();
if (browserEdition) $('authoredCalibration').open = true;
else {
  document.title = 'Threadwake — Local Model Edition';
  $('titleEdition').textContent = 'LOCAL MODEL EDITION · THE LAST CROSSING';
  $('titleEditionNote').textContent = 'Local inference and temporary activation edits are available through this machine. Captures retain their measured receipts.';
  $('titleMeta').textContent = 'A 3D STORY OF REPAIR · EXPERIMENTAL LOCAL MODELS · PUBLIC ALPHA';
}
camera.position.set(65, 75, 105); player.position.set(run.pos.x, 1.2, run.pos.z); renderTuning(); publishDiagnostics(); animate();
document.dispatchEvent(new Event('threadwake:ready'));
