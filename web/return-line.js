import { PROFILES as archived } from './return-line-profiles.js';

// Offline replay. These transfer laws are NEW AUTHORED GAME RULES, not a
// measurement of a motor, a fresh neural call, or a claim about fine gain.
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const PROFILES = freeze(archived);
export const CASES = freeze([1, 2, 3].flatMap(site => ['binding', 'slipping'].map(kind => ({ site, kind }))));
const copy = value => structuredClone(value);
const profile = state => PROFILES.find(row => row.id === state.settings.source);
const same = (a, b) => a?.site === b?.site && a?.part === b?.part;
const parts = { bushing: 'binding', clutch_sleeve: 'slipping' };
const handles = [
  { id: 'source', label: 'Recorded input', op: 'set', values: PROFILES.map(row => ({ id: row.id, label: `${row.id}: B=${row.vector.BRIDGE} S=${row.vector.SHELTER} G=${row.vector.SURGE}; archived E2B` })) },
  { id: 'repair_site', label: 'Service fixture location', op: 'set', values: [1, 2, 3].map(id => ({ id: String(id), label: `Housing ${id}` })) },
  { id: 'part', label: 'Temporary service insert', op: 'set', values: ['none', 'bushing', 'clutch_sleeve'].map(id => ({ id, label: id.replaceAll('_', ' ') })) },
  { id: 'support', label: 'Operating support', op: 'set', values: ['none', 'reserve', 'iona', 'pawl'].map(id => ({ id, label: ({ none: 'Choose support', reserve: 'Spend one reserve heat; full return, crew free', iona: 'Iona holds brace; explicit agreement, full return, duty reserved', pawl: 'Fixed pawl; essential basin only, heat and crew kept' })[id] })) },
];
const triggers = [
  ...[1, 2, 3].map(tap => ({ id: `probe_${tap}`, label: `Read pickup after housing ${tap}`, requirements: 'Safe observation; no heat or consent needed.' })),
  { id: 'fit', label: 'Seat the selected temporary insert', requirements: 'Select a part; no successful repair is assumed.' },
  { id: 'remove', label: 'Remove the temporary fixture', requirements: 'Keeps discovered observations and does not refund spent heat.' },
  { id: 'commission', label: 'Make the actual operating trial', requirements: 'Choose support; source force >=0.90. Actual force transmission determines outcome; preview cannot know it.' },
];
const conditions = [{ id: 'return_flowing', label: 'Actual clinic return is flowing' }];

export function start({ fault = CASES[0] } = {}) {
  if (!CASES.some(c => c.site === fault.site && c.kind === fault.kind)) throw Error('Invalid authored scenario.');
  return {
    version: 1, secret: copy(fault), revision: 0, phase: 'diagnosing',
    settings: { source: 'record_1', tap: '1', repair_site: '1', part: 'none', support: 'none' },
    kit: 1, parked: null,
    fixture: null, observations: [], receipts: [], outcome: null,
    lastMeasurementId: null, measurementSerial: 0, lastMeasurementRevision: null,
    message: 'The refuge return line falters under a working pull. Three identical housings lie between the drive and the clinic. Find where force is lost before sealing a repair.',
  };
}

function drive(row) { return Math.max(0, row.vector.BRIDGE - .25 * row.vector.SURGE); }
function transmission(state) {
  const input = drive(profile(state)), shelter = profile(state).vector.SHELTER;
  const repaired = state.fixture?.site === state.secret.site && parts[state.fixture?.part] === state.secret.kind;
  const readings = [];
  let force = input;
  for (let site = 1; site <= 3; site++) {
    if (!repaired && state.secret.site === site) {
      force = state.secret.kind === 'binding'
        ? Math.max(0, force - .22 * (1 + shelter))
        : Math.min(force, .40 * (.30 + shelter));
    }
    readings.push(force);
  }
  return { input, readings };
}

function observe(state, key, reading) {
  const prior = state.observations.find(row => row.key === key);
  if (prior) return prior;
  const row = { id: `obs_${state.observations.length + 1}`, key, ...reading };
  state.observations.push(row);
  if (state.observations.length > 81) throw Error('Finite observation bound exceeded.');
  return row;
}

