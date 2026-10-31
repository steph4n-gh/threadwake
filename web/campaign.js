import { ZONES, PEOPLE, FACTS, FIXTURES, MISSIONS, TERMS } from './campaign-data.js';
import { mixSpectra, coreBalanced } from './puzzles.js';
import { heightAt } from './campaign-ground.js';
import * as Chambers from './campaign-chambers.js';
import * as ReturnLine from './return-line.js';

const ACTIONS = ['BRIDGE', 'SHELTER', 'SURGE'];
const SIGNALS = ['voice', 'shelter', 'storm'];
const FINAL_BAND_TOLERANCE = .08;
const MIN_CHAMBER_SHARE = .05;
const fixtureById = new Map(FIXTURES.map(f => [f.id, f]));
const personById = new Map(PEOPLE.map(p => [p.id, p]));
const termById = new Map(TERMS.map(t => [t.id, t]));
const consoles = FIXTURES.filter(f => f.kind === 'console');
const chamberFixtures = FIXTURES.filter(f => f.chamber);
const chamberHandles = f => Array.from({ length: 9 }, (_, index) => ({ id: `chamber_${f.signal}_r${index}`, label: `Rotor ${'ABC'[Math.floor(index / 3)]}${index % 3 + 1}`, op: 'set', values: [0, 1, 2, 3].map(value => ({ id: String(value), label: `${value * 90}°` })), initial: String(Chambers.start(f.signal).orientations[index]), requires: [] }));
const handleById = new Map([...consoles.flatMap(f => f.machine.handles.map(h => [h.id, h])), ...chamberFixtures.flatMap(f => chamberHandles(f).map(h => [h.id, h]))]);
const clone = value => structuredClone(value);
const add = (list, value) => { if (value && !list.includes(value)) list.push(value); };
const remove = (list, value) => { const i = list.indexOf(value); if (i >= 0) list.splice(i, 1); };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const epoch = () => crypto.randomUUID();
const current = run => MISSIONS[run.mission];
const clockTotal = run => run.clock.exploration + run.clock.deliberation;
const factText = id => FACTS[id] || id;
const sourceOf = result => result?.provenance === 'local' ? 'local' : 'authored';
const missionGoals = run => current(run).goals.filter(g => g.flag !== 'return_line_commissioned' || run.returnLine);
const hasAllGoals = run => missionGoals(run).every(g => run.flags.includes(g.flag));
const near = (run, fixture) => Math.hypot(run.pos.x - fixture.x, run.pos.z - fixture.z) <= 3.4;
const inMission = (record, run) => (!record.returnLine || !!run.returnLine) && (!record.missions || record.missions.includes(current(run).id));
const pastItem = (f, run) => f.kind === 'item' && f.missions.some(id => MISSIONS.findIndex(m => m.id === id) <= run.mission);
const carried = run => Object.keys(run.items).find(id => run.items[id].kind === 'carried') || null;

function initial(newDiagnostic = true) {
  const home = ZONES.find(z => z.id === 'refuge') || ZONES[0];
  const pos = { x: home.x, z: home.z + Math.min(5, home.radius / 2) };
  return {
    version: 3, epoch: epoch(), id: epoch(), revision: 0, nonce: 0, phase: 'playing', mission: 0,
    flags: [], facts: [], choices: {},
    items: Object.fromEntries(FIXTURES.filter(f => f.kind === 'item').map(f => [f.item, { kind: 'world', fixture: f.id, x: f.x, z: f.z }])),
    settings: Object.fromEntries([...handleById].map(([id, h]) => [id, h.initial])),
    agreements: [], people: Object.fromEntries(PEOPLE.map(p => [p.id, { x: p.x, z: p.z, zone: p.zone, duty: p.role }])),
    chambers: Object.fromEntries(SIGNALS.map(id => [id, Chambers.start(id)])), toolBank: {}, toolWeights: [100, 0, 0], toolMixture: { BRIDGE: 0, SHELTER: 0, SURGE: 0 },
    spectra: {}, returnLine: ReturnLine.start({ fault: newDiagnostic ? ReturnLine.CASES[Math.floor(Math.random() * ReturnLine.CASES.length)] : ReturnLine.CASES[0] }),
    heat: 3, strain: 0, scars: 0, surgeSeconds: 0, epilogue: false, program: null, motions: [], pending: null, preview: null,
    conversation: [], incidents: [], receipts: [], pos, checkpoint: { ...pos }, health: 100, energy: 100, falls: 0,
    clock: { exploration: 0, deliberation: 0, inference: 0, pause: 0, idle: 0 }, events: [],
    mixWeights: [70, 20, 10], mixture: [0, 0, 0], distribution: null, ending: null,
  };
}

function position(value) {
  return value && finite(value.x) && finite(value.z) && Math.abs(value.x) <= 220 && Math.abs(value.z) <= 220;
}

function restoreSafeGround(run) {
  const home = ZONES.find(z => z.id === 'refuge') || ZONES[0];
  if (heightAt(run.checkpoint.x, run.checkpoint.z, run.flags) === null) run.checkpoint = { x: home.x, z: home.z + Math.min(5, home.radius / 2) };
  if (heightAt(run.pos.x, run.pos.z, run.flags) === null) run.pos = { ...run.checkpoint };
  const recovered = [];
  for (const [id, location] of Object.entries(run.items)) {
    if (location.kind !== 'world' || heightAt(location.x, location.z, run.flags) !== null) continue;
    const origin = FIXTURES.find(f => f.kind === 'item' && f.item === id);
    run.items[id] = { kind: 'world', fixture: origin.id, x: origin.x, z: origin.z };
    recovered.push(id);
  }
  return recovered;
}

function returnPeopleToRefuge(run) {
  const home = ZONES.find(z => z.id === 'refuge') || ZONES[0];
  for (const person of PEOPLE) {
    const at = person.dutyPositions?.epilogue || person;
    run.people[person.id] = { x: at.x, z: at.z, zone: at.zone || home.id, duty: 'At the refuge' };
  }
}

export function start(saved = null) {
  const fresh = initial(saved === null);
  if (saved === null) return fresh;
  try {
    const data = typeof saved === 'string' ? JSON.parse(saved) : clone(saved);
    const value = data.run || data;
    const hasReturnLine = Object.hasOwn(value, 'returnLine');
    if (!hasReturnLine && (Object.keys(value.settings || {}).some(id => id.startsWith('return_line_')) || (value.agreements || []).includes('return_brace_iona') || (value.flags || []).some(id => id.startsWith('return_line_')) || (value.facts || []).some(id => id.startsWith('return_line_')))) throw new Error('Return-line records require their saved diagnostic state.');
    if (value.version !== 3 || !Number.isInteger(value.mission) || !MISSIONS[value.mission]) throw new Error('Unsupported campaign save.');
    if (!position(value.pos) || !position(value.checkpoint)) throw new Error('Invalid saved position.');
    for (const name of ['flags', 'facts', 'agreements', 'receipts', 'incidents', 'events', 'conversation']) {
      if (!Array.isArray(value[name])) throw new Error('Incomplete campaign save.');
    }
    if (value.flags.some(x => typeof x !== 'string') || value.facts.some(x => !(x in FACTS))) throw new Error('Invalid saved discoveries.');
    if (value.agreements.some(x => !termById.has(x))) throw new Error('Unknown saved agreement.');
    for (const [id, location] of Object.entries(value.items || {})) {
      if (!(id in fresh.items) || !location || !['world', 'carried', 'installed'].includes(location.kind)) throw new Error('Invalid saved item.');
      if (location.kind === 'world' && !position(location)) throw new Error('Invalid dropped item location.');
      if (location.kind === 'installed' && fixtureById.get(location.socket)?.item !== id) throw new Error('Invalid installed item.');
    }
    if (Object.values(value.items).filter(l => l.kind === 'carried').length > 1) throw new Error('Only one carrier can be held.');
    for (const [id, setting] of Object.entries(value.settings || {})) {
      if (!handleById.get(id)?.values.some(v => v.id === setting)) throw new Error('Invalid saved control.');
    }
    for (const key of ['heat', 'strain', 'health', 'energy', 'falls']) if (!finite(value[key]) || value[key] < 0) throw new Error('Invalid saved resource.');
    const run = { ...fresh, ...value, epoch: epoch(), id: epoch(), pending: null, preview: null };
    run.returnLine = hasReturnLine ? ReturnLine.restore(value.returnLine) : null;
    run.flags = [...new Set(run.flags)];
    run.facts = [...new Set(run.facts)];
    run.incidents = run.incidents.map(row => ({ ...row, text: FACTS[row.id] || row.text }));
    run.items = { ...fresh.items, ...run.items };
    run.settings = { ...fresh.settings, ...run.settings };
    run.people = { ...fresh.people, ...run.people };
    if (run.returnLine) {
      for (const h of ReturnLine.CATALOG.handles) if (value.settings?.['return_line_' + h.id] !== run.returnLine.settings[h.id]) throw new Error('Saved return controls disagree with diagnostic state.');
      if ((run.returnLine.phase === 'complete') !== run.flags.includes('return_line_commissioned') || (run.returnLine.phase === 'complete') !== run.facts.includes('return_line_commissioned')) throw new Error('Saved return completion is inconsistent.');
      if (run.returnLine.observations.some(row => row.support === 'iona') && !run.agreements.includes('return_brace_iona')) throw new Error('Saved return trial has no Iona consent.');
      if (!!run.returnLine.parked !== run.flags.includes('return_line_parked') || !!run.returnLine.parked !== run.facts.includes('return_line_parked') || run.returnLine.parked && (!run.flags.includes('hearing_evidence_ready') || !run.facts.includes('hearing_summary')) || run.returnLine.outcome?.support === 'iona' && (run.flags.includes('hearing_evidence_ready') || run.facts.includes('hearing_summary')) && !run.returnLine.parked) throw new Error('Saved brace parking is inconsistent.');
      const braceDuty = run.people.iona.duty;
      if (run.returnLine.outcome?.support === 'iona' && !run.returnLine.parked && braceDuty !== 'holding_return_brace' || run.returnLine.phase === 'diagnosing' && run.agreements.includes('return_brace_iona') && braceDuty !== 'return_brace_ready' || (run.returnLine.parked || run.returnLine.outcome?.support && run.returnLine.outcome.support !== 'iona') && ['holding_return_brace', 'return_brace_ready'].includes(braceDuty)) throw new Error('Saved Iona brace duty disagrees with its scoped return outcome.');
      syncReturnSettings(run);
    } else for (const h of ReturnLine.CATALOG.handles) delete run.settings['return_line_' + h.id];
    run.chambers = Object.fromEntries(SIGNALS.map(id => [id, Chambers.start(id, value.chambers?.[id] || null)]));
    run.toolBank = {};
    for (const [action, profile] of Object.entries(value.toolBank || {})) {
      if (!ACTIONS.includes(action) || !validToolProfile(profile) || profile.action !== action) throw new Error('Invalid saved neural tool.');
      run.toolBank[action] = clone(profile);
    }
    if (!validWeights(value.toolWeights || fresh.toolWeights)) throw new Error('Invalid saved neural allocations.');
    run.toolWeights = [...(value.toolWeights || fresh.toolWeights)];
    updateTools(run);
    for (const f of chamberFixtures) {
      syncChamberSettings(run, f);
      const flag = `chamber_${f.signal}_complete`, fact = `chamber_${f.signal}_restored`;
      if (run.chambers[f.signal].complete) { add(run.flags, flag); add(run.facts, fact); }
      else { remove(run.flags, flag); remove(run.facts, fact); }
    }
    run.heat = clamp(run.heat, 0, 9); run.strain = clamp(run.strain, 0, 100);
    run.health = clamp(run.health, 1, 100); run.energy = clamp(run.energy, 0, 100);
    if (!finite(run.surgeSeconds) || run.surgeSeconds < 0) throw new Error('Invalid saved overdrive.');
    run.surgeSeconds = clamp(run.surgeSeconds, 0, 150);
    run.clock = Object.fromEntries(Object.keys(fresh.clock).map(k => [k, finite(run.clock?.[k]) && run.clock[k] >= 0 ? run.clock[k] : 0]));
    run.events = run.events.slice(-1000); run.conversation = run.conversation.slice(-60);
    if (run.program) {
      const original = fixtureById.get(run.program.console);
      const f = original?.chamber ? chamberFixture(run, original) : original;
      if ((!f || f.kind !== 'console' && !f.chamber) || !Array.isArray(run.program.operations) || !Number.isInteger(run.program.cursor) || run.program.cursor < 0 || run.program.cursor > run.program.operations.length) throw new Error('Invalid saved machine program.');
      run.program.operations.forEach(op => validateOperation(run, f, op));
    }
    const authoredMotions = [...consoles.flatMap(f => f.machine.triggers.map(t => t.effects?.animation)), ...TERMS.map(t => t.effects?.animation)].filter(Boolean);
    if (!Array.isArray(run.motions) || run.motions.some(m => !authoredMotions.some(a => a.id === m.id && a.flag === m.flag && a.seconds === m.seconds) || !finite(m.elapsed) || m.elapsed < 0 || m.elapsed > m.seconds)) throw new Error('Invalid saved motion.');
    if (!['playing', 'victory'].includes(run.phase)) run.phase = 'playing';
    run.epilogue = run.phase === 'victory' && run.epilogue === true;
    if (run.epilogue) returnPeopleToRefuge(run);
    const returned = restoreSafeGround(run);
    if (returned.length) record(run, 'stranded-parts-recovered', { items: returned });
    if (run.ending && !finite(run.ending.engagedSeconds)) run.ending.engagedSeconds = run.events.find(e => e.type === 'crossing-complete')?.elapsed ?? clockTotal(run);
    updateSpectrumFlags(run);
    return run;
  } catch (error) {
    fresh.restoreWarning = error.message;
    return fresh;
  }
}

