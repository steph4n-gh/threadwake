// Authored, frozen optical layouts. Offline search receipts live in evidence/campaign/round9-design/.
const ACTIONS = ['BRIDGE', 'SHELTER', 'SURGE'];
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const LAYOUTS = [
  {
    "site": "voice",
    "phase": 0,
    "source": "W1",
    "types": ["rotator","rotator","rotator","rotator","rotator","rotator","prism","prism","rotator"],
    "solution": [1,0,1,3,2,1,2,3,1],
    "initial": [1,1,0,0,3,3,0,0,2],
    "checkpoints": {"0":[0,5]},
    "required": [0],
    "id": "voice_1",
    "title": "Find the interrupted names",
    "description": "Route Bridge through the witness readheads. The other bands must not drown the record. Five distinct relay contacts authenticate a name; recirculating through one contact cannot forge that record.",
    "referenceWeights": [1,0,0],
    "ports": ["S2","S1","S0"],
    "fragilePort": "N0",
    "bounds": [[0.7,1],[0,0.2],[0,0.2]]
  },
  {
    "site": "voice",
    "phase": 1,
    "source": "W1",
    "types": ["prism","rotator","prism","rotator","rotator","rotator","rotator","rotator","prism"],
    "solution": [3,2,1,1,3,1,2,1,1],
    "initial": [3,2,2,2,3,2,2,2,1],
    "checkpoints": {"0":[6,1],"1":[6,5]},
    "required": [0,1],
    "id": "voice_2",
    "title": "Carry the answer beside the names",
    "description": "Bridge and Shelter must reach separate readheads together. One carries the names and one holds their annotations; five distinct relay contacts authenticate each powered receiver.",
    "referenceWeights": [1,1,0],
    "ports": ["S2","W0","E1"],
    "fragilePort": "N0",
    "bounds": [[0.38,0.62],[0.38,0.62],[0,0.12]]
  },
  {
    "site": "voice",
    "phase": 2,
    "source": "W1",
    "types": ["rotator","prism","rotator","rotator","rotator","rotator","rotator","prism","rotator"],
    "solution": [1,3,1,0,0,1,1,2,1],
    "initial": [0,3,2,2,3,0,1,0,0],
    "checkpoints": {"0":[4,7],"1":[4,5],"2":[4,5]},
    "required": [0,1,2],
    "id": "voice_3",
    "title": "Publish without erasing",
    "description": "Carry names, testimony and arrival marks through their separate receivers. Each needs five distinct authentication contacts and the marked readheads; preserve the fragile unrecorded margin.",
    "referenceWeights": [1,1,1],
    "ports": ["N0","S2","S1"],
    "fragilePort": "N1",
    "bounds": [[0.27,0.4],[0.27,0.4],[0.27,0.4]]
  },
  {
    "site": "shelter",
    "phase": 0,
    "source": "N1",
    "types": ["rotator","rotator","rotator","rotator","prism","rotator","prism","prism","rotator"],
    "solution": [3,3,2,3,3,2,3,2,1],
    "initial": [3,1,3,3,3,1,3,1,0],
    "checkpoints": {"1":[2,5]},
    "required": [1],
    "id": "shelter_1",
    "title": "Warm the quiet line",
    "description": "Carry Shelter through both clinic monitors without spilling power into the fragile reserve. The clinic accepts warmth only after five different relay contacts authenticate its supply.",
    "referenceWeights": [0,1,0],
    "ports": ["W1","S0","S2"],
    "fragilePort": "N0",
    "bounds": [[0,0.2],[0.7,1],[0,0.2]]
  },
  {
    "site": "shelter",
    "phase": 1,
    "source": "N1",
    "types": ["rotator","rotator","rotator","prism","prism","rotator","rotator","rotator","rotator"],
    "solution": [3,3,1,2,2,1,1,0,3],
    "initial": [3,0,2,1,3,0,1,1,0],
    "checkpoints": {"1":[2,5],"2":[2,5]},
    "required": [1,2],
    "id": "shelter_2",
    "title": "Share warmth with the rescue line",
    "description": "The clinic and returning winch need Shelter and Surge together. Their paths share hardware but end separately; five distinct contacts authenticate each powered receiver.",
    "referenceWeights": [0,1,1],
    "ports": ["W1","E2","S1"],
    "fragilePort": "N0",
    "bounds": [[0,0.12],[0.38,0.62],[0.38,0.62]]
  },
  {
    "site": "shelter",
    "phase": 2,
    "source": "N1",
    "types": ["rotator","rotator","rotator","rotator","rotator","prism","rotator","prism","rotator"],
    "solution": [3,1,1,3,0,2,2,0,2],
    "initial": [0,2,0,2,3,2,0,2,3],
    "checkpoints": {"0":[0,4],"1":[0,4],"2":[0,4]},
    "required": [0,1,2],
    "id": "shelter_3",
    "title": "Keep a living reserve",
    "description": "Keep half the supply at the clinic and a quarter each for connection and release. Protect the reserve and cross the marked monitors; every receiver needs five distinct authentication contacts.",
    "referenceWeights": [1,2,1],
    "ports": ["E1","W1","E0"],
    "fragilePort": "N0",
    "bounds": [[0.17,0.3],[0.42,0.58],[0.17,0.3]]
  },
  {
    "site": "storm",
    "phase": 0,
    "source": "S1",
    "types": ["rotator","prism","rotator","rotator","rotator","rotator","prism","rotator","rotator"],
    "solution": [0,2,0,3,1,2,1,0,3],
    "initial": [1,2,2,0,2,3,0,1,2],
    "checkpoints": {"2":[4,5]},
    "required": [2],
    "id": "storm_1",
    "title": "Ground the released storm",
    "description": "Route a dominant Surge through its ground monitors to the discharge receiver, away from the fragile voice line. Five distinct relay contacts certify the grounded discharge.",
    "referenceWeights": [0,0,1],
    "ports": ["E0","W2","W0"],
    "fragilePort": "N0",
    "bounds": [[0,0.2],[0,0.2],[0.7,1]]
  },
  {
    "site": "storm",
    "phase": 1,
    "source": "S1",
    "types": ["prism","prism","rotator","rotator","rotator","rotator","rotator","rotator","rotator"],
    "solution": [0,2,1,3,1,2,3,0,1],
    "initial": [3,2,0,3,3,3,3,2,0],
    "checkpoints": {"2":[4,5],"0":[4,5]},
    "required": [2,0],
    "id": "storm_2",
    "title": "Connect before releasing",
    "description": "Bridge must establish the return while Surge reaches the discharge circuit. Separate their receivers and certify each through five distinct relay contacts.",
    "referenceWeights": [1,0,1],
    "ports": ["E0","S2","N0"],
    "fragilePort": "N1",
    "bounds": [[0.38,0.62],[0,0.12],[0.38,0.62]]
  },
  {
    "site": "storm",
    "phase": 2,
    "source": "S1",
    "types": ["rotator","rotator","prism","prism","rotator","prism","rotator","rotator","rotator"],
    "solution": [3,1,1,1,0,1,0,1,2],
    "initial": [3,3,2,0,2,1,1,0,2],
    "checkpoints": {"0":[8,4],"1":[8,2],"2":[8,4]},
    "required": [0,1,2],
    "id": "storm_3",
    "title": "Carry the last weather",
    "description": "A slightly stronger release band must coexist with voice and shelter for the crossing. All three routes need their marked monitors and five distinct authentication contacts before discharge.",
    "referenceWeights": [32,26,42],
    "ports": ["E0","W0","N1"],
    "fragilePort": "N0",
    "bounds": [[0.27,0.37],[0.21,0.31],[0.34,0.46]]
  }
];

