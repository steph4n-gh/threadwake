export const ACTIONS = Object.freeze(['BRIDGE', 'SHELTER', 'SURGE']);
export const CHOIR_TARGETS = Object.freeze([1, 1, 2]);

const KINDS = ['archive', 'garden', 'choir'];
const INITIAL = { archive: [1, 0, 0], garden: [0, 0, 0], choir: [0, 1, 2] };

function copyBoard(board) {
  return { ...board, nodes: [...board.nodes], latched: [...board.latched] };
}

function validateBoard(board) {
  if (!board || !KINDS.includes(board.kind)) throw new TypeError('Unknown circuit board.');
  const maximum = board.kind === 'archive' ? 1 : 2;
  if (!Array.isArray(board.nodes) || board.nodes.length !== 3 ||
      !board.nodes.every(n => Number.isInteger(n) && n >= 0 && n <= maximum)) {
    throw new TypeError('A circuit needs three valid numeric receiver states.');
  }
  if (!Array.isArray(board.latched) || board.latched.length !== 3 ||
      !board.latched.every(n => typeof n === 'boolean')) {
    throw new TypeError('A circuit needs three latch states.');
  }
  if (!Number.isInteger(board.revision) || board.revision < 0 || board.revision > 1000000 ||
      !Number.isInteger(board.fractures) || board.fractures < 0 || board.fractures > 3 ||
      !Number.isInteger(board.stage) || board.stage < 0 || board.stage > 4 ||
      typeof board.complete !== 'boolean') throw new TypeError('Invalid circuit state.');
}

function targetsComplete(board) {
  if (board.kind === 'archive') return board.nodes.every(n => n === 1);
  if (board.kind === 'garden') return board.nodes[0] === 1 && board.nodes[1] === 2 && board.nodes[2] === 1;
  return board.complete;
}

function stageOf(board) {
  if (board.complete) return 3;
  if (board.kind === 'archive') return board.nodes[1] === 0 ? 0 : board.nodes[2] === 0 ? 1 : 2;
  if (board.kind === 'garden') return board.nodes[0] === 0 ? 0 : board.nodes[1] === 0 ? 1 : 2;
  return board.latched.every(Boolean) ? 2 : board.nodes.every((n, i) => n === CHOIR_TARGETS[i]) ? 1 : 0;
}

function progressOf(board) {
  if (board.complete) return 1;
  if (board.kind === 'archive') return board.nodes.filter(n => n === 1).length / 3;
  if (board.kind === 'garden') {
    return ((board.nodes[0] === 1 ? 1 : 0) + board.nodes[1] / 2 + (board.nodes[2] === 1 ? 1 : 0)) / 3;
  }
  return (board.nodes.filter((n, i) => n === CHOIR_TARGETS[i]).length + board.latched.filter(Boolean).length) / 7;
}

export function createBoard(kind) {
  if (!KINDS.includes(kind)) throw new TypeError('Unknown circuit board.');
  return {
    kind, revision: 0, stage: 0, complete: false,
    nodes: [...INITIAL[kind]], latched: [false, false, false], fractures: 0,
  };
}

export function boardContext(board, target, strain) {
  validateBoard(board);
  if (!Number.isInteger(target) || target < 0 || target > 2) throw new RangeError('Select receiver 0, 1, or 2.');
  if (!Number.isInteger(strain) || strain < 0 || strain > 100) throw new RangeError('Strain must be an integer from 0 to 100.');
  return { board: board.kind, stage: board.stage, target, nodes: [...board.nodes], strain, revision: board.revision };
}

function archiveReceiver(before, next, index, action) {
  if (index === 0) {
    if (action === 'SHELTER') next.nodes[0] = 1;
    if (action === 'SURGE') { next.nodes[0] = 0; return 1; }
  } else if (index === 1) {
    if (action === 'SURGE') next.nodes[1] = 1;
    if (action === 'SHELTER') next.nodes[1] = 0;
  } else {
    if (action === 'BRIDGE' && before.nodes[1] === 1) next.nodes[2] = 1;
    if (action === 'SURGE') { next.nodes[2] = 0; return before.nodes[2] === 1 ? 1 : 0; }
  }
  return 0;
}

function gardenReceiver(before, next, index, action) {
  if (index === 0) {
    if (action === 'BRIDGE') next.nodes[0] = 1;
    if (action === 'SURGE') { next.nodes[0] = 0; return before.nodes[0] === 1 ? 1 : 0; }
  } else if (index === 1) {
    if (action === 'SURGE') {
      if (before.nodes[0] === 1) next.nodes[1] = 1;
      else return 1;
    }
    if (action === 'SHELTER' && before.nodes[1] >= 1) next.nodes[1] = 2;
  } else {
    if (action === 'SURGE') { next.nodes[2] = 2; return 1; }
    if (action === 'SHELTER') next.nodes[2] = before.nodes[1] >= 1 ? 1 : 0;
  }
  return 0;
}