export function snapshot(run, options = {}) {
  const saved = clone(run);
  if (saved.returnLine === null) delete saved.returnLine;
  if (options.diagnostics) { if (saved.returnLine) delete saved.returnLine.secret; return saved; }
  saved.pending = null; saved.preview = null;
  delete saved.epoch;
  delete saved.restoreWarning;
  return saved;
}

function record(run, type, detail = {}) {
  run.events.push({ type, mission: run.mission, elapsed: Math.round(clockTotal(run) * 1000) / 1000, wallElapsed: Math.round(Object.values(run.clock).reduce((a, b) => a + b, 0) * 1000) / 1000, ...detail });
  if (run.events.length > 1000) {
    const expendable = run.events.findIndex(row => row.type !== 'chapter-start' && row.type !== 'crossing-complete' && !(row.type === 'chamber-commit' && row.pass));
    run.events.splice(expendable < 0 ? 0 : expendable, 1);
  }
}

function missing(run, requirements = []) {
  return requirements.filter(condition => !conditionMet(run, condition)).map(describeCondition);
}

function conditionMet(run, c) {
  if ('chamberPowered' in c) return Chambers.probe(run.chambers[c.chamberPowered], run.toolMixture).powered;
  if ('chamberIncomplete' in c) return !run.chambers[c.chamberIncomplete].complete;
  if ('flag' in c) return run.flags.includes(c.flag);
  if ('notFlag' in c) return !run.flags.includes(c.notFlag);
  if ('fact' in c) return run.facts.includes(c.fact);
  if ('itemInstalled' in c) return run.items[c.itemInstalled]?.kind === 'installed';
  if ('setting' in c) return run.settings[c.setting] === c.value;
  if ('resource' in c) return (c.min === undefined || run[c.resource] >= c.min) && (c.max === undefined || run[c.resource] <= c.max);
  if ('agreement' in c) return run.agreements.includes(c.agreement);
  return false;
}

function describeCondition(c) {
  if (c.chamberPowered) return 'Supply a captured or explicitly authored neural tool with a positive allocation.';
  if (c.chamberIncomplete) return 'This routing chamber is already complete.';
  if (c.flag === 'original_records') return 'Requires the original named index; the digest omitted the names.';
  if (c.notFlag === 'mara_keeper_reserved') return 'Guarded custody reserves Mara for the keeper’s duty.';
  if (c.flag === 'navigator_agreed') return 'Choose a navigator first.';
  if (c.notFlag === 'navigator_agreed') return 'A navigator has already been chosen.';
  if (c.notFlag === 'keeper_agreed') return 'A keeper has already been chosen.';
  if (c.notFlag === 'pantry_agreed') return 'The pantry allocation has already been agreed.';
  const assigned = /^hearing_(.+)_assigned$/.exec(c.notFlag || '');
  if (assigned && personById.has(assigned[1])) return personById.get(assigned[1]).name + ' already has a crossing duty.';
  if (c.flag) return c.flag.replaceAll('_', ' ');
  if (c.notFlag) return 'Before ' + c.notFlag.replaceAll('_', ' ');
  if (c.fact) return 'Discover ' + factText(c.fact);
  if (c.itemInstalled) return 'Install ' + c.itemInstalled.replaceAll('_', ' ');
  if (c.setting) return `${handleById.get(c.setting)?.label || c.setting}: ${c.value}`;
  if (c.resource) return `${c.resource}${c.min !== undefined ? ' at least ' + c.min : ''}${c.max !== undefined ? ' at most ' + c.max : ''}`;
  if (c.agreement) return termById.get(c.agreement)?.label || c.agreement;
  return 'Unmet machine condition';
}

function effects(run, value = {}, cues = [], source = '') {
  if ((value.heat || 0) + run.heat < 0) throw new Error('This operation needs more reserve heat.');
  for (const flag of value.flags || []) add(run.flags, flag);
  if (!value.animation) for (const fact of value.facts || []) add(run.facts, fact);
  run.heat = clamp(run.heat + (value.heat || 0), 0, 9);
  run.strain = clamp(run.strain + (value.strain || 0), 0, 100);
  if (value.setting) run.settings[value.setting.id] = value.setting.value;
  if (value.incident) addIncident(run, value.incident);
  if (value.duty) {
    const p = run.people[value.duty.person];
    if (p) { p.duty = value.duty.role; const at = personById.get(value.duty.person)?.dutyPositions?.[value.duty.role]; if (at) Object.assign(p, at); }
  }
  if (value.animation && !run.flags.includes(value.animation.flag) && !run.motions.some(m => m.id === value.animation.id)) {
    run.motions.push({ ...value.animation, elapsed: 0, source, facts: [...(value.facts || [])] });
    cues.push({ kind: 'motion', id: value.animation.id, seconds: value.animation.seconds });
  }
}

function addIncident(run, id) {
  if (!run.incidents.some(i => i.id === id)) run.incidents.push({ id, text: factText(id), mission: run.mission });
}

function knownHandle(run, handle) {
  return (handle.requires || []).every(id => run.facts.includes(id));
}

function validateOperation(run, fixture, op) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error('Every work-order step must name a valid operation.');
  if (op.op === 'route' || op.op === 'set') {
    if (Object.keys(op).sort().join(',') !== 'handle,op,value') throw new Error('Control operations need only op, handle and value.');
    const h = fixture.machine.handles.find(h => h.id === op.handle);
    if (!h || h.op !== op.op || !knownHandle(run, h) || !h.values.some(v => v.id === op.value)) throw new Error('That control or value has not been discovered here.');
  } else if (op.op === 'trigger') {
    if (Object.keys(op).sort().join(',') !== 'op,trigger' || !fixture.machine.triggers.some(t => t.id === op.trigger)) throw new Error('Unknown machine trigger.');
  } else if (op.op === 'after') {
    if (Object.keys(op).sort().join(',') !== 'condition,op' || !fixture.machine.conditions.some(c => c.id === op.condition)) throw new Error('Unknown machine wait condition.');
  } else throw new Error('Only set, route, trigger and after are allowed.');
}