function validate(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw Error('Choose a literal operation.');
  if (operation.op === 'set') {
    if (Object.keys(operation).sort().join(',') !== 'handle,op,value') throw Error('Set takes only op, handle and value.');
    if (!handles.find(h => h.id === operation.handle)?.values.some(v => v.id === operation.value)) throw Error('Unknown handle or value.');
  } else if (operation.op === 'trigger') {
    if (Object.keys(operation).sort().join(',') !== 'op,trigger' || !['probe_1', 'probe_2', 'probe_3', 'fit', 'remove', 'commission'].includes(operation.trigger)) throw Error('Unknown trigger.');
  } else if (operation.op === 'after') {
    if (Object.keys(operation).sort().join(',') !== 'condition,op' || operation.condition !== 'return_flowing') throw Error('Unknown condition.');
  } else throw Error('Only bounded literal set/trigger/after operations exist here.');
}

export function act(state, operation, context = {}) {
  const { heat = 0, consent = false } = context;
  if (!Number.isInteger(heat) || heat < 0 || heat > 9 || typeof consent !== 'boolean') throw Error('Invalid canonical return context.');
  validate(operation);
  if (state.phase === 'complete') return { state, waiting: false, heatCost: 0 };
  if (operation.op === 'after') return { state, waiting: operation.condition === 'return_flowing', heatCost: 0 };
  const next = copy(state);
  const s = next.settings;
  let heatCost = 0;
  if (operation.op === 'set') s[operation.handle] = operation.value;
  else if (/^probe_[123]$/.test(operation.trigger)) {
    s.tap = operation.trigger.slice(-1);
    const row = profile(next), measured = transmission(next), tap = Number(s.tap);
    const mounted = next.fixture ? `${next.fixture.site}/${next.fixture.part}` : 'no insert';
    const observed = observe(next, `probe:${s.source}:${tap}:${mounted}`, {
      type: 'probe', source: s.source, tap, fixture: copy(next.fixture),
      input: measured.input, output: measured.readings[tap - 1],
      text: `${s.source}, pickup after housing ${tap}, ${mounted}: input ${measured.input.toFixed(6)}, output ${measured.readings[tap - 1].toFixed(6)}. Exact input spectrum B=${row.vector.BRIDGE}, S=${row.vector.SHELTER}, G=${row.vector.SURGE}.`,
    });
    next.lastMeasurementId = observed.id; next.measurementSerial++; next.lastMeasurementRevision = next.revision + 1;
    next.message = observed.text;
  } else if (operation.trigger === 'fit') {
    if (!next.kit || s.part === 'none') throw Error('Select a service insert before fitting the reusable fixture.');
    next.fixture = { site: Number(s.repair_site), part: s.part };
    next.message = 'The service insert is temporarily seated. The previous fixture returned to the case. No repair is assumed; probe or make a real operating trial.';
  } else if (operation.trigger === 'remove') {
    next.fixture = null;
    next.message = 'The unsealed fixture is back in the case. Observations and any heat already spent remain.';
  } else if (operation.trigger === 'commission') {
    if (!next.fixture) throw Error('Seat a service insert first.');
    if (s.support === 'none') throw Error('Choose the visible heat/crew/limited-flow support consequence.');
    if (drive(profile(next)) < .90) throw Error('This actual recorded input cannot supply the declared working pull of 0.90. Safe probes remain available.');
    if (s.support === 'iona' && !consent) throw Error('Iona has not agreed to hold this return brace.');
    const key = `trial:${s.source}:${next.fixture.site}:${next.fixture.part}:${s.support}`;
    const repeated = next.receipts.includes(key);
    if (!repeated && s.support === 'reserve') {
      if (heat < 1) throw Error('No reserve heat remains. The fixed pawl is a resource-free limited-flow support; an offered, explicitly accepted crew agreement is another route.');
      heatCost = 1;
    }
    if (!repeated) next.receipts.push(key);
    const measured = transmission(next), output = measured.readings[2];
    const efficiency = measured.input ? output / measured.input : 0;
    const observed = observe(next, key, {
      type: 'trial', source: s.source, fixture: copy(next.fixture), support: s.support,
      input: measured.input, output, efficiency, heatCost, heatAfter: heat - heatCost,
      text: `Operating trial with ${next.fixture.part} at housing ${next.fixture.site}, ${s.support} support: input ${measured.input.toFixed(6)}, terminal output ${output.toFixed(6)}, transmission ${(100 * efficiency).toFixed(3)}%. Heat after this recorded trial ${heat - heatCost}.`,
    });
    next.lastMeasurementId = observed.id; next.measurementSerial++; next.lastMeasurementRevision = next.revision + 1;
    if (efficiency >= .95) {
      next.phase = 'complete'; next.kit = 0;
      next.outcome = {
        flow: s.support === 'pawl' ? 'essential_basin_only' : 'full_clinic_return',
        support: s.support, heatAtCommission: heat - heatCost, fixture: copy(next.fixture),
        source: copy(profile(next)), input: measured.input, output, efficiency,
        agreement: s.support === 'iona' ? 'return_brace_iona' : null,
      };
      next.message = s.support === 'pawl'
        ? 'The essential basin runs. The fixed pawl leaves the larger clinic loop closed without an additional heat or crew commitment. Earlier trial costs remain recorded.'
        : `The full clinic return runs. ${s.support === 'reserve' ? 'One reserve heat was spent; Iona remains available.' : 'No heat was spent on this trial; Iona holds through preparations and parks the full loop to essential flow at the hearing.'}`;
    } else next.message = 'Force is still lost before the clinic. The fixture is unsealed and can be removed or reseated. Keep the actual trial observation; any heat spent stays spent.';
  }
  next.revision++;
  return { state: next, waiting: false, heatCost };
}