const TITLES = { voice: 'The witness ribbon', shelter: 'The living reserve', storm: 'The returning storm' };
const copy = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const cellLabel = index => String.fromCharCode(65 + Math.floor(index / 3)) + (index % 3 + 1);
function freeze(value) { Object.freeze(value); for (const item of Object.values(value)) if (item && typeof item === 'object' && !Object.isFrozen(item)) freeze(item); return value; }
export const CATALOG = freeze(Object.fromEntries(Object.entries(TITLES).map(([id, title]) => [id, { id, title, stages: LAYOUTS.filter(layout => layout.site === id) }])));
const RECOVERY = freeze({ BRIDGE: { BRIDGE: .83, SHELTER: .11, SURGE: .06 }, SHELTER: { BRIDGE: .06, SHELTER: .83, SURGE: .11 }, SURGE: { BRIDGE: .11, SHELTER: .06, SURGE: .83 } });
export function recoverySpectrum(action) {
  if (!ACTIONS.includes(action)) throw new TypeError('Choose Bridge, Shelter or Surge for the authored recovery profile.');
  return { ...RECOVERY[action] };
}
export function recoverySpectrumBefore(action) { return action === 'BRIDGE' ? { BRIDGE: .83, SHELTER: .02, SURGE: .15 } : recoverySpectrum(action); }