function applyOperation(run, fixture, op, cues, receipt) {
  validateOperation(run, fixture, op);
  if (fixture.chamber) return applyChamberOperation(run, fixture, op, cues, receipt);
  if (fixture.returnLine) return applyReturnOperation(run, fixture, op, cues);
  if (op.op === 'route' || op.op === 'set') {
    run.settings[op.handle] = op.value;
    cues.push({ kind: 'control', console: fixture.id, handle: op.handle, value: op.value });
    return true;
  }
  if (op.op === 'after') {
    const c = fixture.machine.conditions.find(c => c.id === op.condition);
    return !missing(run, c.requires).length;
  }
  const trigger = fixture.machine.triggers.find(t => t.id === op.trigger);
  if (run.receipts.includes('trigger:' + trigger.id)) return true;
  const unmet = missing(run, trigger.requires);
  if (unmet.length) throw new Error(trigger.failure || `${trigger.label}. Needs ${unmet.join('; ')}.`);
  if (receipt && run.receipts.includes(receipt)) return true;
  effects(run, trigger.effects, cues, fixture.id);
  add(run.receipts, 'trigger:' + trigger.id);
  if (receipt) add(run.receipts, receipt);
  cues.push({ kind: 'trigger', console: fixture.id, trigger: trigger.id });
  return true;
}

function simulate(run, fixture, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 8) throw new Error('A work order needs one to eight steps.');
  if (fixture.returnLine) {
    operations.forEach(op => validateOperation(run, fixture, op));
    const preview = ReturnLine.preview(run.returnLine, operations.map(returnOperation));
    return { changes: operationLabels(fixture, operations), flags: [], strain: 0, scars: 0, nonPredictive: true, note: preview.note, heatRiskPerNewReserveTrial: 1, potentialHeatCost: preview.potentialHeatCost };
  }
  const rehearsal = clone(run), cues = [];
  for (const op of operations) {
    validateOperation(rehearsal, fixture, op);
    if (op.op === 'after') {
      const condition = fixture.machine.conditions.find(c => c.id === op.condition);
      if (missing(rehearsal, condition.requires).length) {
        for (const motion of rehearsal.motions) { add(rehearsal.flags, motion.flag); for (const id of motion.facts || []) add(rehearsal.facts, id); }
        rehearsal.motions = [];
      }
      if (missing(rehearsal, condition.requires).length) throw new Error('This program cannot reach ' + condition.label + '. Change the preceding steps first.');
    } else applyOperation(rehearsal, fixture, op, cues, null);
  }
  return { changes: operationLabels(fixture, operations), flags: rehearsal.flags.filter(f => !run.flags.includes(f)), heat: rehearsal.heat - run.heat, strain: rehearsal.strain - run.strain, scars: rehearsal.scars - run.scars, chamber: fixture.chamber ? Chambers.view(rehearsal.chambers[fixture.signal], rehearsal.toolMixture) : null };
}

function operationLabels(fixture, operations) {
  return operations.map(op => {
    if (op.op === 'after') return 'Wait for ' + fixture.machine.conditions.find(c => c.id === op.condition)?.label;
    if (op.op === 'trigger') return fixture.machine.triggers.find(t => t.id === op.trigger)?.label;
    const h = fixture.machine.handles.find(h => h.id === op.handle);
    return `${h?.label}: ${h?.values.find(v => v.id === op.value)?.label || op.value}`;
  });
}

function machineFixture(run, id) {
  const f = fixtureById.get(id);
  if (f?.chamber) {
    usableFixture(run, id);
    if (!run.flags.includes(f.flag)) throw new Error('Capture this physical signal before opening its routing chamber.');
    return chamberFixture(run, f);
  }
  if (!f || f.kind !== 'console' || !inMission(f, run)) throw new Error('That console is not part of the current situation.');
  if (f.returnLine) usableFixture(run, f.id);
  return f;
}

function usableFixture(run, id) {
  const f = fixtureById.get(id);
  if (!f || (!inMission(f, run) && !pastItem(f, run) && !(f.kind === 'attune' && run.flags.includes(f.flag)))) throw new Error('That apparatus is not available in this chapter.');
  const unmet = missing(run, f.requires);
  if (unmet.length) throw new Error(f.label + '. Needs ' + unmet.join('; ') + '.');
  return f;
}

function freshTicket(run, ticket) {
  return ticket && ticket.epoch === run.epoch && ticket.nonce === run.nonce && ticket.revision === run.revision && ticket.mission === run.mission;
}

function sameTicket(a, b) {
  return a && b && ['epoch', 'nonce', 'revision', 'mission', 'subject'].every(k => a[k] === b[k]);
}

function line(run, speaker, text, provenance, person = null, cited = []) {
  const row = { speaker, text, provenance, person, cited_facts: cited };
  run.conversation.push(row);
  if (run.conversation.length > 60) run.conversation.shift();
  return row;
}

function termView(run, term) {
  const unmet = missing(run, term.requires);
  if (!inMission(term, run)) unmet.push('This arrangement belongs to another chapter.');
  if (run.heat < term.heatCost) unmet.push(`Reserve ${term.heatCost} heat.`);
  return { ...term, eligible: unmet.length === 0 && !run.agreements.includes(term.id), missing: unmet, accepted: run.agreements.includes(term.id), cost: term.heatCost };
}