function unchanged(board, message) {
  return { board: copyBoard(board), changed: false, fractures: board.fractures, addedFractures: 0, damage: 0, message, progress: progressOf(board) };
}

export function applySignal(board, signal) {
  validateBoard(board);
  if (!signal || !ACTIONS.includes(signal.action)) throw new TypeError('Choose Bridge, Shelter, or Surge.');
  if (!['focused', 'broad'].includes(signal.scope)) throw new TypeError('Choose focused or broad routing.');
  if (!Number.isInteger(signal.target) || signal.target < 0 || signal.target > 2) throw new RangeError('Select receiver 0, 1, or 2.');
  if (board.kind === 'choir' && (!Number.isInteger(signal.beat) || signal.beat < 0 || signal.beat > 2)) {
    throw new RangeError('The reference beat must be 0, 1, or 2.');
  }
  if (board.complete) return unchanged(board, 'This memory is sealed. Its circuit remains safe.');

  const before = copyBoard(board), next = copyBoard(board);
  const targets = signal.scope === 'broad' ? [0, 1, 2] : [signal.target];
  let damage = 0;
  let message;

  if (board.kind === 'choir') {
    if (before.latched.every(Boolean) && signal.action === 'SURGE') {
      if (signal.scope !== 'broad') return unchanged(board, 'All phases are held. Use broad routing to reach the whole choir.');
      if (signal.beat !== 2) return unchanged(board, 'The held phases are safe. Wait for reference beat 2, then broadcast Surge.');
      next.complete = true;
      message = 'The whole choir answers together. Its memory is restored.';
    } else {
      for (const index of targets) {
        if (before.latched[index]) continue;
        if (signal.action === 'BRIDGE') next.nodes[index] = signal.beat;
        if (signal.action === 'SURGE') next.nodes[index] = (before.nodes[index] + 1) % 3;
        if (signal.action === 'SHELTER' && before.nodes[index] === CHOIR_TARGETS[index]) next.latched[index] = true;
      }
    }
  } else {
    const receiver = board.kind === 'archive' ? archiveReceiver : gardenReceiver;
    for (const index of targets) damage += receiver(before, next, index, signal.action);
    next.complete = targetsComplete(next);
  }

  next.fractures = Math.min(3, before.fractures + damage);
  next.stage = stageOf(next);
  const changed = next.complete !== before.complete || next.fractures !== before.fractures ||
    next.nodes.some((n, i) => n !== before.nodes[i]) || next.latched.some((n, i) => n !== before.latched[i]);
  if (changed) {
    if (before.revision === 1000000) throw new RangeError('Circuit revision limit reached.');
    next.revision = before.revision + 1;
    next.lastAction = signal.action;
  }
  if (!message) {
    if (next.complete) message = board.kind === 'archive' ? 'The released memory is connected, and its index survives.' : 'The conduit feeds a mature bloom, and the storm is calm.';
    else if (damage) message = board.kind === 'archive' ? 'Surge damaged a fragile receiver. The fracture remains until the mind is mended.' : 'The pulse overloaded the circuit. Restore the conduit and calm the storm.';
    else if (!changed && board.kind === 'choir' && signal.action === 'SHELTER') message = 'That phase does not match its target yet. Bridge copies the reference; Surge advances one phase.';
    else if (!changed && board.kind === 'archive' && signal.target === 2 && signal.action === 'BRIDGE') message = 'The thread cannot connect a frozen memory. Release the veil first.';
    else if (!changed && board.kind === 'garden' && signal.action === 'SHELTER') message = 'Protection cannot mature a dormant bloom. Link the conduit, then energize growth.';
    else message = describeBoard(next).instruction;
  }
  return { board: next, changed, fractures: next.fractures, addedFractures: next.fractures - before.fractures, damage, message, progress: progressOf(next) };
}

export function resetBoard(board) {
  validateBoard(board);
  if (board.complete) return copyBoard(board);
  if (board.revision === 1000000) throw new RangeError('Circuit revision limit reached.');
  return { ...createBoard(board.kind), revision: board.revision + 1, fractures: board.fractures };
}