// Preview never simulates the secret into a free observation or success oracle.
export function preview(state, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 8) throw Error('Use one to eight literal operations.');
  operations.forEach(validate);
  const used = operations.filter(op => op.op === 'trigger').map(op => op.trigger);
  if (new Set(used).size !== used.length) throw Error('One work order cannot repeat a trigger ID.');
  let selectedSupport = state.settings.support, potentialHeatCost = 0;
  for (const operation of operations) {
    if (operation.op === 'set' && operation.handle === 'support') selectedSupport = operation.value;
    else if (operation.op === 'trigger' && operation.trigger === 'commission' && selectedSupport === 'reserve') potentialHeatCost++;
  }
  return {
    operations: copy(operations),
    nonPredictive: true, potentialHeatCost,
    heatRiskPerNewReserveTrial: 1,
    note: 'A probe produces an observation only when executed. A service insert is a hypothesis until physically tested. Full return consumes reserve heat or an accepted Iona duty; the fixed pawl yields essential-basin flow only. This preview cannot predict an unobserved hidden fault.',
  };
}

export function view(state, context = {}) {
  const { heat = 0, consent = false, ionaOffer = false, available = false } = context;
  return {
    phase: state.phase, settings: copy(state.settings), fixture: copy(state.fixture),
    heat, kit: state.kit, available, crewDuty: state.outcome ? (state.outcome.support === 'iona' && !state.parked ? 'holding_return_brace' : 'available') : consent ? 'return_brace_ready' : 'available',
    ionaOffer, agreement: consent ? { person: 'iona', term: 'return_brace_iona', scope: 'preparations_until_hearing' } : null,
    rules: serviceFacts(state, context), profiles: copy(PROFILES), handles: handles.map(h => ({ ...copy(h), current: state.settings[h.id] })),
    triggers: copy(triggers), conditions: copy(conditions),
    observations: copy(state.observations), observationTable: observedTable(state),
    lastMeasurement: copy(state.observations.find(row => row.id === state.lastMeasurementId) || null),
    measurementSerial: state.measurementSerial, measurementRevision: state.lastMeasurementRevision, revision: state.revision,
    outcome: copy(state.outcome), parked: copy(state.parked), currentFlow: state.parked ? 'essential_basin_only' : state.outcome?.flow || null, message: state.message,
  };
}

