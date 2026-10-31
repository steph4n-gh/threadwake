import assert from 'node:assert/strict';
import { createSoundscape } from './web/audio.js';

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; }
  event(kind, value, at, extra) { this.value = value; this.events.push({ kind, value, at, extra }); }
  setValueAtTime(value, at) { this.event('set', value, at); }
  setTargetAtTime(value, at, constant) { this.event('target', value, at, constant); }
  linearRampToValueAtTime(value, at) { this.event('linear', value, at); }
  exponentialRampToValueAtTime(value, at) { this.event('exponential', value, at); }
}
class Node {
  constructor(context, kind) {
    this.context = context; this.kind = kind; this.connections = []; this.disconnected = false;
    for (const key of ['gain', 'pan', 'frequency', 'Q', 'playbackRate', 'detune', 'delayTime']) this[key] = new Parameter();
    context.created.push(this);
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; this.disconnected = true; }
  setPeriodicWave(wave) { this.wave = wave; }
  start(at = 0, offset = 0) { assert.equal(this.startedAt, undefined); this.startedAt = at; this.offset = offset; }
  stop(at = this.context.currentTime) { this.stoppedAt = at; }
}
class Context {
  static made = 0;
  constructor({ sampleRate = 44100 } = {}) {
    Context.made++; this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'suspended';
    this.created = []; this.destination = {}; this.resumeCalls = 0; this.suspendCalls = 0; this.closeCalls = 0;
  }
  createGain() { return new Node(this, 'gain'); }
  createStereoPanner() { return new Node(this, 'pan'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createConvolver() { return new Node(this, 'convolver'); }
  createDelay() { return new Node(this, 'delay'); }
  createOscillator() { return new Node(this, 'oscillator'); }
  createBufferSource() { return new Node(this, 'buffer-source'); }
  createPeriodicWave(real, imaginary) { return { real, imaginary }; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: channel => data[channel] };
  }
  async decodeAudioData(bytes) { return virtualStem(this, new Uint8Array(bytes)[0] ? 192 : 191.98); }
  async resume() { this.resumeCalls++; this.state = 'running'; }
  async suspend() { this.suspendCalls++; this.state = 'suspended'; }
  async close() { this.closeCalls++; this.state = 'closed'; }
  advance(seconds) {
    this.currentTime += seconds;
    for (const node of this.created) if (!node.ended && node.stoppedAt !== undefined && node.stoppedAt <= this.currentTime) {
      node.ended = true; node.onended?.();
    }
  }
}
// Metadata-only buffers prove scheduling contracts here, not decoded audio quality.
const virtualStem = (context, seconds = 192) => ({ numberOfChannels: 2, sampleRate: context.sampleRate,
  length: Math.round(seconds * context.sampleRate), duration: seconds });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const ready = async (context = new Context()) => {
  const engine = createSoundscape({ context, loadAudio: async () => virtualStem(context) });
  await engine.unlock(); await flush(); return { engine, context };
};
const checks = [];
let originalConstructor = globalThis.AudioContext, originalFetch = globalThis.fetch;
try {
  globalThis.AudioContext = Context;
  {
    const initial = Context.made;
    const engine = createSoundscape({ loadAudio: async (_, context) => virtualStem(context) });
    engine.update({ position: { x: 10, z: 3 }, hidden: false }); engine.setMix({ music: .4 }); engine.setMuted(true);
    assert.equal(engine.cue('chapter'), false); assert.equal(Context.made, initial);
    await Promise.all([engine.unlock(), engine.unlock(), engine.unlock()]); await flush();
    assert.equal(Context.made, initial + 1); assert.equal(engine.debugSnapshot().music.sources, 2);
    assert.equal(engine.debugSnapshot().levels.master.target, 0);
    engine.setMuted(false); await engine.unlock(); assert.equal(Context.made, initial + 1);
    engine.dispose(); assert.equal(engine.debugSnapshot().nodes, 0);
    checks.push('No context/network work before unlock; concurrent/repeated unlock uses one context and two music sources; controls remain callable while locked.');
  }
  {
    const { engine, context } = await ready();
    const stems = context.created.filter(node => node.kind === 'buffer-source' && node.buffer?.duration === 192);
    assert.equal(stems.length, 2); assert.equal(stems[0].startedAt, stems[1].startedAt); assert.equal(stems[0].offset, 0);
    assert(stems.every(node => node.loop && node.loopStart === 0 && node.loopEnd === 192));
    assert.equal(engine.debugSnapshot().music.decodedBytes, 135475200);
    context.advance(193); assert.equal(engine.debugSnapshot().music.phase, (193 - stems[0].startedAt) % 192);
    engine.dispose(); assert.equal(context.closeCalls, 0);
    checks.push('Both exact192-second stems share the same scheduled start/offset/period and135475200-byte budget; borrowed context is not closed.');
  }
  {
    const context = new Context();
    const engine = createSoundscape({ context, loadAudio: async name => virtualStem(context, name === 'foundation' ? 191.98 : 192) });
    await engine.unlock(); await flush();
    assert.equal(engine.debugSnapshot().music.status, 'failed'); assert.equal(engine.debugSnapshot().music.sources, 0);
    assert(engine.cue('pickup')); engine.dispose();
    checks.push('A191.98/192-second injected mismatch starts neither stem; failed music leaves interaction sound available.');
  }
  {
    const requests = [];
    globalThis.fetch = async url => { requests.push(String(url)); return { ok: true, arrayBuffer: async () => new Uint8Array([String(url).endsWith('.mp3') ? 1 : 0]).buffer }; };
    const context = new Context(), engine = createSoundscape({ context });
    await engine.unlock(); await flush();
    assert.equal(engine.debugSnapshot().music.status, 'ready'); assert.equal(requests.length, 4);
    assert(engine.debugSnapshot().music.formats.every(item => item.format === 'mp3'));
    engine.dispose();
    checks.push('Invalid-duration Ogg decode falls through to exact-duration MP3 before source creation.');
  }
  {
    let aborted = false;
    globalThis.fetch = (url, { signal }) => String(url).includes('foundation') ? Promise.resolve({ ok: false, status: 404 })
      : new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted fixture')); }, { once: true }));
    const context = new Context(), engine = createSoundscape({ context });
    await engine.unlock(); await flush();
    assert.equal(engine.debugSnapshot().music.status, 'failed'); assert(aborted);
    assert.equal(engine.debugSnapshot().music.sources, 0); engine.dispose();
    checks.push('Terminal failure aborts a pending sibling fetch; its cleared request timer cannot leave an unbounded orphan fetch.');
  }
  {
    const { engine, context } = await ready();
    engine.setMix({ master: 9, effects: -3, music: NaN });
    assert.equal(engine.debugSnapshot().mix.master, 1); assert.equal(engine.debugSnapshot().mix.effects, 0); assert.equal(engine.debugSnapshot().mix.music, .85);
    engine.setMix({ effects: 1 });
    for (const kind of ['chapter', 'victory', 'pulse', 'installed', 'signal', 'hurt']) engine.cue(kind, { action: 'SHELTER' });
    const busy = engine.debugSnapshot(); assert(busy.voices.active <= 12); assert(busy.voices.dropped > 0);
    const created = context.created.length;
    for (let i = 0; i < 200; i++) engine.update({ speed: 8.7, wind: .3 });
    assert.equal(context.created.length, created);
    context.advance(8); assert.equal(engine.debugSnapshot().voices.active, 0);
    const after = engine.debugSnapshot().nodes;
    assert(engine.cue('chamber-turn')); context.advance(3); assert.equal(engine.debugSnapshot().nodes, after);
    engine.dispose(); assert.equal(engine.debugSnapshot().continuousSources, 0); assert.equal(engine.debugSnapshot().nodes, 0);
    checks.push('Mix inputs clamp; cue bursts cap12 voices; frame updates allocate no sources; stopped transient nodes return to baseline and disposal empties all owned nodes.');
  }
  {
    const { engine, context } = await ready();
    engine.update({ position: { x: 0, z: 0 }, yaw: 0, emitters: [{ id: 'pump', kind: 'machine', position: { x: 5, z: 0 }, active: true }] });
    const right = engine.debugSnapshot().emitters.find(item => item.id === 'pump'); assert(right.pan.target > 0);
    engine.update({ yaw: Math.PI });
    const left = engine.debugSnapshot().emitters.find(item => item.id === 'pump'); assert(left.pan.target < 0);
    engine.update({ position: { x: -30, z: 0 } });
    const far = engine.debugSnapshot().emitters.find(item => item.id === 'pump'); assert(far.gain.target < right.gain.target);
    engine.update({ emitters: [] }); assert(engine.debugSnapshot().emitters.every(item => item.gain.target === 0));
    const count = context.created.length; engine.update({ paused: true }); assert.equal(engine.cue('chapter'), false);
    engine.update({ hidden: true }); await new Promise(resolve => setTimeout(resolve, 125));
    assert.equal(context.suspendCalls, 1); engine.update({ hidden: false }); assert.equal(context.state, 'suspended');
    await engine.unlock(); assert.equal(context.state, 'running'); assert.equal(context.created.length, count);
    engine.dispose();
    checks.push('Emitter bearings rotate with camera and attenuate with distance; missing emitters silence; pause suppresses cues; hidden suspends and next gesture resumes without rebuilding.');
  }
  {
    const context = new Context(); context.startRendering = () => {};
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const engine = createSoundscape({ context, loadAudio: async () => pending });
    await engine.unlock(); assert.equal(context.resumeCalls, 0);
    engine.dispose(); release(virtualStem(context)); await flush();
    assert.equal(engine.debugSnapshot().music.sources, 0); assert.equal(engine.debugSnapshot().nodes, 0); assert.equal(context.closeCalls, 0);
    checks.push('Offline borrowed context receives no resume/close calls; late decoded assets after disposal cannot create sources.');
  }
  console.log(JSON.stringify({ pass: true, scope: 'WebAudio control/lifecycle mocks, not rendered audio or listening qualification.', checks }, null, 2));
} finally {
  globalThis.AudioContext = originalConstructor; globalThis.fetch = originalFetch;
}