function relevantCards(cards, text, limit) {
  const stop = new Set(['what', 'when', 'where', 'which', 'would', 'could', 'should', 'remember', 'about', 'have', 'with', 'that', 'this', 'from', 'your', 'were']);
  const words = [...new Set((text.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !stop.has(w)))];
  return cards.map((card, index) => ({ card, index, score: words.reduce((n, w) => n + ((card.id + ' ' + card.text).toLowerCase().includes(w) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, limit).map(v => v.card);
}

function packetFacts(run, extra = [], text = '') {
  const mandatory = [...new Set(extra)].filter(id => run.facts.includes(id)).map(id => ({ id, text: factText(id) }));
  const rest = run.facts.filter(id => !extra.includes(id)).map(id => ({ id, text: factText(id) }));
  return [...mandatory, ...relevantCards(rest, text, 8)].slice(0, 8);
}


function validateLocalProfile(r) {
    if (r.status !== 'complete' || typeof r.id !== 'string' || !r.id || typeof r.model_revision !== 'string' || !r.model_revision) throw new Error('The local thought has no completed worker identity.');
    const steering = r.steering;
    if (!steering || typeof steering.applied !== 'boolean' || !['focused', 'broad'].includes(steering.scope) || !finite(steering.strength) || steering.strength < 0 || steering.strength > 1) throw new Error('Invalid measured steering metadata.');
    if (steering.applied && (!finite(steering.delta_l2) || steering.delta_l2 <= 0 || !Number.isInteger(steering.changed_elements) || steering.changed_elements <= 0 || !Number.isInteger(steering.edited_tokens) || steering.edited_tokens <= 0)) throw new Error('An applied edit requires actual nonzero measurements.');
    for (const name of ['probabilities_before', 'probabilities_after']) {
      if (!r[name] || Object.keys(r[name]).sort().join(',') !== 'BRIDGE,SHELTER,SURGE' || Object.values(r[name]).some(v => !finite(v) || v < 0 || v > 1) || Math.abs(Object.values(r[name]).reduce((a, b) => a + b, 0) - 1) > 1e-5) throw new Error('The local thought has no valid measured spectrum.');
    }
    const winner = vector => ACTIONS.reduce((best, action) => vector[action] > vector[best] ? action : best, ACTIONS[0]);
    if (r.action !== winner(r.probabilities_after) || r.baseline_action !== winner(r.probabilities_before)) throw new Error('The captured actions disagree with their recorded probabilities.');
    if (!steering.applied && (steering.delta_l2 !== 0 || steering.changed_elements !== 0 || steering.edited_tokens !== 0)) throw new Error('A native thought cannot claim an unrecorded activation edit.');
}

function validWeights(weights) {
  return Array.isArray(weights) && weights.length === 3 && weights.every(w => finite(w) && w >= 0 && w <= 100) && weights.some(w => w > 0);
}
function validToolProfile(profile) {
  if (!profile || !ACTIONS.includes(profile.action) || !['local', 'authored'].includes(profile.provenance)) return false;
  const vector = signalVector(profile);
  if (!vector || Object.keys(vector).sort().join(',') !== 'BRIDGE,SHELTER,SURGE' || Object.values(vector).some(v => !finite(v) || v < 0 || v > 1) || Math.abs(Object.values(vector).reduce((a, b) => a + b, 0) - 1) > 1e-5) return false;
  if (profile.provenance === 'local') { try { validateLocalProfile(profile); } catch { return false; } }
  else {
    const recovery = Chambers.recoverySpectrum(profile.action);
    const legacy = ACTIONS.every(action => vector[action] === (action === profile.action ? 1 : 0));
    if (!legacy && ACTIONS.some(action => vector[action] !== recovery[action])) return false;
  }
  return true;
}
function updateTools(run) {
  const powered = ACTIONS.map((action, index) => ({ profile: run.toolBank[action], weight: run.toolWeights[index] })).filter(row => row.profile && row.weight > 0);
  const total = powered.reduce((sum, row) => sum + row.weight, 0);
  run.toolMixture = Object.fromEntries(ACTIONS.map(action => [action, total ? powered.reduce((sum, row) => sum + signalVector(row.profile)[action] * row.weight / total, 0) : 0]));
}
function rememberTool(run, profile) {
  if (!validToolProfile(profile)) throw new Error('This neural tool has no valid captured profile.');
  const first = Object.keys(run.toolBank).length === 0;
  run.toolBank[profile.action] = clone(profile);
  if (first) run.toolWeights = ACTIONS.map(action => action === profile.action ? 100 : 0);
  updateTools(run);
}
function syncChamberSettings(run, f) {
  run.chambers[f.signal].orientations.forEach((value, index) => { run.settings[`chamber_${f.signal}_r${index}`] = String(value); });
}
function chamberView(run, f) {
  const observed = Chambers.view(run.chambers[f.signal], run.toolMixture);
  return { ...observed, siteID: f.signal,
    profiles: ACTIONS.map(action => { const profile = run.toolBank[action]; return { action, available: !!profile, provenance: profile?.provenance || null, probabilities: profile ? clone(signalVector(profile)) : null, id: profile?.id || null, model_revision: profile?.model_revision || null }; }), weights: [...run.toolWeights], mixture: { ...observed.report.source } };
}
function chamberFixture(run, f) {
  const chamber = chamberView(run, f);
  return { ...f, machine: { id: `chamber_${f.signal}`, description: `${chamber.title}. ${chamber.report.diagnosis}`, handles: chamberHandles(f), triggers: [
    { id: `chamber_${f.signal}_probe`, label: 'Trace the chamber without commitment', requires: [{ chamberPowered: f.signal }] },
    { id: `chamber_${f.signal}_commit`, label: 'Commit this chamber routing', requires: [{ chamberPowered: f.signal }, { chamberIncomplete: f.signal }] },
  ], conditions: [{ id: `chamber_${f.signal}_complete`, label: 'All routing phases are complete', requires: [{ flag: `chamber_${f.signal}_complete` }] }] } };
}
function chamberObservations(run, f) {
  const chamber = chamberView(run, f), cellName = index => 'ABC'[Math.floor(index / 3)] + (index % 3 + 1), percentages = vector => ACTIONS.map(action => `${action} ${(vector[action] * 100).toFixed(2)}%`).join(', ');
  const cards = [
    ['rules', 'Instrument rules: a rotor turns an incoming ray by its setting: 0° straight, 90° right, 180° back, 270° left. A prism additionally turns Bridge left, Shelter straight, Surge right. Five distinct relay contacts authenticate each required band; revisiting one does not count twice. Dry tracing is safe. Committing into the fragile reserve adds 4 strain and one permanent scar once per stage.'],
    ['grid', `${chamber.stageTitle}, phase ${chamber.index + 1}/${chamber.total}. Source ${chamber.sourcePort.label}. Current row-major grid: ` + chamber.cells.map(cell => `${cellName(cell.index)} ${cell.kind} ${cell.orientation * 90}°${cell.checkpoints.length ? ' monitors ' + cell.checkpoints.join('/') : ''}`).join('; ')],
    ['goals', 'Current receivers: ' + chamber.sinks.map(sink => `${sink.band} at ${sink.port.label}: ${(sink.min * 100).toFixed(1)}–${(sink.max * 100).toFixed(1)}%, other bands ≤2.5%${sink.checkpoints.length ? ', via ' + sink.checkpoints.map(cellName).join('/') : ''}${sink.minimumCells ? ', ≥' + sink.minimumCells + ' distinct cells (' + sink.contacts + ' reached)' : ''}`).join('; ') + '. Fragile reserve ' + chamber.fragilePorts.map(port => `${({N:'North',E:'East',S:'South',W:'West'})[port.edge]} ${port.index + 1} ≤${port.max * 100}%`).join('; ') + `. Total wrong-exit or feedback leakage must be at most ${(chamber.report.leakMax * 100).toFixed(1)}%. Every receiver and checkpoint must pass.`],
    ['trace', 'Current safe dry-trace predictions: ' + chamber.report.paths.map(path => `${path.band}${chamber.report.source[path.band] === 0 ? ' (unpowered path)' : ''}: ${path.visited.map(cellName).join('>')} → ${path.cycle ? 'feedback loop' : path.exit?.label || 'no exit'}`).join('; ') + `. Dry trace: ${chamber.report.pass ? 'requirements pass' : 'requirements not all met'}; wrong-exit or feedback leakage ${(chamber.report.leakTotal * 100).toFixed(2)}% (limit ${(chamber.report.leakMax * 100).toFixed(1)}%); fragile reserve ${chamber.report.dangerous ? 'would overload' : 'within limit'}. Current phase fuse ${run.chambers[f.signal].faulted.includes(chamber.stage) ? 'already tripped; another commit adds no scar or strain' : chamber.report.dangerous ? 'intact; committing adds one scar and up to four strain' : 'intact; committing adds no scar or strain'}.`],
    ['input', (chamber.complete ? 'Sealed committed source: ' : 'Actual normalized source: ') + percentages(chamber.mixture) + (chamber.complete ? '. Current global tool mixture (does not alter this sealed source): ' + percentages(run.toolMixture) : '') + '. Current relative allocations Bridge/Shelter/Surge: ' + chamber.weights.join('/') + '. Current retained tools: ' + chamber.profiles.map(profile => `${profile.action}: ${profile.available ? profile.provenance + ' [' + percentages(profile.probabilities) + ']' + (profile.id ? ' record ' + profile.id : '') : 'unavailable'}`).join('; ')],
  ];
  return cards.map(([name, text]) => ({ id: `optics_${f.signal}_${name}`, text: text.slice(0, 600) }));
}
function endingObservations(run) {
  if (run.phase !== 'victory' || !run.ending) return [];
  const ending = run.ending, agreements = ending.agreements || [], nameFor = role => {
    const id = agreements.find(id => id.startsWith(role + '_'))?.slice(role.length + 1);
    return personById.get(id)?.name || 'No named agreement is recorded';
  };
  const distribution = ending.distribution === 'archive' ? 'The final reserve carried the people and the retained archive.' : 'The final reserve was given to the people.';
  return [
    { id: 'ending_summary', text: `Sealed ending: the physical crossing is complete. ${distribution} Reserve heat at completion: ${ending.heat}. Historical scars at completion: ${ending.scars}. Sealed final broadcast mixture: ${ACTIONS.map((action, i) => action + ' ' + (100 * ending.mixture[i]).toFixed(1) + '%').join(', ')}. The broadcast and distribution are committed outcomes, not future promises.` },
    { id: 'crossing_duties', text: `Recorded crossing agreements: navigator — ${nameFor('navigator')}; keeper — ${nameFor('keeper')}. The navigator guided the first cradle and the different keeper accompanied the second. These historical duties remain recorded after everyone returns to the refuge.` },
  ];
}
function conversationFacts(run, text) {
  const historical = packetFacts(run, [], text), ending = endingObservations(run);
  if (ending.length) return [...ending, ...historical.slice(0, 6)];
  if (!/chamber|prism|rotor|beam|readout|spectrum|receiver/i.test(text)) return historical;
  const f = chamberFixtures.find(f => run.flags.includes(f.flag) && near(run, f) && !missing(run, f.requires).length);
  return f ? [...chamberObservations(run, f), ...historical.slice(0, 3)] : historical;
}
function availableChamber(run, id) {
  const f = id ? fixtureById.get(id) : chamberFixtures.find(f => near(run, f) && (inMission(f, run) || run.flags.includes(f.flag)));
  if (!f?.chamber || !near(run, f)) throw new Error('Approach an accessible signal chamber to change its tools.');
  usableFixture(run, f.id);
  if (!run.flags.includes(f.flag)) throw new Error('Capture the physical signal before calibrating its chamber tools.');
  return f;
}
function applyChamberOperation(run, f, op, cues, receipt) {
  const site = f.signal;
  if (op.op === 'set') {
    const index = Number(op.handle.slice(op.handle.lastIndexOf('_r') + 2));
    run.chambers[site] = Chambers.orient(run.chambers[site], index, Number(op.value)); syncChamberSettings(run, f);
    cues.push({ kind: 'control', console: f.id, handle: op.handle, value: op.value }); return true;
  }
  if (op.op === 'after') return run.chambers[site].complete;
  if (!Chambers.probe(run.chambers[site], run.toolMixture).powered) throw new Error('The chamber has no powered input. Capture or explicitly calibrate a tool, then assign it some allocation.');
  if (op.trigger === `chamber_${site}_probe`) {
    const report = Chambers.probe(run.chambers[site], run.toolMixture);
    record(run, 'chamber-probe', { site, stage: run.chambers[site].stage, pass: report.pass, diagnosis: report.diagnosis });
    cues.push({ kind: 'message', text: report.diagnosis }); return true;
  }
  if (receipt && run.receipts.includes(receipt)) return true;
  if (run.chambers[site].complete) throw new Error('This routing chamber is already complete.');
  const previous = run.chambers[site].stage, orientations = [...run.chambers[site].orientations], outcome = Chambers.commit(run.chambers[site], run.toolMixture);
  run.chambers[site] = outcome.state; syncChamberSettings(run, f);
  run.strain = clamp(run.strain + outcome.consequence.strain, 0, 100); run.scars += outcome.consequence.scars;
  if (receipt) add(run.receipts, receipt);
  if (outcome.complete) { add(run.flags, `chamber_${site}_complete`); add(run.facts, `chamber_${site}_restored`); }
  record(run, 'chamber-commit', { site, stage: previous, orientations, mixture: { ...run.toolMixture }, weights: [...run.toolWeights], pass: outcome.report.pass, advanced: outcome.advanced, complete: outcome.complete, consequence: outcome.consequence, provenance: ACTIONS.filter(action => run.toolWeights[ACTIONS.indexOf(action)] > 0 && run.toolBank[action]).map(action => ({ action, provenance: run.toolBank[action].provenance, id: run.toolBank[action].id || null, model_revision: run.toolBank[action].model_revision || null, weight: run.toolWeights[ACTIONS.indexOf(action)] / ACTIONS.reduce((sum, id, index) => sum + (run.toolBank[id] ? run.toolWeights[index] : 0), 0), probabilities: { ...signalVector(run.toolBank[action]) } })) });
  if (outcome.complete) updateSpectrumFlags(run);
  cues.push({ kind: 'message', text: outcome.report.diagnosis }); return true;
}

function returnContext(run) {
  return { heat: run.heat, consent: run.agreements.includes('return_brace_iona'), ionaOffer: !!run.returnLine && run.mission === 4 && run.returnLine.phase === 'diagnosing' && run.facts.includes('return_line_service') && run.flags.includes('baffles_aligned') && run.flags.includes('sail_installed'), available: run.phase === 'playing' && run.mission === 4 && run.flags.includes('baffles_aligned') && run.flags.includes('sail_installed') };
}
function returnView(run) { return run.returnLine ? ReturnLine.view(run.returnLine, returnContext(run)) : null; }
function syncReturnSettings(run) { for (const h of ReturnLine.CATALOG.handles) run.settings['return_line_' + h.id] = run.returnLine.settings[h.id]; }
function returnOperation(op) {
  if (op.op === 'set') return { ...op, handle: op.handle.slice('return_line_'.length) };
  if (op.op === 'trigger') return { ...op, trigger: op.trigger.slice('return_line_'.length) };
  return { ...op, condition: 'return_flowing' };
}
function releaseReturnIona(run) {
  if (!['return_brace_ready', 'holding_return_brace'].includes(run.people.iona.duty)) return;
  const person = personById.get('iona'), role = run.agreements.includes('pantry_iona') ? 'mechanic' : person.role;
  Object.assign(run.people.iona, person.dutyPositions?.[role] || { x: person.x, z: person.z, zone: person.zone }, { duty: role });
}
function parkReturn(run, cues) {
  if (!run.returnLine) return;
  const parked = ReturnLine.park(run.returnLine);
  if (parked !== run.returnLine) { run.returnLine = parked; add(run.flags, 'return_line_parked'); add(run.facts, 'return_line_parked'); record(run, 'return-line-parked', { flow: 'essential_basin_only' }); cues.push({ kind: 'message', text: parked.message }); }
  releaseReturnIona(run);
}
function applyReturnOperation(run, fixture, op, cues) {
  if (!run.returnLine || !returnContext(run).available) throw new Error('The return line is not available here.');
  if (op.op === 'trigger' && run.returnLine.phase !== 'complete') {
    const trigger = fixture.machine.triggers.find(t => t.id === op.trigger), unmet = missing(run, trigger.requires);
    if (unmet.length) throw new Error(trigger.label + '. Needs ' + unmet.join('; '));
  }
  const result = ReturnLine.act(run.returnLine, returnOperation(op), returnContext(run));
  if (result.waiting) return false;
  const wasComplete = run.returnLine.phase === 'complete';
  run.returnLine = result.state; run.heat -= result.heatCost; syncReturnSettings(run);
  if (!wasComplete && run.returnLine.phase === 'complete') {
    add(run.flags, 'return_line_commissioned'); add(run.facts, 'return_line_commissioned');
    if (run.returnLine.outcome.support === 'iona') effects(run, { duty: { person: 'iona', role: 'holding_return_brace' } }, cues, fixture.id);
    else releaseReturnIona(run);
    record(run, 'return-line-commissioned', { support: run.returnLine.outcome.support, flow: run.returnLine.outcome.flow, heat: run.heat });
  }
  record(run, 'return-line-operation', { operation: clone(op), heatCost: result.heatCost, measurement: run.returnLine.lastMeasurementId });
  if (op.op === 'trigger') cues.push({ kind: 'message', text: run.returnLine.message });
  return true;
}

function makeMachinePanel(run, f) {
  return {
    fixture: f.id, id: f.machine.id, label: f.label, description: f.description,
    // Retired controls remain valid for old settings and programs, but are not offered anew.
    handles: f.machine.handles.filter(h => !h.retired).map(h => ({ ...h, current: run.settings[h.id], known: knownHandle(run, h) })),
    triggers: f.machine.triggers.map(t => ({ id: t.id, label: t.label, enabled: missing(run, t.requires).length === 0, missing: missing(run, t.requires) })),
    conditions: f.machine.conditions.map(c => ({ id: c.id, label: c.label, satisfied: !missing(run, c.requires).length })),
    chamber: f.chamber ? chamberView(run, f) : null,
    returnLine: f.returnLine ? returnView(run) : null,
    program: run.program?.console === f.id ? clone(run.program) : null,
  };
}

export function request(state, intent) {
  if (state.phase !== 'playing' && intent?.kind !== 'conversation') return { state, packet: null, message: 'The crossing is complete.' };
  if (!intent || !['conversation', 'work_order', 'thought'].includes(intent.kind) || typeof intent.text !== 'string' || !intent.text.trim() || intent.text.length > 600) return { state, packet: null, message: 'Use a message of at most 600 characters.' };
  try {
    const run = clone(state), subject = intent.subject;
    let scene;
    if (intent.kind === 'conversation') {
      const person = personById.get(subject);
      if (!person) throw new Error('Unknown companion.');
      const terms = run.phase === 'victory' ? [] : TERMS.filter(t => t.person === subject && inMission(t, run)).slice(0, 8).map(t => termView(run, t));
      scene = {
        person: { id: person.id, name: person.name, voice: person.voice },
        place: run.epilogue ? 'The Refuge, after the crossing' : ZONES.find(z => z.id === current(run).zone)?.name || current(run).zone,
        objective: run.phase === 'victory' ? 'The crossing is complete and its outcomes are sealed. Discuss the actual retained record without changing those outcomes.' : current(run).summary,
        facts: conversationFacts(run, intent.text), incidents: relevantCards(run.incidents.map(i => ({ id: i.id, text: i.text })), intent.text, 6),
        history: run.conversation.filter(l => l.person === subject && l.provenance !== 'local').slice(-4).map(l => ({ speaker: l.speaker, text: l.text })),
        terms: terms.map(t => ({ id: t.id, label: t.label, description: t.description, eligible: t.eligible, cost: t.heatCost })),
      };
      line(run, 'player', intent.text, 'player', subject);
    } else if (intent.kind === 'work_order') {
      const f = machineFixture(run, subject);
      if (!near(run, f)) throw new Error('Approach this console before programming it.');
      const panel = makeMachinePanel(run, f);
      scene = {
        place: f.label, objective: f.chamber ? `${current(run).summary} ${f.machine.description}`.slice(0, 700) : current(run).summary, facts: f.returnLine ? ReturnLine.facts(run.returnLine, returnContext(run)) : f.chamber ? [...chamberObservations(run, f), ...packetFacts(run, [], intent.text).slice(0, 3)] : packetFacts(run, f.machine.handles.flatMap(h => h.requires || [])),
        handles: panel.handles.filter(h => h.known).slice(0, 10).map(h => ({ id: h.id, label: h.label, op: h.op, values: h.values, current: h.current })),
        triggers: panel.triggers.slice(0, 8).map(t => ({ id: t.id, label: t.label, requirements: t.missing.length ? t.missing.join('; ') : 'Currently ready.' })),
        conditions: panel.conditions.slice(0, 8).map(c => ({ id: c.id, label: c.label })),
      };
    } else {
      const f = usableFixture(run, subject);
      if (f.kind !== 'attune' || !near(run, f)) throw new Error('Approach a signal instrument before attuning it.');
      scene = null;
    }
    run.nonce++;
    const ticket = { epoch: run.epoch, nonce: run.nonce, revision: run.revision, mission: run.mission, subject };
    run.pending = { ...ticket, kind: intent.kind, text: intent.text, scene: clone(scene), afterEnding: run.phase === 'victory' };
    run.preview = null;
    if (intent.kind === 'thought') {
      const f = fixtureById.get(subject);
      return { state: run, packet: { kind: 'thought', ticket, relay: Math.max(0, SIGNALS.indexOf(f.signal)), scope: intent.scope === 'broad' ? 'broad' : 'focused', strength: clamp(Number(intent.strength) || 0, 0, 1), bias: ACTIONS.includes(intent.bias) ? intent.bias : 'SURGE', request: intent.text.slice(0, 240), context: null } };
    }
    return { state: run, packet: { kind: intent.kind, text: intent.text, ticket, scene } };
  } catch (error) {
    return { state, packet: null, message: error.message };
  }
}

function receive(run, intent, cues) {
  const pending = run.pending;
  if (!pending || !sameTicket(pending, intent.ticket)) throw new Error('That reply belongs to an older request.');
  run.pending = null;
  if (!freshTicket(run, intent.ticket)) throw new Error('The situation changed while this thought was forming. Try again.');
  const result = intent.result;
  if (!result || result.status !== 'complete' || result.provenance !== 'local' || result.kind !== pending.kind || !sameTicket(result.ticket, intent.ticket)) throw new Error('The local reply has no valid provenance or request identity.');
  const p = result.proposal;
  if (pending.kind === 'conversation') {
    const records = [...pending.scene.facts, ...(pending.scene.incidents || [])];
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length !== 2 || !Object.hasOwn(p, 'cited_facts') || !Object.hasOwn(p, 'proposal') || !Array.isArray(p.cited_facts) || p.cited_facts.length > 14 || new Set(p.cited_facts).size !== p.cited_facts.length || p.cited_facts.some(id => typeof id !== 'string' || !records.some(f => f.id === id))) throw new Error('The local match selected an unavailable or malformed record.');
    if (p.proposal !== null && !pending.scene.terms.some(t => t.id === p.proposal && t.eligible)) throw new Error('That offer was not available to the companion.');
    const text = p.cited_facts.length ? 'The local model selected these recorded observations.' : 'The local model selected no recorded observations.';
    line(run, 'character', text, 'local', pending.subject, [...p.cited_facts]).records = p.cited_facts.map(id => clone(records.find(f => f.id === id)));
    if (p.proposal) {
      const term = termById.get(p.proposal), view = termView(run, term);
      if (!view.eligible) throw new Error('The proposed agreement is no longer available.');
      run.preview = { id: run.epoch + ':' + run.nonce, kind: 'agreement', term: term.id, ticket: intent.ticket, provenance: 'local', text: term.description };
    }
    record(run, 'conversation', { person: pending.subject, provenance: 'local', cited_facts: p.cited_facts, proposal: p.proposal });
    cues.push({ kind: 'conversation', person: pending.subject });
    return text;
  }
  const f = machineFixture(run, pending.subject);
  if (!p || !['ready', 'clarify'].includes(p.status)) throw new Error('The local model did not return a work-order proposal.');
  if (p.status === 'clarify') {
    if (!Array.isArray(p.operations) || p.operations.length || typeof p.explanation !== 'string') throw new Error('Malformed clarification.');
    line(run, 'system', p.explanation, 'local');
    record(run, 'work-order-clarification', { console: f.id, provenance: 'local' });
    return p.explanation;
  }
  const summary = simulate(run, f, p.operations);
  run.preview = { id: run.epoch + ':' + run.nonce, kind: 'work_order', console: f.id, operations: clone(p.operations), ticket: intent.ticket, provenance: 'local', ...summary };
  record(run, 'plan-preview', { console: f.id, operations: p.operations, provenance: 'local' });
  return 'Review the interpreted work order, then confirm it.';
}

function advanceProgram(run, cues) {
  const p = run.program;
  if (!p) return;
  const original = fixtureById.get(p.console);
  const f = original?.chamber ? chamberFixture(run, original) : original;
  try {
    while (p.cursor < p.operations.length) {
      const op = p.operations[p.cursor];
      if (!applyOperation(run, f, op, cues, `${p.id}:${p.cursor}`)) {
        p.waiting = op.condition;
        return;
      }
      record(run, 'program-operation', { console: p.console, operation: op, program: p.id, cursor: p.cursor, provenance: p.provenance });
      p.waiting = null; p.cursor++;
      run.revision++;
    }
    record(run, 'program-complete', { console: p.console, program: p.id });
    run.program = null;
  } catch (error) {
    record(run, 'program-stopped', { console: p.console, reason: error.message });
    run.program = null;
    cues.push({ kind: 'message', text: 'The machine stopped safely. ' + error.message });
  }
}

function signalVector(s) {
  return s?.provenance === 'local' ? s.probabilities_after : s?.authored_spectrum;
}

function updateSpectrumFlags(run) {
  const sources = finaleSources(run);
  if (sources.every(source => source.vector)) {
    add(run.flags, 'spectra_ready');
    const vector = mixSpectra(sources.map(source => source.vector), run.mixWeights);
    run.mixture = ACTIONS.map(action => vector[action]);
    if (coreBalanced(vector, FINAL_BAND_TOLERANCE)) add(run.flags, 'signals_balanced'); else remove(run.flags, 'signals_balanced');
  } else {
    remove(run.flags, 'spectra_ready'); remove(run.flags, 'signals_balanced');
    run.mixture = [0, 0, 0];
  }
}

function applyAttunement(run, intent, cues) {
  const f = usableFixture(run, intent.fixture);
  if (f.kind !== 'attune') throw new Error('Unknown signal instrument.');
  if (!run.pending || run.pending.kind !== 'thought' || !sameTicket(run.pending, intent.ticket) || !freshTicket(run, intent.ticket) || intent.ticket.subject !== f.id) throw new Error('This attunement belongs to an older situation.');
  const r = intent.result;
  if (!r || !ACTIONS.includes(r.action) || !['local', 'archived', 'authored'].includes(r.provenance)) throw new Error('Invalid captured thought.');
  const receipt = 'thought:' + (r.id || `${intent.ticket.epoch}:${intent.ticket.nonce}`);
  if (run.receipts.includes(receipt)) throw new Error('This thought has already been applied.');
  let signal;
  if (r.provenance === 'local') {
    validateLocalProfile(r);
    signal = clone(r);
    if (r.steering?.applied) run.strain = clamp(run.strain + Math.ceil(6 * clamp(Number(r.steering.strength) || 0, 0, 1) * (r.steering.scope === 'broad' ? 1.5 : 1)), 0, 100);
  } else signal = { action: r.action, provenance: 'authored', utterance: r.utterance || 'An authored recovery signal.', authored_spectrum: Chambers.recoverySpectrum(r.action) };
  if (!run.flags.includes(f.flag)) {
    if (r.action === 'BRIDGE') add(run.flags, 'shortcut_' + f.zone);
    if (r.action === 'SHELTER') run.heat = clamp(run.heat + 1, 0, 9);
    if (r.action === 'SURGE') { run.strain = clamp(run.strain + 5, 0, 100); run.surgeSeconds = clamp(run.surgeSeconds + 75, 0, 150); }
  }
  run.spectra[f.signal] = { ...signal, signal: f.signal, fixture: f.id };
  rememberTool(run, { ...signal, signal: f.signal, fixture: f.id });
  add(run.flags, f.flag); add(run.receipts, receipt); run.pending = null; run.preview = null;
  updateSpectrumFlags(run); run.revision++;
  record(run, 'attunement', { signal: f.signal, action: r.action, provenance: sourceOf(r), steering: r.steering || null });
  cues.push({ kind: 'attuned', fixture: f.id, action: r.action, surgeSeconds: run.surgeSeconds });
}

export function act(state, intent) {
  if (!intent || typeof intent.kind !== 'string') return { state, message: 'Choose an interaction.', cues: [] };
  if (state.phase === 'victory' && !['authoredTalk', 'cancelPending', 'epilogue'].includes(intent.kind) && !(intent.kind === 'receive' && state.pending?.kind === 'conversation' && state.pending.afterEnding)) return { state, message: 'The crossing is sealed. Your choices are remembered.', cues: [] };
  if (intent.kind === 'tick' && !state.program && !state.motions.length) return { state, message: null, cues: [] };
  const run = clone(state), cues = [];
  let message = null;
  try {
    if (intent.kind === 'tick') {
      if (!finite(intent.seconds) || intent.seconds < 0 || intent.seconds > 1) throw new Error('Invalid machine time step.');
      for (const motion of run.motions) motion.elapsed = Math.min(motion.seconds, motion.elapsed + intent.seconds);
      for (const motion of run.motions.filter(m => m.elapsed >= m.seconds)) {
        add(run.flags, motion.flag); for (const id of motion.facts || []) add(run.facts, id); run.revision++;
        record(run, 'motion-complete', { motion: motion.id, flag: motion.flag });
        cues.push({ kind: 'motion-complete', id: motion.id });
      }
      run.motions = run.motions.filter(m => m.elapsed < m.seconds);
      advanceProgram(run, cues);
    } else if (intent.kind === 'interact') {
      const npc = PEOPLE.find(p => intent.id === 'person_' + p.id || intent.id === p.id);
      if (npc) {
        const p = { ...npc, ...run.people[npc.id] };
        if (!near(run, p)) throw new Error('Approach ' + npc.name + ' to speak in person.');
        cues.push({ kind: 'conversation', person: npc.id });
      } else {
        const f = usableFixture(run, intent.id);
        const physical = f.kind === 'item' && run.items[f.item]?.kind === 'world' ? { ...f, ...run.items[f.item] } : f;
        if (!near(run, physical)) throw new Error('Approach ' + f.label + ' first.');
        if (f.kind === 'item') {
          const location = run.items[f.item];
          if (location.kind !== 'world') throw new Error('This part has already been moved.');
          if (carried(run)) throw new Error('Carry one part at a time. Install it or put it down first.');
          if (Math.hypot(run.pos.x - location.x, run.pos.z - location.z) > 3.4) throw new Error('Find the part where you left it.');
          run.items[f.item] = { kind: 'carried' }; run.revision++;
          record(run, 'item-carried', { item: f.item });
          message = 'Carrying ' + f.label + '. Find its matching installation point.';
        } else if (f.kind === 'socket') {
          if (run.items[f.item]?.kind === 'installed' && run.items[f.item].socket === f.id) throw new Error('This part is already installed.');
          if (carried(run) !== f.item) throw new Error('Bring ' + f.item.replaceAll('_', ' ') + ' to this socket.');
          run.items[f.item] = { kind: 'installed', socket: f.id }; add(run.flags, f.flag); add(run.facts, f.fact);
          run.revision++; record(run, 'item-installed', { item: f.item, socket: f.id });
          cues.push({ kind: 'installed', fixture: f.id }); message = f.label + ' is installed.';
        } else if (f.kind === 'evidence') {
          if (f.id === 'hearing_record') parkReturn(run, cues);
          add(run.facts, f.fact); add(run.flags, f.flag); run.revision++;
          record(run, 'evidence', { fact: f.fact });
          cues.push({ kind: 'fact', fact: f.fact }); message = factText(f.fact);
        } else if (f.kind === 'console') cues.push({ kind: 'workbench', console: f.id });
        else if (f.kind === 'attune') cues.push({ kind: 'attune', fixture: f.id, signal: f.signal });
        else if (f.kind === 'report') {
          if (!hasAllGoals(run)) throw new Error('Before reporting. ' + missionGoals(run).filter(g => !run.flags.includes(g.flag)).map(g => g.text).join(' '));
          if (run.mission === MISSIONS.length - 1) cues.push({ kind: 'finale' });
          else {
            const done = current(run); addIncident(run, done.incident || done.id); run.mission++; run.revision++; run.nonce++;
            run.pending = null; run.preview = null; run.checkpoint = { x: f.x, z: f.z };
            record(run, 'chapter-start', { chapter: current(run).id });
            cues.push({ kind: 'chapter', index: run.mission }); message = current(run).title;
          }
        }
      }
    } else if (intent.kind === 'drop') {
      const id = carried(run);
      if (!id) throw new Error('You are not carrying a part.');
      if (heightAt(run.pos.x, run.pos.z, run.flags) === null) throw new Error('Keep hold of the part until you are on stable ground.');
      run.items[id] = { kind: 'world', fixture: Object.values(FIXTURES).find(f => f.kind === 'item' && f.item === id).id, x: run.pos.x, z: run.pos.z };
      run.revision++; record(run, 'item-dropped', { item: id }); message = 'Part put down safely.';
    } else if (intent.kind === 'manual') {
      const f = machineFixture(run, intent.console);
      if (!near(run, f)) throw new Error('Approach the console before changing its controls.');
      if (run.program) throw new Error('Wait for the current program or stop it first.');
      validateOperation(run, f, intent.operation);
      if (intent.operation.op === 'after') throw new Error('Use a program to wait for a machine condition.');
      applyOperation(run, f, intent.operation, cues, intent.operation.op === 'trigger' ? `manual:${intent.operation.trigger}:${run.revision}` : null);
      run.revision++; record(run, 'manual-operation', { console: f.id, operation: intent.operation }); message = operationLabels(f, [intent.operation])[0];
    } else if (intent.kind === 'receive') message = receive(run, intent, cues);
    else if (intent.kind === 'authoredPlan') {
      const f = machineFixture(run, intent.console);
      if (!near(run, f)) throw new Error('Approach the console to rehearse a work order.');
      const summary = simulate(run, f, intent.operations);
      run.nonce++; run.pending = null;
      run.preview = { id: run.epoch + ':' + run.nonce, kind: 'work_order', console: f.id, operations: clone(intent.operations), ticket: { epoch: run.epoch, nonce: run.nonce, revision: run.revision, mission: run.mission, subject: f.id }, provenance: 'authored', ...summary };
      message = 'Authored rehearsal. Review every step before confirming.';
    } else if (intent.kind === 'confirm') {
      const p = run.preview;
      if (!p || p.id !== intent.proposalId || !freshTicket(run, p.ticket)) throw new Error('This preview is no longer current. Rehearse it again.');
      if (p.kind === 'agreement') return act(state, { kind: 'acceptTerm', term: p.term });
      const f = machineFixture(run, p.console);
      if (!near(run, f)) throw new Error('Return to the console before starting the program.');
      if (run.program) throw new Error('Another program is still running.');
      simulate(run, f, p.operations);
      const receipt = 'program:' + p.id;
      if (run.receipts.includes(receipt)) throw new Error('This program was already started.');
      add(run.receipts, receipt);
      run.program = { id: p.id, console: f.id, operations: clone(p.operations), cursor: 0, waiting: null, provenance: p.provenance };
      run.preview = null; run.pending = null; run.revision++;
      record(run, 'program-start', { console: f.id, operations: p.operations, provenance: p.provenance });
      advanceProgram(run, cues); message = run.program ? 'The program is running. The machine will wait for its physical conditions.' : 'Work order executed.';
    } else if (intent.kind === 'cancelProgram') {
      run.program = null; run.revision++; message = 'Program stopped. Completed operations remain; no step will repeat.';
    } else if (intent.kind === 'acceptTerm') {
      const t = termById.get(intent.term);
      if (!t) throw new Error('Unknown agreement.');
      const term = termView(run, t);
      if (!term.eligible) throw new Error(term.accepted ? 'This agreement is already recorded.' : term.missing.join(' '));
      if (run.program) throw new Error('Wait for the machine program before changing reserve commitments.');
      run.heat -= t.heatCost; add(run.agreements, t.id); run.choices[t.person + ':' + current(run).id] = t.id;
      add(run.receipts, 'term:' + t.id); effects(run, t.effects, cues, t.id);
      addIncident(run, t.id); run.incidents.find(i => i.id === t.id).text = t.factText;
      run.revision++; run.pending = null; run.preview = null;
      record(run, 'agreement', { term: t.id, cost: t.heatCost }); message = t.label + '. The exact terms are recorded.';
    } else if (intent.kind === 'authoredTalk') {
      if (!personById.has(intent.person) || typeof intent.text !== 'string' || intent.text.length > 700) throw new Error('Invalid authored conversation.');
      line(run, 'character', intent.text, 'authored', intent.person); message = intent.text;
    } else if (intent.kind === 'cancelPending') {
      if (intent.ticket && !sameTicket(run.pending, intent.ticket)) throw new Error('That cancellation belongs to an older request.');
      run.nonce++; run.pending = null; run.preview = null; message = intent.message || 'The local request was cancelled. Manual controls remain available.';
    } else if (intent.kind === 'recover') {
      run.health = 85; run.energy = 100; run.pos = { ...run.checkpoint }; run.falls++;
      const returned = restoreSafeGround(run);
      if (returned.length) record(run, 'stranded-parts-recovered', { items: returned });
      run.nonce++; run.pending = null; run.preview = null;
      record(run, 'recovered'); message = 'Back on stable ground. Your parts, promises and repairs remain.';
    } else if (intent.kind === 'epilogue') {
      if (run.phase !== 'victory') throw new Error('Finish the crossing before entering its afterglow.');
      if (run.epilogue) return { state, message: 'The people are already home.', cues: [] };
      run.epilogue = true; returnPeopleToRefuge(run);
      const home = ZONES.find(z => z.id === 'refuge') || ZONES[0];
      run.pos = { x: home.x, z: home.z + Math.min(5, home.radius / 2) }; run.checkpoint = { ...run.pos };
      run.health = 100; run.energy = 100;
      run.nonce++; run.revision++; run.pending = null; run.preview = null;
      record(run, 'afterglow-entered'); cues.push({ kind: 'epilogue' });
      message = 'The people are home. The crossing is sealed; its record can still be heard.';
    } else if (intent.kind === 'attuned') applyAttunement(run, intent, cues);
    else if (intent.kind === 'mix') {
      if (!Array.isArray(intent.weights) || intent.weights.length !== 3 || intent.weights.some(w => !finite(w) || w < 0 || w > 100) || !intent.weights.some(w => w > 0)) throw new Error('Choose three finite allocations from zero to 100.');
      run.mixWeights = [...intent.weights]; updateSpectrumFlags(run); run.revision++;
      record(run, 'mix', { weights: run.mixWeights, mixture: run.mixture });
      message = run.flags.includes('signals_balanced') ? 'All three channels are balanced.' : 'Bring every channel within eight points of one third.';
    } else if (intent.kind === 'toolMix') {
      availableChamber(run, intent.fixture);
      if (!validWeights(intent.weights)) throw new Error('Choose three finite neural allocations from zero to 100.');
      run.toolWeights = [...intent.weights]; updateTools(run); run.revision++;
      record(run, 'tool-mix', { weights: run.toolWeights, mixture: run.toolMixture }); message = 'The routing chamber is powered by these actual retained profiles.';
    } else if (intent.kind === 'referenceTool') {
      availableChamber(run, intent.fixture);
      if (!ACTIONS.includes(intent.action)) throw new Error('Choose an authored reference action.');
      rememberTool(run, { action: intent.action, provenance: 'authored', authored_spectrum: Chambers.recoverySpectrum(intent.action) });
      run.revision++; record(run, 'reference-tool', { action: intent.action }); message = 'Explicit authored recovery spectrum. No inference or measured activation edit.';
    } else if (intent.kind === 'referenceSignal') {
      if (finaleSources(run).every(source => source.kind === 'sealed_chamber_mix')) throw new Error('The earned chamber outputs are sealed. Compose their currents without replacing the original captures.');
      if (run.mission !== MISSIONS.length - 1 || !SIGNALS.includes(intent.signal) || !ACTIONS.includes(intent.action)) throw new Error('Reference calibration is available at the final composer.');
      run.spectra[intent.signal] = { signal: intent.signal, action: intent.action, provenance: 'authored', authored_spectrum: Chambers.recoverySpectrum(intent.action) };
      updateSpectrumFlags(run); run.revision++;
      record(run, 'reference-signal', { signal: intent.signal, action: intent.action }); message = 'Explicit authored reference. No model inference or measurement.';
    } else if (intent.kind === 'ground') {
      const home = ZONES.find(z => z.id === 'refuge') || ZONES[0];
      if (run.mission !== MISSIONS.length - 1 && Math.hypot(run.pos.x - home.x, run.pos.z - home.z) > home.radius) throw new Error('Ground the signal at the refuge or final composer.');
      run.strain = Math.max(0, run.strain - 12); run.revision++;
      record(run, 'grounded', { strain: run.strain }); message = 'Signal grounded. Historical scars remain.';
    } else if (intent.kind === 'finish') {
      const final = finaleView(run), distribution = final.distributions.find(d => d.id === intent.distribution);
      if (!distribution) throw new Error('Choose who receives the final reserve.');
      if (!distribution.eligible) throw new Error(distribution.missing.join(' '));
      const sources = clone(finaleSources(run));
      run.phase = 'victory'; run.distribution = intent.distribution; run.nonce++; run.pending = null; run.preview = null;
      run.ending = { distribution: intent.distribution, heat: run.heat, scars: run.scars, agreements: [...run.agreements], choices: { ...run.choices }, spectra: clone(run.spectra), sources, mixWeights: [...run.mixWeights], mixture: [...run.mixture], engagedSeconds: clockTotal(run) };
      record(run, 'crossing-complete', { distribution: intent.distribution, heat: run.heat, strain: run.strain });
      cues.push({ kind: 'victory', distribution: intent.distribution }); message = 'The last crossing is complete.';
    } else throw new Error('Unknown campaign action.');
    return { state: run, message, cues };
  } catch (error) {
    if (['receive', 'attuned'].includes(intent.kind) && state.pending && sameTicket(state.pending, intent.ticket)) {
      const cleared = clone(state); cleared.pending = null;
      record(cleared, 'reply-rejected', { reason: error.message });
      return { state: cleared, message: error.message, cues: [] };
    }
    return { state, message: error.message, cues: [] };
  }
}


function normalizedVector(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'BRIDGE,SHELTER,SURGE' || ACTIONS.some(action => !finite(value[action]) || value[action] < 0)) return null;
  const total = ACTIONS.reduce((sum, action) => sum + value[action], 0);
  return total > 0 && finite(total) ? (Math.abs(total - 1) < 1e-12 ? { ...value } : Object.fromEntries(ACTIONS.map(action => [action, value[action] / total]))) : null;
}
function sealedComponents(run, signal, vector) {
  const event = run.events.findLast(event => event.type === 'chamber-commit' && event.site === signal && event.stage === 2 && event.pass && event.complete);
  if (!event || !Array.isArray(event.provenance) || !event.provenance.length || event.provenance.length > 3) return [];
  const records = event.provenance;
  if (new Set(records.map(record => record.action)).size !== records.length || records.some(record => !ACTIONS.includes(record.action) || !['local', 'authored'].includes(record.provenance) || (record.provenance === 'local' && (typeof record.id !== 'string' || !record.id)) || !normalizedVector(record.probabilities))) return [];
  const rawWeights = records.map(record => finite(record.weight) && record.weight > 0 ? record.weight : event.weights?.[ACTIONS.indexOf(record.action)]);
  if (rawWeights.some(weight => !finite(weight) || weight <= 0)) return [];
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0), weights = rawWeights.map(weight => weight / total);
  const reconstructed = normalizedVector(Object.fromEntries(ACTIONS.map(action => [action, records.reduce((sum, record, index) => sum + record.probabilities[action] * weights[index], 0)])));
  if (ACTIONS.some(action => Math.abs(reconstructed[action] - vector[action]) > 1e-8)) return [];
  return records.map((record, index) => ({ action: record.action, weight: weights[index], provenance: record.provenance, recordId: record.id || null, modelRevision: record.model_revision || null }));
}
function rawFinaleSource(signal, capture) {
  const vector = normalizedVector(signalVector(capture)), provenance = capture?.provenance === 'authored' ? 'authored' : capture?.provenance === 'local' && typeof capture.id === 'string' && capture.id ? 'local' : 'unknown';
  return { signal, label: Chambers.CATALOG[signal].title, kind: vector ? 'legacy_capture' : 'missing', vector,
    components: vector ? [{ action: capture.action, weight: 1, provenance, recordId: capture.id || null, modelRevision: capture.model_revision || null }] : [],
    provenanceKnown: !!(vector && provenance !== 'unknown'), sourceLabel: vector ? 'LEGACY RAW CAPTURE' : 'SOURCE NOT YET EARNED' };
}
function finaleSources(run) {
  if (run.phase === 'victory' && run.ending) {
    if (Array.isArray(run.ending.sources) && run.ending.sources.length === 3) return clone(run.ending.sources);
    return SIGNALS.map(signal => rawFinaleSource(signal, run.ending.spectra?.[signal]));
  }
  return SIGNALS.map(signal => {
    const chamber = run.chambers?.[signal], vector = chamber?.complete ? normalizedVector(chamber.committedProfile) : null;
    if (!vector) return rawFinaleSource(signal, run.spectra[signal]);
    const components = sealedComponents(run, signal, vector);
    return { signal, label: Chambers.CATALOG[signal].title, kind: 'sealed_chamber_mix', vector, components, provenanceKnown: components.length > 0,
      sourceLabel: components.length ? 'SEALED CHAMBER MIX' : 'SEALED CHAMBER MIX · COMPONENT HISTORY UNKNOWN' };
  });
}
function normalizedShares(weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => total > 0 ? weight / total : 0);
}
function mixFeasibility(sources, minimumShare) {
  if (sources.some(source => !source.vector)) return { possible: null, reason: 'Earn each missing station current by completing its routing chamber.' };
  const low = 1 / 3 - FINAL_BAND_TOLERANCE, high = 1 / 3 + FINAL_BAND_TOLERANCE;
  const constraints = [[-1, 0, -minimumShare], [0, -1, -minimumShare], [1, 1, 1 - minimumShare]];
  for (const action of ACTIONS) {
    const [a, b, c] = sources.map(source => source.vector[action]);
    constraints.push([a - c, b - c, high - c], [c - a, c - b, c - low]);
  }
  for (let i = 0; i < constraints.length; i++) for (let j = i + 1; j < constraints.length; j++) {
    const [a, b, c] = constraints[i], [d, e, f] = constraints[j], determinant = a * e - b * d;
    if (Math.abs(determinant) < 1e-12) continue;
    const x = (c * e - b * f) / determinant, y = (a * f - c * d) / determinant;
    if (constraints.every(([a, b, c]) => a * x + b * y <= c + 1e-9)) return { possible: true, reason: minimumShare ? 'These earned currents can be balanced while every station retains at least 5% pilot current.' : 'These legacy captures can be balanced with the current sliders; completing the chambers earns sealed station outputs.' };
  }
  const shortfall = ACTIONS.find(action => Math.max(...sources.map(source => source.vector[action])) < low - 1e-9);
  return { possible: false, reason: shortfall ? `${shortfall} never exceeds ${(Math.max(...sources.map(source => source.vector[shortfall])) * 100).toFixed(1)}% in these captures; the crossing needs at least ${(low * 100).toFixed(1)}%. Complete the unsealed routing chambers to earn their station outputs.` : 'These captures have no allocation within the crossing limits. Complete the unsealed routing chambers to earn their station outputs.' };
}