export function describeBoard(board) {
  validateBoard(board);
  if (board.kind === 'archive') {
    const instruction = board.complete ? 'Memory sealed. Its fragile index was preserved.' :
      board.nodes[0] === 0 ? 'Repair INDEX with focused Shelter. Keep Surge away from it.' :
      board.nodes[1] === 0 ? 'Release VEIL with focused Surge. Broad Surge also strikes the fragile INDEX.' :
      'Connect THREAD with Bridge. The released memory is ready.';
    return {
      title: 'Release without erasing', instruction, complete: board.complete,
      nodes: [
        { label: 'INDEX', hint: 'Shelter repairs it. Surge breaks it.', state: board.nodes[0], goal: 'Preserve the index', complete: board.nodes[0] === 1 },
        { label: 'VEIL', hint: 'Surge releases the memory. Shelter freezes it again.', state: board.nodes[1], goal: 'Release the veil', complete: board.nodes[1] === 1 },
        { label: 'THREAD', hint: 'Bridge reconnects the memory after its veil is released.', state: board.nodes[2], goal: 'Reconnect the thread', complete: board.nodes[2] === 1 },
      ],
    };
  }
  if (board.kind === 'garden') {
    const instruction = board.complete ? 'Growth is mature, fed by a linked conduit, and the storm is calm.' :
      board.nodes[0] === 0 ? 'Link CONDUIT with Bridge. Energize BLOOM with Surge, then stabilize the garden.' :
      board.nodes[1] === 0 ? 'Use focused Surge on BLOOM. A broad Surge also feeds the storm and damages the conduit.' :
      'Shelter matures BLOOM and calms STORM. A broad Shelter can stabilize both together.';
    return {
      title: 'Grow, route, stabilize', instruction, complete: board.complete,
      nodes: [
        { label: 'CONDUIT', hint: 'Bridge links the supply. Surge burns the connection.', state: board.nodes[0], goal: 'Linked supply', complete: board.nodes[0] === 1 },
        { label: 'BLOOM', hint: board.nodes[1] === 0 ? 'Surge needs a linked conduit. Shelter is useful after growth begins.' : 'Shelter turns energized growth into a mature bloom.', state: board.nodes[1], goal: 'Mature bloom', complete: board.nodes[1] === 2 },
        { label: 'STORM', hint: 'Shelter calms it after growth begins. Surge overloads it.', state: board.nodes[2], goal: 'Calm storm', complete: board.nodes[2] === 1 },
      ],
    };
  }
  const instruction = board.complete ? 'The choir is synchronized and its memory is sealed.' :
    board.latched.every(Boolean) ? 'All phases are held. Broadcast Surge on reference beat 2 to synchronize the choir.' :
    'Bridge copies the reference beat. Surge advances a phase. Shelter holds a matching phase; held phases stay protected.';
  return {
    title: 'Prepare, then perform', instruction, complete: board.complete,
    nodes: board.nodes.map((state, index) => ({
      label: ['ALTO', 'TENOR', 'BASS'][index], state,
      goal: `Phase ${CHOIR_TARGETS[index]}, held`,
      hint: board.latched[index] ? `Held safely at phase ${state}.` : `Current phase ${state}; target ${CHOIR_TARGETS[index]}. Match it, then apply Shelter.`,
      complete: board.latched[index],
    })),
  };
}

function spectrumValues(spectrum) {
  const values = Array.isArray(spectrum) ? [...spectrum] : ACTIONS.map(action => spectrum?.[action]);
  if (values.length !== 3 || values.some(p => !Number.isFinite(p) || p < 0) || values.reduce((a, b) => a + b, 0) <= 0) {
    throw new TypeError('A spectrum needs three finite nonnegative action values and some power.');
  }
  const maximum = Math.max(...values);
  const scaled = values.map(p => p / maximum), total = scaled.reduce((a, b) => a + b, 0);
  return scaled.map(p => p / total);
}

export function mixSpectra(spectra, weights) {
  if (!Array.isArray(spectra) || spectra.length !== 3 || !Array.isArray(weights) || weights.length !== 3 ||
      weights.some(w => !Number.isFinite(w) || w < 0)) throw new TypeError('Mix three spectra with three nonnegative finite weights.');
  const vectors = spectra.map(spectrumValues), maximum = Math.max(...weights);
  if (maximum === 0) return Object.fromEntries(ACTIONS.map(action => [action, 0]));
  const scaled = weights.map(w => w / maximum), total = scaled.reduce((a, b) => a + b, 0);
  return Object.fromEntries(ACTIONS.map((action, index) => [action, vectors.reduce((sum, vector, source) => sum + vector[index] * scaled[source] / total, 0)]));
}

export function coreBalanced(vector, tolerance = 0.08) {
  const values = Array.isArray(vector) ? vector : ACTIONS.map(action => vector?.[action]);
  return Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 1 / 3 && values.length === 3 &&
    values.every(p => Number.isFinite(p) && p >= 0 && p <= 1 && Math.abs(p - 1 / 3) <= tolerance + 1e-10) &&
    Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= 1e-5;
}