function siteFor(id) { const site = CATALOG[id]; if (!site) throw new TypeError('Unknown neural chamber.'); return site; }
function stageFor(state) { return siteFor(state.site).stages[Math.min(state.stage, 2)]; }
function normalize(vector) {
  if (!vector || typeof vector !== 'object' || Array.isArray(vector) || Object.keys(vector).sort().join(',') !== 'BRIDGE,SHELTER,SURGE' || ACTIONS.some(action => !finite(vector[action]) || vector[action] < 0)) throw new TypeError('A chamber needs three finite nonnegative signal components.');
  const largest = Math.max(...ACTIONS.map(action => vector[action]));
  if (largest === 0) return Object.fromEntries(ACTIONS.map(action => [action, 0]));
  const total = ACTIONS.reduce((sum, action) => sum + vector[action] / largest, 0);
  return Object.fromEntries(ACTIONS.map(action => [action, vector[action] / largest / total]));
}
function validState(state) {
  const site = siteFor(state?.site), ids = site.stages.map(stage => stage.id);
  if (!Number.isInteger(state.stage) || state.stage < 0 || state.stage > 3 || state.complete !== (state.stage === 3)) throw new TypeError('Invalid chamber stage.');
  if (!Array.isArray(state.orientations) || state.orientations.length !== 9 || state.orientations.some(value => !Number.isInteger(value) || value < 0 || value > 3)) throw new TypeError('Nine chamber rotors need orientations zero to three.');
  if (!Array.isArray(state.solved) || state.solved.join(',') !== ids.slice(0, state.stage).join(',')) throw new TypeError('Chamber progress must be a contiguous sequence.');
  if (!Array.isArray(state.faulted) || new Set(state.faulted).size !== state.faulted.length || state.faulted.some(id => !ids.slice(0, Math.min(3, state.stage + 1)).includes(id))) throw new TypeError('Invalid chamber overload record.');
  if (!Number.isInteger(state.attempts) || state.attempts < state.stage || state.attempts > 1000000 || !Number.isInteger(state.revision) || state.revision < state.attempts || state.revision > 1000000) throw new TypeError('Invalid chamber counters.');
  if (state.committedProfile !== null) normalize(state.committedProfile);
  if (state.complete && !state.committedProfile) throw new TypeError('A sealed chamber needs its actual committed profile.');
  return state;
}
export function start(siteId, saved = null) {
  const site = siteFor(siteId);
  if (saved !== null) {
    const state = copy(saved);
    if (state.site !== siteId) throw new TypeError('This save belongs to another chamber.');
    validState(state);
    if (state.complete && !probe(state, state.committedProfile).pass) throw new TypeError('The sealed route and spectrum no longer satisfy this chamber.');
    return state;
  }
  return { site: site.id, stage: 0, orientations: [...site.stages[0].initial], complete: false, solved: [], attempts: 0, faulted: [], revision: 0, committedProfile: null };
}
export function orient(state, index, value) {
  validState(state);
  if (!Number.isInteger(index) || index < 0 || index > 8 || !Number.isInteger(value) || value < 0 || value > 3) throw new RangeError('Choose a rotor zero to eight and orientation zero to three.');
  if (state.complete || state.orientations[index] === value) return state;
  if (state.revision >= 1000000) throw new RangeError('Chamber revision limit reached.');
  const next = copy(state); next.orientations[index] = value; next.revision++; return next;
}
function port(code) {
  const edge = code[0], index = Number(code[1]);
  const point = edge === 'W' ? { x: -.7, z: index } : edge === 'E' ? { x: 2.7, z: index } : edge === 'N' ? { x: index, z: -.7 } : { x: index, z: 2.7 };
  return { id: code, edge, index, ...point, label: ({ W: 'West', E: 'East', N: 'North', S: 'South' })[edge] + ' ' + (index + 1) };
}
function entry(code) { const n = Number(code[1]); return ({ W: [0, n, 0], E: [2, n, 2], N: [n, 0, 1], S: [n, 2, 3] })[code[0]]; }
function exitCode(x, z, direction) { return direction === 0 ? 'E' + z : direction === 1 ? 'S' + x : direction === 2 ? 'W' + z : 'N' + x; }
function trace(layout, orientations, band, value) {
  let [x, z, direction] = entry(layout.source); const seen = new Set(), visited = [], beams = [];
  beams.push({ band, value, from: port(layout.source), to: { x, z }, cell: z * 3 + x, direction });
  for (let count = 0; count < 37; count++) {
    const key = `${x}:${z}:${direction}`;
    if (seen.has(key)) return { band, value, beams, visited, exit: null, cycle: true };
    seen.add(key); const index = z * 3 + x; visited.push(index);
    direction = (direction + orientations[index] + (layout.types[index] === 'prism' ? ACTIONS.indexOf(band) - 1 : 0) + 4) % 4;
    const [dx, dz] = DIRECTIONS[direction], nx = x + dx, nz = z + dz;
    if (nx < 0 || nx > 2 || nz < 0 || nz > 2) {
      const exit = port(exitCode(x, z, direction)); beams.push({ band, value, from: { x, z }, to: exit, cell: index, direction });
      return { band, value, beams, visited, exit, cycle: false };
    }
    beams.push({ band, value, from: { x, z }, to: { x: nx, z: nz }, cell: index, direction }); x = nx; z = nz;
  }
  throw new Error('A chamber trace exceeded its finite directed-state bound.');
}
export function probe(state, vector) {
  validState(state); const layout = stageFor(state), supplied = normalize(vector), source = state.complete ? normalize(state.committedProfile) : supplied;
  const powered = ACTIONS.some(band => source[band] > 0), paths = ACTIONS.map(band => trace(layout, state.orientations, band, source[band]));
  const sinks = ACTIONS.map((band, index) => {
    const destination = layout.ports[index], path = paths[index], [min, max] = layout.bounds[index];
    const received = path.exit?.id === destination ? source[band] : 0;
    const wrong = paths.reduce((sum, other) => sum + (other.band !== band && other.exit?.id === destination ? other.value : 0), 0);
    const checkpoints = layout.checkpoints[index] || [], minimumCells = min === 0 ? 0 : 5, routePass = min === 0 || (checkpoints.every(cell => path.visited.includes(cell)) && new Set(path.visited).size >= minimumCells);
    return { band, port: port(destination), label: band[0] + band.slice(1).toLowerCase() + ' receiver', received, min, max, wrong, checkpoints, minimumCells, contacts: new Set(path.visited).size, routePass, pass: received + 1e-9 >= min && received <= max + 1e-9 && wrong <= .025 + 1e-9 && routePass };
  });
  const leaks = paths.filter(path => path.value > 0 && (path.cycle || path.exit?.id !== layout.ports[ACTIONS.indexOf(path.band)])).map(path => ({ band: path.band, value: path.value, port: path.exit, reason: path.cycle ? 'Closed feedback loop' : 'Wrong exit' }));
  const leakTotal = leaks.reduce((sum, leak) => sum + leak.value, 0), leakMax = .025;
  const fragile = [{ port: port(layout.fragilePort), label: 'Fragile reserve', received: paths.reduce((sum, path) => sum + (path.exit?.id === layout.fragilePort ? path.value : 0), 0), max: .025 }].map(item => ({ ...item, pass: item.received <= item.max + 1e-9 }));
  const goals = [{ id: 'power', text: 'Supply a captured or explicitly authored signal mixture.', pass: powered }, ...sinks.map(sink => ({ id: 'receiver_' + sink.band, text: `${sink.label}: ${Math.round(sink.min * 100)}–${Math.round(sink.max * 100)}% at ${sink.port.label}${sink.checkpoints.length ? ', via ' + sink.checkpoints.map(cellLabel).join(' and ') : ''}${sink.minimumCells ? ', five relay contacts (' + sink.contacts + ' reached)' : ''}; keep other bands below 2.5%.`, pass: sink.pass })), { id: 'fragile', text: 'Keep the fragile reserve below 2.5% of the source.', pass: fragile.every(item => item.pass) }, { id: 'leakage', text: `Wrong-exit power${leakTotal === 0 ? ': ' : ' ≈ '}${(leakTotal * 100).toFixed(2)}% — ${leakTotal <= leakMax + 1e-9 ? 'within' : 'over'} the 2.5% limit.${leaks.length ? ' ' + leaks.map(leak => leak.band[0] + leak.band.slice(1).toLowerCase() + ' → ' + (leak.port?.label || 'unresolved exit')).join('; ') + '.' : ''}`, pass: leakTotal <= leakMax + 1e-9 }];
  const pass = goals.every(goal => goal.pass), dangerous = fragile.some(item => !item.pass);
  let diagnosis = !powered ? 'The chamber is unpowered. Capture a signal or select an explicitly authored reference.' : pass ? 'All receivers and marked checkpoints agree. This route is ready to commit.' : goals.filter(goal => !goal.pass).slice(0, 2).map(goal => goal.text).join(' ');
  if (dangerous) diagnosis += state.faulted.includes(layout.id) ? ' The reserve fuse has already tripped on this stage; the historical scar remains.' : ' Energizing now trips the reserve fuse: +4 strain and one permanent scar. A dry probe is safe.';
  return { pass, powered, source, beams: paths.flatMap(path => path.beams).filter(beam => beam.value > 0), paths: paths.map(({ band, visited, exit, cycle }) => ({ band, visited, exit, cycle })), sinks, leaks, leakTotal, leakMax, fragile, goals, dangerous, diagnosis };
}
export function commit(state, vector) {
  const report = probe(state, vector);
  if (state.complete) return { state, report, advanced: false, complete: true, consequence: { strain: 0, scars: 0 } };
  if (state.attempts >= 1000000 || state.revision >= 1000000) throw new RangeError('Chamber counter limit reached.');
  const next = copy(state), layout = stageFor(state); next.attempts++; next.revision++;
  const consequence = { strain: 0, scars: 0 };
  if (report.pass) {
    next.solved.push(layout.id); next.stage++; next.complete = next.stage === 3; next.committedProfile = copy(report.source);
    if (!next.complete) next.orientations = [...siteFor(state.site).stages[next.stage].initial];
  } else if (report.dangerous && !next.faulted.includes(layout.id)) { next.faulted.push(layout.id); consequence.strain = 4; consequence.scars = 1; }
  return { state: next, report, advanced: report.pass, complete: next.complete, consequence };
}
export function view(state, vector = { BRIDGE: 0, SHELTER: 0, SURGE: 0 }) {
  validState(state); const site = siteFor(state.site), layout = stageFor(state), report = probe(state, vector);
  return { site: state.site, title: site.title, stage: layout.id, stageTitle: layout.title, description: layout.description, index: Math.min(state.stage, 2), total: site.stages.length, complete: state.complete,
    cells: layout.types.map((kind, index) => ({ index, row: Math.floor(index / 3), col: index % 3, kind, orientation: state.orientations[index], label: cellLabel(index), checkpoints: ACTIONS.filter((band, b) => (layout.checkpoints[b] || []).includes(index)) })),
    sourcePort: { ...port(layout.source), label: 'Source · ' + port(layout.source).label }, sinks: report.sinks, fragilePorts: report.fragile.map(item => ({ ...item.port, label: item.label, max: item.max })), goals: report.goals, beams: report.beams, report,
    hint: { observation: 'Rotors turn each incoming ray: 0 straight, 1 right, 2 back, 3 left. Prisms additionally turn Bridge left, leave Shelter straight and turn Surge right. Each receiver needs five different relay contacts to authenticate a crossing signal; revisiting one contact does not count twice. Trace one band at a time through its marked checkpoints before balancing the supply. Total power escaping through wrong exits must stay at or below 2.5%.', solution: 'A verified route: ' + layout.solution.map((turn, index) => cellLabel(index) + ': ' + turn).join(', ') + '. Authored reference weights Bridge / Shelter / Surge: ' + layout.referenceWeights.join(' / ') + '.', orientations: [...layout.solution], referenceWeights: [...layout.referenceWeights] } };
}