// All discovered force evidence, grouped without consulting the hidden fault.
// The compact table and the literal log use the same six-decimal precision.
export function observedTable(state) {
  const groups = new Map();
  for (const row of state.observations) {
    const mounted = row.fixture ? `${row.fixture.site}${row.fixture.part === 'bushing' ? 'b' : 'c'}` : '-';
    const source = `r${row.source.slice(-1)}`, key = `${source}/${mounted}`;
    if (!groups.has(key)) groups.set(key, { key, input: row.input, outputs: {}, supports: new Set() });
    const group = groups.get(key);
    group.outputs[row.type === 'probe' ? `p${row.tap}` : 'T'] = row.output;
    if (row.type === 'trial') group.supports.add(({ reserve: 'R', iona: 'I', pawl: 'P' })[row.support]);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).map(group => {
    const values = ['p1', 'p2', 'p3', 'T'].filter(key => key in group.outputs).map(key => `${key}=${group.outputs[key].toFixed(6)}${key === 'T' ? `[${['R', 'I', 'P'].filter(s => group.supports.has(s)).join('')}]` : ''}`);
    return `${group.key} in=${group.input.toFixed(6)} ${values.join(' ')}`;
  });
}

function tableCards(state) {
  const chunks = [];
  for (const row of observedTable(state)) {
    if (!chunks.length || chunks.at(-1).length + row.length + 1 > 600) chunks.push(row);
    else chunks[chunks.length - 1] += '\n' + row;
  }
  if (chunks.length > 3) throw Error('Observed table exceeds the existing three-card evidence budget.');
  return chunks.map((text, index) => ({ id: `observed_table_${index + 1}`, text }));
}

// Presentation rate from an actual measurement pulse, never historical work.
// Changing source, pickup or fixture stops the old pulse immediately.
export function measuredMotion(projection, housing, elapsedMs) {
  if (projection.currentFlow) return projection.currentFlow === 'full_clinic_return' ? .8 : .4;
  const row = projection.lastMeasurement;
  if (!row || projection.revision !== projection.measurementRevision || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= 900 || row.source !== projection.settings.source || !same(row.fixture, projection.fixture)) return 0;
  if (row.type === 'probe' && (row.tap !== housing || row.tap !== Number(projection.settings.tap))) return 0;
  if (row.type === 'trial' && housing !== 3) return 0;
  return .65 * Math.max(0, row.output) * (1 - elapsedMs / 900);
}

function serviceFacts(state, context = {}) {
  const { heat = 0, consent = false, ionaOffer = false } = context;
  const facts = [
    { id: 'line_layout', text: 'The return drive crosses housings 1, 2 and 3 in that order. Exactly one housing has either a binding bearing or a slipping clutch. Every healthy housing passes incoming force unchanged. The initial faltering symptom does not identify the housing or the fault.' },
    { id: 'authored_probe_law', text: 'AUTHORED laws: source=max(0,Bridge-0.25*Surge); binding subtracts 0.22*(1+Shelter), floored at zero; slipping caps output at 0.40*(0.30+Shelter). Pickups read AFTER a housing. Table: r1..3=record_1..3; -=no insert; 2b/2c=house2 bushing/clutch sleeve (likewise1/3); p1..3=pickup outputs; T=trial terminal; [RIP]=trialled reserve/Iona/pawl supports; in=input. Missing fields are unmeasured. All values use the visible log\'s six decimals. These are game laws, not measured model abilities.' },
    { id: 'service_kit', text: `The temporary kit has a bushing for a binding bearing and a clutch sleeve for a slipping clutch. You can move or remove the fixture until a working trial succeeds. A correct insert restores transmission at its housing. A trial needs input of at least 0.90 and at least 95% transmission; pickups are safe and free. ${state.phase === 'complete' ? 'The return has passed its trial.' : 'The return still needs a successful trial.'} ${state.fixture ? `A ${state.fixture.part.replaceAll('_', ' ')} is fitted at housing ${state.fixture.site}.` : 'No insert is fitted.'} ${state.kit ? 'The kit is available.' : 'The kit is sealed into the repair.'} Changing the controls does not fit or move the insert.` },
    { id: 'support_choices', text: `Reserve support spends one heat per new operating trial for full clinic flow. Iona's separate brace job needs your explicit acceptance; neither controls nor work orders can grant it. She holds through preparations, then secures essential flow on the fixed pawl at the hearing and leaves with everyone. The fixed pawl needs no heat or crew and serves only the essential basin. You have ${heat} unit${heat === 1 ? '' : 's'} of reserve heat. ${consent ? 'You accepted her brace offer.' : ionaOffer ? 'Iona is offering this brace job.' : 'Iona has not offered this brace job.'} Wrong inserts can be reseated; spent heat stays spent.` },
  ];
  if (consent) facts.push({ id: 'iona_accepted', text: "You accepted Iona's separate offer to hold this return brace through preparations. When the hearing record is read, she secures the line on its fixed pawl: the essential basin keeps running, the larger clinic loop closes, and she leaves with everyone. The pantry's earlier latch plan is a different job, not permission for this brace. A signal cannot accept the offer." });
  return facts;
}