function finaleView(run) {
  const sources = finaleSources(run), minimumShare = sources.every(source => source.kind === 'sealed_chamber_mix') ? MIN_CHAMBER_SHARE : 0, shares = normalizedShares(run.mixWeights), feasibility = mixFeasibility(sources, minimumShare);
  const recoverySites = sources.filter(source => source.kind !== 'sealed_chamber_mix').map(source => { const fixture = chamberFixtures.find(f => f.signal === source.signal); return { signal: source.signal, fixture: fixture.id, label: source.label, zone: fixture.zone, zoneLabel: ZONES.find(zone => zone.id === fixture.zone).name }; });
  const reasons = [];
  if (minimumShare) sources.forEach((source, index) => { if (shares[index] < minimumShare - 1e-10) reasons.push(`${source.label} is below the 5% minimum pilot current; increase its relative allocation.`); });
  if (feasibility.possible === false) reasons.push(feasibility.reason);
  if (run.mission !== MISSIONS.length - 1) reasons.push('Reach the final crossing.');
  else reasons.push(...missionGoals(run).filter(g => !run.flags.includes(g.flag)).map(g => g.text));
  if (!run.flags.includes('signals_balanced')) reasons.push('Balance the three retained signals.');
  if (run.strain > 35) reasons.push('Ground strain to 35 or lower.');
  if (run.program || run.motions.length) reasons.push('Wait for the physical transfer to finish.');
  const archiveMissing = ['original_records', 'manifest_archive', 'archive_loaded', 'archive_counterbalance_prepared'].filter(f => !run.flags.includes(f)).map(f => ({
    original_records: run.flags.includes('digest_records') ? 'The chosen digest omits the original names; the passenger ending remains available.' : 'The original named index was not preserved.',
    manifest_archive: run.flags.includes('manifest_sealed') ? 'The sealed manifest covers people only.' : 'A named-archive manifest has not been sealed at the hearing.',
    archive_loaded: run.flags.includes('load_chosen') ? 'The committed load does not retain named-archive freight.' : 'Named-archive freight has not been allocated at the governor.',
    archive_counterbalance_prepared: 'The archive channel has not been balanced at the crown.',
  })[f]);
  return { canFinish: reasons.length === 0, reasons, sources, shares, minimumShare, mixFeasibility: feasibility, recoverySites, distributions: [
    { id: 'people', label: 'Give the final reserve to the people', eligible: reasons.length === 0, missing: [...reasons] },
    { id: 'archive', label: 'Carry the named archive into the crossing', eligible: reasons.length === 0 && !archiveMissing.length, missing: [...reasons, ...archiveMissing] },
  ] };
}

