const LOOP_SECONDS = 192;
const MAX_VOICES = 12;
const MAX_MUSIC_BYTES = 150_000_000;
const BANDS = ['BRIDGE', 'SHELTER', 'SURGE'];
const MOTIFS = {
  marin: { notes: [66, 64, 73, 69], durations: [.15, .15, .22, .4], instrument: 'felt' },
  vale: { notes: [57, 64, 62, 61], durations: [.34, .28, .34, .44], instrument: 'warm' },
  iona: { notes: [69, 74, 73, 76], durations: [.14, .14, .3, .18], instrument: 'glass' },
  mara: { notes: [73, 71, 66, 64], durations: [.28, .24, .34, .44], instrument: 'felt' },
};
const INSTRUMENTS = {
  felt: { attack: .014, partials: [[1, 1], [2, .19], [3, .055], [4.012, .018]], decay: 1.25 },
  glass: { attack: .025, partials: [[1, 1], [2.003, .23], [3.997, .085], [6.01, .018]], decay: 1.8 },
  warm: { attack: .055, partials: [[1, 1], [2, .13], [3, .035]], decay: 1.55 },
};
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const midi = note => 440 * 2 ** ((note - 69) / 12);

// Supplying a context/loader lets an offline render exercise this exact graph.
// The game supplies neither: its context and network work begin only in unlock().
export function createSoundscape({ context: suppliedContext = null, loadAudio = null } = {}) {
  let context = null, graph = null, disposed = false, muted = false, unlockPromise = null;
  let musicPromise = null, musicEpoch = null, musicStatus = 'idle', musicError = null;
  let decodedBytes = 0, musicFormats = [], musicBuffers = null, suspendTimer = null, assetTimer = null;
  const assetAbort = new AbortController();
  let peakVoices = 0, droppedVoices = 0, nextCompanionAt = 0, nextDangerAt = 0, nextSignalAt = 6, nextPendingAt = 0;
  let randomState = 0x54aead17;
  const nodes = new Set(), voices = new Set(), continuous = new Set(), musicSources = [];
  const targets = new Map(), cooldowns = new Map(), cueCounts = {};
  const mix = { master: .85, music: .85, ambience: .7, effects: .9 };
  let state = { position: { x: 0, z: 0 }, yaw: 0, zone: 'dock', wind: .2, strain: 0, health: 100,
    speed: 0, pending: false, paused: false, hidden: false, completed: 0,
    signalBands: { BRIDGE: 0, SHELTER: 0, SURGE: 0 }, emitters: [] };
  const offline = suppliedContext && typeof suppliedContext.startRendering === 'function';
  const random = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296; };
  const remember = node => { nodes.add(node); return node; };
  const gain = value => { const node = remember(context.createGain()); node.gain.value = value; return node; };
  const pan = value => { const node = remember(context.createStereoPanner()); node.pan.value = value; return node; };
  const filter = (type, frequency, q = .6) => {
    const node = remember(context.createBiquadFilter()); node.type = type; node.frequency.value = frequency; node.Q.value = q; return node;
  };

  function smooth(parameter, value, seconds = .15) {
    if (!context || !Number.isFinite(value) || Math.abs((targets.get(parameter) ?? Infinity) - value) < .0001) return;
    targets.set(parameter, value);
    parameter.setTargetAtTime(value, context.currentTime, seconds);
  }

  function disconnect(node) {
    try { node.disconnect(); } catch {}
    nodes.delete(node);
  }

  function noiseBuffer() {
    const rate = 22050, buffer = context.createBuffer(1, rate * 8, rate), data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + (random() * 2 - 1) * .035) / 1.018;
      data[i] = brown * 1.5 + (random() * 2 - 1) * .35;
    }
    // A short zero-slope edge keeps the reusable texture continuous at its loop.
    const seam = Math.round(rate * .06);
    for (let i = 0; i < seam; i++) {
      const blend = .5 - .5 * Math.cos(Math.PI * i / (seam - 1));
      data[i] *= blend;
      data[data.length - seam + i] *= 1 - blend;
    }
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value));
    for (let i = 0; i < data.length; i++) data[i] *= .8 / Math.max(peak, .8);
    return buffer;
  }

  function roomImpulse() {
    const length = Math.ceil(context.sampleRate * 1.6), buffer = context.createBuffer(2, length, context.sampleRate);
    let energy = 0;
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < length; i++) {
        low = low * .72 + (random() * 2 - 1) * .28;
        const t = i / context.sampleRate;
        data[i] = t < .012 ? 0 : low * Math.exp(-t * 4.8) * Math.min(1, (t - .012) / .035);
        energy += data[i] ** 2;
      }
    }
    const scale = Math.sqrt(.16 / Math.max(energy, 1e-9));
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] *= scale;
    }
    return buffer;
  }

  function texture(buffer, type, frequency, rate, offset) {
    const source = remember(context.createBufferSource()), tone = filter(type, frequency), level = gain(0), stereo = pan(0);
    source.buffer = buffer; source.loop = true; source.playbackRate.value = rate;
    source.connect(tone).connect(level).connect(stereo).connect(graph.ambience);
    source.start(context.currentTime, offset); continuous.add(source);
    return { source, tone, level, stereo };
  }

  function buildGraph() {
    graph = { master: gain(0), music: gain(0), ambience: gain(0), effects: gain(0), room: gain(.16), roomInput: gain(1),
      foundation: gain(0), filigree: gain(0), musicTone: filter('lowpass', 12000, .55) };
    graph.master.connect(context.destination);
    graph.music.connect(graph.musicTone).connect(graph.master);
    graph.ambience.connect(graph.master); graph.effects.connect(graph.master);
    graph.foundation.connect(graph.music); graph.filigree.connect(graph.music);
    graph.effects.connect(graph.roomInput);
    const ambienceSend = gain(.18); graph.ambience.connect(ambienceSend).connect(graph.roomInput);
    const convolver = remember(context.createConvolver()); convolver.normalize = false; convolver.buffer = roomImpulse();
    const roomTone = filter('lowpass', 4200, .5);
    graph.roomInput.connect(convolver).connect(roomTone).connect(graph.room).connect(graph.master);
    for (const [seconds, level, bearing] of [[.028, .055, -.6], [.051, .035, .65], [.089, .023, -.2]]) {
      const delay = remember(context.createDelay(.2)); delay.delayTime.value = seconds;
      const reflection = gain(level), stereo = pan(bearing);
      graph.roomInput.connect(delay).connect(reflection).connect(stereo).connect(graph.master);
    }
    graph.noise = noiseBuffer();
    graph.sea = texture(graph.noise, 'lowpass', 420, .77, 1.7);
    graph.air = texture(graph.noise, 'bandpass', 1150, 1.13, 3.1);
    graph.rustle = texture(graph.noise, 'bandpass', 1700, 1.37, .3);
    const real = new Float32Array([0, 0, 0, 0, 0]), imaginary = new Float32Array([0, 1, .25, .075, .025]);
    const humWave = context.createPeriodicWave(real, imaginary, { disableNormalization: false });
    graph.humWave = humWave;
    graph.hornWave = context.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, .42, .22, .085, .04]), { disableNormalization: false });
    graph.emitters = Array.from({ length: 3 }, () => {
      const source = remember(context.createOscillator()), tone = filter('lowpass', 650), level = gain(0), stereo = pan(0);
      source.setPeriodicWave(humWave); source.frequency.value = 110;
      source.connect(tone).connect(level).connect(stereo).connect(graph.ambience);
      source.start(); continuous.add(source);
      return { source, tone, level, stereo, id: null, distance: null };
    });
  }

  function validateStem(buffer) {
    if (buffer.numberOfChannels !== 2 || buffer.sampleRate !== context.sampleRate || buffer.length !== Math.round(LOOP_SECONDS * context.sampleRate)) {
      throw new Error('Music must decode to exactly 192 seconds of stereo at the context sample rate.');
    }
    if (buffer.length * buffer.numberOfChannels * 4 * 2 > MAX_MUSIC_BYTES) throw new Error('Music exceeds the 150 MB decoded budget.');
    return buffer;
  }

  async function decodeStem(name) {
    const failures = [];
    for (const extension of ['ogg', 'mp3']) {
      try {
        const response = await fetch(new URL(`./assets/audio/${name}.${extension}`, import.meta.url), { signal: assetAbort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = validateStem(await context.decodeAudioData(await response.arrayBuffer()));
        musicFormats.push({ name, format: extension });
        return buffer;
      } catch (error) { if (disposed || assetAbort.signal.aborted) throw error; failures.push(`${extension}: ${error.message}`); }
    }
    throw new Error(`${name} (${failures.join('; ')})`);
  }

  function loadMusic() {
    if (musicPromise || disposed) return;
    musicStatus = 'loading';
    if (!loadAudio) assetTimer = setTimeout(() => assetAbort.abort(), 15000);
    musicPromise = (async () => {
      try {
        if (context.sampleRate > 48000) throw new Error('Music decoding requires an audio context at 48 kHz or below.');
        const loader = loadAudio || decodeStem;
        const buffers = await Promise.all(['foundation', 'filigree'].map(name => loader(name, context)));
        if (disposed) return;
        buffers.forEach(validateStem);
        const bytes = buffers.reduce((sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0);
        musicBuffers = buffers; decodedBytes = bytes;
        musicEpoch = context.currentTime + .08;
        buffers.forEach((buffer, index) => {
          const source = remember(context.createBufferSource()); source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = LOOP_SECONDS;
          source.connect(index === 0 ? graph.foundation : graph.filigree); source.start(musicEpoch, 0); musicSources.push(source);
        });
        musicStatus = 'ready'; applyMix();
      } catch (error) {
        assetAbort.abort();
        for (const source of musicSources) { try { source.stop(); } catch {} disconnect(source); }
        musicSources.length = 0; musicBuffers = null; decodedBytes = 0;
        if (!disposed) { musicStatus = 'failed'; musicError = String(error.message || error).slice(0, 400); }
      } finally { if (assetTimer !== null) { clearTimeout(assetTimer); assetTimer = null; } }
    })();
  }

  function applyMix() {
    if (!graph || disposed) return;
    const quiet = state.paused ? .42 : 1;
    const danger = Math.max(clamp((state.strain - 45) / 55), clamp((35 - state.health) / 35));
    smooth(graph.master.gain, muted || state.hidden ? 0 : mix.master * .68, state.hidden ? .008 : .035);
    smooth(graph.music.gain, mix.music * quiet, .35);
    smooth(graph.ambience.gain, mix.ambience * (state.paused ? .12 : 1), .2);
    smooth(graph.effects.gain, mix.effects, .08);
    smooth(graph.foundation.gain, musicStatus === 'ready' ? .95 : 0, 1.8);
    smooth(graph.filigree.gain, musicStatus === 'ready' ? (.75 + .35 * state.completed + .15 * state.signalBands.SHELTER) * (1 - danger * .4) : 0, 2);
    smooth(graph.musicTone.frequency, 12000 - danger * 4300, .6);
    const indoors = /refuge|index|choir/.test(state.zone);
    smooth(graph.room.gain, indoors ? .20 : .12, .8);
  }

  function bearing(position) {
    const dx = (position?.x ?? state.position.x) - state.position.x, dz = (position?.z ?? state.position.z) - state.position.z;
    const distance = Math.hypot(dx, dz);
    return { distance, pan: distance > .1 ? clamp((dx * Math.cos(state.yaw) - dz * Math.sin(state.yaw)) / distance, -.85, .85) : 0,
      attenuation: 1 / (1 + (distance / 13) ** 2) };
  }

  function updateEnvironment() {
    const now = context.currentTime, wind = state.wind, pace = clamp(state.speed / 18);
    const shore = /dock|garden|terrace/.test(state.zone) ? 1 : .48;
    const swell = .70 + .18 * Math.sin(now * .19) + .10 * Math.sin(now * .071 + 1.2);
    const environmental = kind => state.emitters.filter(emitter => emitter.kind === kind && emitter.active > 0)
      .map(emitter => ({ ...emitter, ...bearing(emitter.position) })).sort((a, b) => a.distance - b.distance)[0];
    const water = environmental('water'), air = environmental('wind');
    smooth(graph.sea.level.gain, .080 * (water ? water.attenuation * water.active * water.gain : shore) * swell, .7);
    smooth(graph.sea.stereo.pan, water ? water.pan : Math.sin(state.yaw + 1.1) * .42, .25);
    smooth(graph.air.level.gain, (.030 + wind * .100) * (air ? air.attenuation * air.active * air.gain : 1), .4);
    smooth(graph.air.tone.frequency, 850 + wind * 1300 + Math.sin(now * .13) * 100, .5);
    smooth(graph.air.stereo.pan, air ? air.pan : Math.sin(state.yaw - .6) * .6, .25);
    smooth(graph.rustle.level.gain, pace * (.075 + wind * .025), .14);
    smooth(graph.rustle.tone.frequency, 1100 + pace * 1100, .17);
    smooth(graph.rustle.stereo.pan, Math.sin(now * .8) * .1, .2);
    const candidates = state.emitters.filter(emitter => emitter.kind === 'machine' || emitter.kind === 'signal')
      .map(emitter => ({ ...emitter, ...bearing(emitter.position) }))
      .filter(emitter => emitter.distance < 45 && emitter.active > 0)
      .sort((a, b) => a.distance - b.distance).slice(0, 3);
    const selected = new Set(candidates.map(emitter => emitter.id));
    for (const slot of graph.emitters) if (!selected.has(slot.id)) slot.id = null;
    for (const emitter of candidates) {
      const slot = graph.emitters.find(item => item.id === emitter.id) || graph.emitters.find(item => item.id === null);
      if (!slot) continue;
      if (slot.id !== emitter.id) {
        slot.id = emitter.id;
        const hash = [...emitter.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
        smooth(slot.source.frequency, midi([33, 40, 42][hash % 3]), .6);
      }
      slot.distance = emitter.distance;
      smooth(slot.level.gain, .012 * emitter.active * emitter.gain * emitter.attenuation * (.94 + .06 * Math.sin(now * 1.3)), .2);
      smooth(slot.stereo.pan, emitter.pan, .16);
      smooth(slot.tone.frequency, 380 + emitter.active * 550, .3);
    }
    for (const slot of graph.emitters) if (slot.id === null) { smooth(slot.level.gain, 0, .25); slot.distance = null; }
  }

  function note(noteNumber, at, duration = 1, instrument = 'felt', level = .03, position = null) {
    if (!graph || disposed || muted || state.hidden || state.paused || voices.size >= MAX_VOICES) {
      if (graph && voices.size >= MAX_VOICES) droppedVoices++;
      return false;
    }
    const recipe = INSTRUMENTS[instrument], location = bearing(position), owned = [], sources = [];
    const own = node => { owned.push(node); return node; };
    const stereo = own(pan(location.pan)); stereo.connect(graph.effects);
    const amplitude = clamp(level, 0, .035) * location.attenuation;
    const total = recipe.partials.reduce((sum, [, weight]) => sum + weight, 0);
    const voice = { sources, owned, endsAt: at + duration * recipe.decay + .05 };
    voices.add(voice); peakVoices = Math.max(peakVoices, voices.size);
    const contact = instrument === 'felt';
    let remaining = recipe.partials.length + (contact ? 1 : 0);
    const ended = () => { if (--remaining > 0) return; owned.forEach(disconnect); voices.delete(voice); };
    recipe.partials.forEach(([ratio, weight], index) => {
      const source = own(remember(context.createOscillator())), envelope = own(gain(0));
      const finish = at + Math.max(.16, duration * recipe.decay / (1 + index * .29));
      source.type = 'sine'; source.frequency.value = midi(noteNumber) * ratio;
      source.detune.value = (random() - .5) * 1.8;
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(amplitude * weight / total * (contact ? .88 : 1), at + recipe.attack);
      envelope.gain.exponentialRampToValueAtTime(Math.max(.000001, amplitude * weight / total * .001), finish);
      envelope.gain.linearRampToValueAtTime(0, finish + .035);
      source.connect(envelope).connect(stereo); source.onended = ended;
      source.start(at); source.stop(finish + .04); sources.push(source);
    });
    if (contact) {
      const source = own(remember(context.createBufferSource())), tone = own(filter('bandpass', 1800, .5)), envelope = own(gain(0));
      source.buffer = graph.noise; source.playbackRate.value = 1.6;
      envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(amplitude * .12, at + .007);
      envelope.gain.exponentialRampToValueAtTime(.000001, at + .075);
      source.connect(tone).connect(envelope).connect(stereo); source.onended = ended;
      source.start(at, random() * 5); source.stop(at + .085); sources.push(source);
    }
    return true;
  }

  function phrase(notes, { instrument = 'felt', step = .11, duration = .8, level = .03, position = null } = {}) {
    const start = context.currentTime + .018;
    return notes.reduce((played, pitch, index) => note(pitch, start + index * step, duration, instrument, level, position) || played, false);
  }

  function textureCue(kind, at, duration = .2, level = .022, position = null) {
    if (!graph || disposed || muted || state.hidden || state.paused || voices.size >= MAX_VOICES) {
      if (graph && voices.size >= MAX_VOICES) droppedVoices++;
      return false;
    }
    const location = bearing(position), source = remember(context.createBufferSource());
    const frequency = { paper: 1450, relay: 1900, ratchet: 700, valve: 360, flow: 800, clunk: 240 }[kind] || 1000;
    const tone = filter(kind === 'paper' ? 'highpass' : 'bandpass', frequency, kind === 'ratchet' ? 1.8 : .65);
    const soften = filter('lowpass', kind === 'paper' ? 4700 : 2800, .5), envelope = gain(0), stereo = pan(location.pan);
    const owned = [source, tone, soften, envelope, stereo], voice = { sources: [source], owned, endsAt: at + duration + .03 };
    voices.add(voice); peakVoices = Math.max(peakVoices, voices.size);
    source.buffer = graph.noise; source.playbackRate.value = kind === 'paper' ? 1.25 : .9;
    source.connect(tone).connect(soften).connect(envelope).connect(stereo).connect(graph.effects);
    const pulses = kind === 'ratchet' ? 3 : kind === 'relay' ? 2 : 1;
    const amplitude = clamp(level, 0, .035) * location.attenuation;
    for (let index = 0; index < pulses; index++) {
      const begin = at + index * duration / pulses, end = begin + duration / pulses - .006;
      envelope.gain.setValueAtTime(0, begin);
      envelope.gain.linearRampToValueAtTime(amplitude, begin + (kind === 'paper' || kind === 'flow' ? .025 : .003));
      envelope.gain.exponentialRampToValueAtTime(.000001, end);
    }
    envelope.gain.linearRampToValueAtTime(0, at + duration);
    source.onended = () => { owned.forEach(disconnect); voices.delete(voice); };
    source.start(at, random() * 4); source.stop(at + duration + .03);
    return true;
  }

  function mechanism(horn, seconds, position) {
    if (!graph || voices.size >= MAX_VOICES) { droppedVoices++; return false; }
    const duration = horn ? 1.45 : clamp(Number(seconds) || 1, .65, 2.4), at = context.currentTime + .018;
    const location = bearing(position), source = remember(context.createOscillator());
    const tone = filter('lowpass', horn ? 850 : 350, .55), envelope = gain(0), stereo = pan(location.pan);
    const owned = [source, tone, envelope, stereo], voice = { sources: [source], owned, endsAt: at + duration + .04 };
    voices.add(voice); peakVoices = Math.max(peakVoices, voices.size);
    source.setPeriodicWave(horn ? graph.hornWave : graph.humWave);
    source.frequency.setValueAtTime(horn ? 110 : 55, at);
    source.frequency.exponentialRampToValueAtTime(horn ? 110.6 : 82.4069, at + duration * .65);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime((horn ? .035 : .025) * location.attenuation, at + .09);
    envelope.gain.setValueAtTime((horn ? .030 : .022) * location.attenuation, at + duration * .65);
    envelope.gain.exponentialRampToValueAtTime(.000001, at + duration);
    source.connect(tone).connect(envelope).connect(stereo).connect(graph.effects);
    source.onended = () => { owned.forEach(disconnect); voices.delete(voice); };
    source.start(at); source.stop(at + duration + .04);
    return true;
  }

  function cue(kind, details = {}) {
    if (!context || disposed || muted || state.hidden || state.paused || (!offline && context.state !== 'running')) return false;
    const group = /control|route|chamber-turn/.test(kind) ? 'control' : /signal/.test(kind) ? 'signal' : kind;
    const wait = group === 'control' ? .10 : group === 'hurt' ? .7 : .22;
    if (context.currentTime < (cooldowns.get(group) ?? -1)) return false;
    cooldowns.set(group, context.currentTime + wait);
    const position = details.position;
    let played = false;
    switch (kind) {
      case 'fact':
        played = details.material === 'paper' ? textureCue('paper', context.currentTime + .015, .32, .030, position)
          : phrase([73, 76], { instrument: 'glass', step: .13, duration: .55, level: .014, position }); break;
      case 'pickup': played = phrase([64, 69], { duration: .5, level: .023, position }); break;
      case 'drop': played = textureCue('clunk', context.currentTime + .015, .2, .028, position); break;
      case 'installed':
        played = textureCue('clunk', context.currentTime + .015, .22, .030, position);
        played = phrase([57, 64, 69], { step: .10, duration: .9, level: .027, position }) || played; break;
      case 'control': played = textureCue(details.material === 'paper' ? 'paper' : 'relay', context.currentTime + .015, .16, .022, position); break;
      case 'route':
        played = textureCue('relay', context.currentTime + .015, .13, .025, position);
        played = phrase([49], { instrument: 'warm', duration: .36, level: .018, position }) || played; break;
      case 'chamber-turn':
        played = textureCue('ratchet', context.currentTime + .015, .14, .018, position);
        played = phrase([73], { instrument: 'glass', duration: .42, level: .012, position }) || played; break;
      case 'trigger':
        played = details.id === 'ignite_refuge' ? mechanism(true, 1.45, position)
          : textureCue(details.material === 'paper' ? 'paper' : 'valve', context.currentTime + .015, .28, .030, position); break;
      case 'motion': played = mechanism(false, details.seconds, position); break;
      case 'motion-complete': played = phrase([52, 57], { instrument: 'felt', step: .16, duration: .65, level: .026, position }); break;
      case 'agreement': played = phrase([64, 68, 69], { instrument: 'warm', step: .18, duration: 1.2, level: .029, position }); break;
      case 'signal': {
        const vector = details.vector || { [details.action]: 1 };
        const sum = BANDS.reduce((value, band) => value + clamp(vector[band]), 0);
        if (sum > 0) BANDS.forEach((band, index) => {
          const weight = clamp(vector[band]) / sum;
          if (weight > .015) played = note([57, 61, 64][index], context.currentTime + .02 + index * .12, 1.35, 'glass', .035 * weight, position) || played;
        });
        break;
      }
      case 'chamber-probe':
        played = textureCue('flow', context.currentTime + .015, .35, .020, position);
        played = phrase(details.pass === false ? [64, 61] : [69, 73], { instrument: 'glass', step: .23, duration: .65, level: .020, position }) || played; break;
      case 'chamber-commit':
        played = details.pass === false ? phrase([57, 56], { instrument: 'warm', step: .16, duration: .6, level: .021, position })
          : phrase(details.complete ? [57, 64, 69, 73] : [64, 73], { instrument: 'glass', step: .16, duration: 1, level: .026, position }); break;
      case 'interlock':
        played = textureCue(details.material === 'paper' ? 'paper' : 'relay', context.currentTime + .015, .23, .026, position);
        played = phrase([57], { instrument: 'warm', duration: .45, level: .016, position }) || played; break;
      case 'return-flow':
        played = textureCue('flow', context.currentTime + .015, .9, .032, position);
        played = phrase([45, 52, 61], { instrument: 'warm', step: .20, duration: 1.3, level: .020, position }) || played; break;
      case 'recover': played = phrase([54, 61, 69], { instrument: 'warm', step: .19, duration: 1.2, level: .029 }); break;
      case 'hurt': played = phrase([33, 40], { instrument: 'warm', step: .055, duration: .65, level: .035 }); break;
      case 'pulse': played = phrase([45, 57, 64], { instrument: 'glass', step: .055, duration: .9, level: .028 }); break;
      case 'chapter': played = phrase([57, 64, 69, 73, 76], { instrument: 'warm', step: .19, duration: 1.5, level: .033 }); break;
      case 'victory': played = phrase([45, 57, 64, 69, 73, 76, 81], { instrument: 'warm', step: .24, duration: 1.8, level: .035 }); break;
    }
    if (played) cueCounts[kind] = (cueCounts[kind] || 0) + 1;
    return played;
  }

  function companion(personId) {
    const motif = MOTIFS[personId];
    if (!motif || !context || disposed || muted || state.hidden || state.paused || context.currentTime < nextCompanionAt) return false;
    if (!offline && context.state !== 'running') return false;
    let at = context.currentTime + .025, played = false;
    motif.notes.forEach((pitch, index) => {
      played = note(pitch, at, .65 + motif.durations[index], motif.instrument, personId === 'mara' ? .025 : .030) || played;
      at += motif.durations[index];
    });
    nextCompanionAt = at + .25;
    if (played) cueCounts['companion:' + personId] = (cueCounts['companion:' + personId] || 0) + 1;
    return played;
  }

  function update(patch = {}) {
    if (disposed) return;
    const previousHidden = state.hidden;
    state = { ...state, ...patch, position: patch.position ? { x: Number(patch.position.x) || 0, z: Number(patch.position.z) || 0 } : state.position };
    for (const key of ['wind', 'completed']) state[key] = clamp(Number(state[key]));
    state.health = clamp(state.health, 0, 100); state.strain = clamp(state.strain, 0, 100); state.speed = clamp(state.speed, 0, 26);
    state.yaw = Number.isFinite(state.yaw) ? state.yaw : 0;
    state.zone = typeof state.zone === 'string' ? state.zone : 'dock';
    if (patch.signalBands) state.signalBands = Object.fromEntries(BANDS.map(band => [band, clamp(patch.signalBands[band])]));
    if (patch.emitters) state.emitters = patch.emitters.slice(0, 8).filter(emitter => typeof emitter.id === 'string' && emitter.position && Number.isFinite(emitter.position.x) && Number.isFinite(emitter.position.z))
      .map(emitter => ({ ...emitter, active: clamp(Number(emitter.active)), gain: emitter.gain === undefined ? 1 : clamp(emitter.gain) }));
    if (!graph) return;
    if (suspendTimer !== null && !state.hidden) { clearTimeout(suspendTimer); suspendTimer = null; }
    applyMix(); updateEnvironment();
    if (state.hidden && !previousHidden && !offline) {
      for (const voice of voices) for (const source of voice.sources) { try { source.stop(context.currentTime + .08); } catch {} }
      suspendTimer = setTimeout(() => { suspendTimer = null; if (!disposed && state.hidden && context.state === 'running') context.suspend().catch(() => {}); }, 110);
    }
    if (state.hidden || state.paused || muted || (!offline && context.state !== 'running')) return;
    const now = context.currentTime, danger = Math.max(clamp((state.strain - 45) / 55), clamp((35 - state.health) / 35));
    if (danger > .1 && now >= nextDangerAt) { note(42, now + .02, .75, 'warm', .018 * danger); nextDangerAt = now + 3.6 - danger * 1.3; }
    if (state.pending && now >= nextPendingAt) { phrase([69, 76], { instrument: 'felt', duration: .6, step: .25, level: .008 }); nextPendingAt = now + 5.5; }
    const total = BANDS.reduce((sum, band) => sum + state.signalBands[band], 0);
    if (total > 0 && now >= nextSignalAt) {
      BANDS.forEach((band, index) => { if (state.signalBands[band] > .02) note([57, 61, 64][index], now + .02 + index * .23, 1, 'glass', .009 * state.signalBands[band] / total); });
      nextSignalAt = now + 11 + random() * 4;
    }
  }

  async function unlock() {
    if (disposed) return false;
    if (unlockPromise) return unlockPromise;
    const work = (async () => {
      try {
        if (!context) {
          const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
          if (!suppliedContext && !Constructor) return false;
          context = suppliedContext || new Constructor({ latencyHint: 'interactive', sampleRate: 44100 });
          buildGraph();
        }
        if (!offline && state.hidden && context.state === 'running') await context.suspend();
        else if (!offline && context.state !== 'running' && !state.hidden) await context.resume();
        if (disposed) return false;
        applyMix(); updateEnvironment(); loadMusic();
        return offline || context.state === 'running';
      } catch (error) { musicError = String(error.message || error).slice(0, 400); return false; }
    })();
    unlockPromise = work;
    try { return await work; }
    finally { if (unlockPromise === work) unlockPromise = null; }
  }

  function setMuted(value) { muted = Boolean(value); applyMix(); }
  function setMix(patch = {}) {
    for (const key of Object.keys(mix)) if (Number.isFinite(patch[key])) mix[key] = clamp(patch[key]);
    applyMix(); return { ...mix };
  }
  function onVisibility() { update({ hidden: Boolean(globalThis.document?.hidden) }); }
  if (!offline) globalThis.document?.addEventListener('visibilitychange', onVisibility);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (suspendTimer !== null) clearTimeout(suspendTimer);
    if (assetTimer !== null) clearTimeout(assetTimer);
    assetAbort.abort();
    globalThis.document?.removeEventListener('visibilitychange', onVisibility);
    for (const source of [...continuous, ...musicSources, ...[...voices].flatMap(voice => voice.sources)]) {
      try { source.stop(); } catch {}
      source.onended = null;
    }
    for (const node of nodes) { try { node.disconnect(); } catch {} }
    nodes.clear(); voices.clear(); continuous.clear(); musicSources.length = 0;
    musicBuffers = null; decodedBytes = 0; targets.clear();
    graph = null;
    if (context && !suppliedContext && context.state !== 'closed') context.close().catch(() => {});
  }

  function debugSnapshot() {
    const param = value => value ? { value: value.value, target: targets.get(value) ?? value.value } : null;
    return {
      status: disposed ? 'disposed' : context ? 'unlocked' : 'locked', contextState: context?.state ?? null,
      sampleRate: context?.sampleRate ?? null, currentTime: context?.currentTime ?? 0, offline: Boolean(offline), muted, mix: { ...mix },
      music: { status: musicStatus, error: musicError, formats: [...musicFormats], sources: musicSources.length,
        startedAt: musicEpoch, offset: 0, loopEnd: LOOP_SECONDS,
        phase: musicEpoch === null ? null : Math.max(0, context.currentTime - musicEpoch) % LOOP_SECONDS,
        durations: musicBuffers?.map(buffer => buffer.duration) ?? [], decodedBytes },
      voices: { active: voices.size, peak: peakVoices, dropped: droppedVoices, limit: MAX_VOICES },
      continuousSources: continuous.size, nodes: nodes.size, cues: { ...cueCounts },
      levels: graph ? Object.fromEntries(['master', 'music', 'ambience', 'effects', 'foundation', 'filigree', 'room'].map(key => [key, param(graph[key].gain)])) : {},
      emitters: graph?.emitters.map(slot => ({ id: slot.id, distance: slot.distance, gain: param(slot.level.gain), pan: param(slot.stereo.pan) })) ?? [],
      state: { zone: state.zone, wind: state.wind, speed: state.speed, strain: state.strain, health: state.health, paused: state.paused, hidden: state.hidden,
        completed: state.completed, signalBands: { ...state.signalBands } },
    };
  }
  return { unlock, setMuted, setMix, update, cue, companion, dispose, debugSnapshot };
}