export function facts(state, context) { return [...serviceFacts(state, context), ...tableCards(state)]; }
export const CATALOG = freeze({ handles, triggers, conditions });

export function park(state) {
  if (!state.outcome || state.outcome.support !== 'iona' || state.parked) return state;
  const next = copy(state);
  next.parked = { reason: 'hearing_record', from: 'full_clinic_return', to: 'essential_basin_only' };
  next.revision++;
  next.message = 'Iona parked the return on its fixed pawl for departure. The essential basin keeps running; the larger loop is closed, and she leaves with everyone.';
  return next;
}

function equal(a, b) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw Error('Malformed return-line record.');
}
function validFixture(value) {
  if (value === null) return;
  exact(value, ['site', 'part']);
  if (![1, 2, 3].includes(value.site) || !(value.part in parts)) throw Error('Invalid return-line fixture.');
}
export function restore(value) {
  const fresh = start();
  exact(value, Object.keys(fresh));
  const s = copy(value);
  exact(s.secret, ['site', 'kind']);
  if (s.version !== 1 || !CASES.some(c => equal(c, s.secret)) || !Number.isInteger(s.revision) || s.revision < 0 || s.revision > 1000000 || !['diagnosing', 'complete'].includes(s.phase)) throw Error('Invalid saved return-line fault or phase.');
  exact(s.settings, Object.keys(fresh.settings));
  if (!['1', '2', '3'].includes(s.settings.tap)) throw Error('Invalid internal pickup setting.');
  for (const h of handles) if (!h.values.some(v => v.id === s.settings[h.id])) throw Error('Invalid return-line control.');
  validFixture(s.fixture);
  if (!Array.isArray(s.observations) || s.observations.length > 81 || !Array.isArray(s.receipts) || s.receipts.length > 54 || new Set(s.receipts).size !== s.receipts.length) throw Error('Invalid return-line history bounds.');
  const keys = new Set();
  for (const [index, row] of s.observations.entries()) {
    if (!row || !['probe', 'trial'].includes(row.type) || row.id !== `obs_${index + 1}` || typeof row.key !== 'string' || keys.has(row.key) || !PROFILES.some(p => p.id === row.source) || typeof row.text !== 'string' || row.text.length > 2000) throw Error('Invalid return-line observation.');
    keys.add(row.key); validFixture(row.fixture);
    const measured = transmission({ secret: s.secret, fixture: row.fixture, settings: { source: row.source } });
    if (row.input !== measured.input) throw Error('Saved return-line input disagrees with its recorded profile.');
    if (row.type === 'probe') {
      exact(row, ['id', 'key', 'type', 'source', 'tap', 'fixture', 'input', 'output', 'text']);
      const mounted = row.fixture ? `${row.fixture.site}/${row.fixture.part}` : 'no insert';
      if (![1, 2, 3].includes(row.tap) || row.key !== `probe:${row.source}:${row.tap}:${mounted}` || row.output !== measured.readings[row.tap - 1]) throw Error('Saved pickup disagrees with the fault and fitted insert.');
    } else {
      exact(row, ['id', 'key', 'type', 'source', 'fixture', 'support', 'input', 'output', 'efficiency', 'heatCost', 'heatAfter', 'text']);
      if (!row.fixture || !['reserve', 'iona', 'pawl'].includes(row.support) || row.key !== `trial:${row.source}:${row.fixture.site}:${row.fixture.part}:${row.support}` || measured.input < .90 || row.output !== measured.readings[2] || row.efficiency !== row.output / row.input || row.heatCost !== (row.support === 'reserve' ? 1 : 0) || !Number.isInteger(row.heatAfter) || row.heatAfter < 0 || row.heatAfter > 9) throw Error('Invalid saved operating-trial receipt.');
    }
    const source = PROFILES.find(p => p.id === row.source), mounted = row.fixture ? `${row.fixture.site}/${row.fixture.part}` : 'no insert';
    const text = row.type === 'probe'
      ? `${row.source}, pickup after housing ${row.tap}, ${mounted}: input ${row.input.toFixed(6)}, output ${row.output.toFixed(6)}. Exact input spectrum B=${source.vector.BRIDGE}, S=${source.vector.SHELTER}, G=${source.vector.SURGE}.`
      : `Operating trial with ${row.fixture.part} at housing ${row.fixture.site}, ${row.support} support: input ${row.input.toFixed(6)}, terminal output ${row.output.toFixed(6)}, transmission ${(100 * row.efficiency).toFixed(3)}%. Heat after this recorded trial ${row.heatAfter}.`;
    if (row.text !== text) throw Error('Saved observation text disagrees with its actual values.');
  }
  if (!equal(s.receipts, s.observations.filter(r => r.type === 'trial').map(r => r.key))) throw Error('Operating-trial receipts disagree with the full observation history.');
  if (!Number.isInteger(s.measurementSerial) || s.measurementSerial < s.observations.length || s.measurementSerial > 1000000 || s.measurementSerial > s.revision || typeof s.message !== 'string' || s.message.length > 2000) throw Error('Invalid return-line measurement counters.');
  if (s.observations.length ? !s.observations.some(r => r.id === s.lastMeasurementId) || !Number.isInteger(s.lastMeasurementRevision) || s.lastMeasurementRevision < 1 || s.lastMeasurementRevision > s.revision : s.lastMeasurementId !== null || s.lastMeasurementRevision !== null || s.measurementSerial !== 0) throw Error('Invalid last return-line measurement.');
  const success = s.observations.filter(r => r.type === 'trial' && r.efficiency >= .95);
  if (s.phase === 'diagnosing') {
    if (s.kit !== 1 || s.outcome !== null || s.parked !== null || success.length) throw Error('Uncommissioned line has a forged completion.');
  } else {
    exact(s.outcome, ['flow', 'support', 'heatAtCommission', 'fixture', 'source', 'input', 'output', 'efficiency', 'agreement']);
    const row = s.observations.at(-1), out = s.outcome;
    if (s.kit !== 0 || success.length !== 1 || row !== success[0] || !equal(s.fixture, row.fixture) || !equal(out.fixture, row.fixture) || !equal(out.source, PROFILES.find(p => p.id === row.source)) || out.input !== row.input || out.output !== row.output || out.efficiency !== row.efficiency || out.heatAtCommission !== row.heatAfter || out.support !== row.support || s.settings.source !== row.source || s.settings.support !== row.support || out.flow !== (row.support === 'pawl' ? 'essential_basin_only' : 'full_clinic_return') || out.agreement !== (row.support === 'iona' ? 'return_brace_iona' : null)) throw Error('Saved commission outcome is inconsistent.');
    if (s.parked !== null && (out.support !== 'iona' || !equal(s.parked, { reason: 'hearing_record', from: 'full_clinic_return', to: 'essential_basin_only' }))) throw Error('Invalid scoped brace parking.');
  }
  return s;
}