export function view(run) {
  const mission = current(run);
  const fixtures = FIXTURES.filter(f => inMission(f, run) || pastItem(f, run) || (f.kind === 'socket' && run.items[f.item]?.socket === f.id) || (f.kind === 'attune' && run.flags.includes(f.flag)) || (f.kind === 'evidence' && run.facts.includes(f.fact))).map(f => {
    const item = f.kind === 'item' ? run.items[f.item] : null;
    let complete = !!(f.flag && run.flags.includes(f.flag));
    if (f.kind === 'evidence') complete = run.facts.includes(f.fact);
    if (f.kind === 'socket') complete = run.items[f.item]?.kind === 'installed' && run.items[f.item].socket === f.id;
    if (f.kind === 'report') complete = hasAllGoals(run);
    return { ...f, x: item?.kind === 'world' ? item.x : f.x, z: item?.kind === 'world' ? item.z : f.z, active: inMission(f, run) || pastItem(f, run), complete, installed: complete && f.kind === 'socket', carried: item?.kind === 'carried', hidden: item && item.kind !== 'world', status: complete ? 'Complete' : f.kind === 'console' ? 'Configure / program' : f.kind === 'attune' ? 'Capture signal' : 'Explore' };
  }).filter(f => !f.hidden);
  const people = PEOPLE.map(p => ({ ...p, ...run.people[p.id], kind: 'npc', person: p.id, interactionId: 'person_' + p.id, complete: false, active: true }));
  const zones = new Set([ZONES[0].id, ...MISSIONS.slice(0, run.mission + 1).map(m => m.zone), ...MISSIONS.slice(0, run.mission).flatMap(m => m.unlocks || [])]);
  const terms = TERMS.filter(t => inMission(t, run)).map(t => termView(run, t));
  return {
    mission: { ...mission, goals: missionGoals(run), index: run.mission, total: MISSIONS.length, ready: hasAllGoals(run) },
    objectives: missionGoals(run).map(g => ({ ...g, complete: run.flags.includes(g.flag) })), fixtures, people,
    interactions: [...fixtures.filter(f => f.active || f.kind === 'attune'), ...people.map(p => ({ ...p, id: p.interactionId }))],
    machines: [...consoles.filter(f => inMission(f, run)), ...chamberFixtures.filter(f => inMission(f, run) || run.flags.includes(f.flag)).map(f => chamberFixture(run, f))].map(f => makeMachinePanel(run, f)),
    terms, journal: run.facts.map(id => ({ id, text: factText(id) })), incidents: clone(run.incidents),
    conversation: run.conversation, preview: run.preview, pending: run.pending, carried: carried(run),
    map: ZONES.map(z => ({ ...z, unlocked: zones.has(z.id) })), unlockedZones: [...zones],
    chambers: clone(run.chambers), toolBank: clone(run.toolBank), toolWeights: [...run.toolWeights], toolMixture: { ...run.toolMixture },
    returnLine: run.returnLine && run.mission >= 4 ? returnView(run) : null,
    spectra: clone(run.spectra), mixWeights: [...run.mixWeights], mixture: [...run.mixture], finale: finaleView(run),
    diagnostics: { version: 3, mission: run.mission, missionId: mission.id, completeObjectives: missionGoals(run).filter(g => run.flags.includes(g.flag)).length, objectives: missionGoals(run).length, revision: run.revision, pending: run.pending?.kind || null, program: run.program ? { console: run.program.console, cursor: run.program.cursor, steps: run.program.operations.length, waiting: run.program.waiting } : null, heat: run.heat, strain: run.strain, surgeSeconds: run.surgeSeconds, epilogue: run.epilogue, facts: run.facts.length, agreements: run.agreements.length, carried: carried(run), phase: run.phase },
  };
}
