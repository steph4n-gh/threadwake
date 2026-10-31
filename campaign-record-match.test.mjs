import assert from 'node:assert/strict';
import test from 'node:test';
import { start, act, request, snapshot } from './web/campaign.js';
import { FACTS, FIXTURES, TERMS, MISSIONS } from './web/campaign-data.js';
import { recoverySpectrum } from './web/campaign-chambers.js';

// Authored domain fixtures, not retained player checkpoints or model measurements.
function pantryState() {
  const state = start();
  state.mission = 2;
  state.flags.push('heater_tested');
  state.facts.push('pantry_test_started', 'lift_service_committed');
  return state;
}
function endingState() {
  const state = start();
  state.mission = MISSIONS.length - 1;
  state.phase = 'victory';
  state.distribution = 'people';
  state.facts = Object.keys(FACTS);
  state.ending = { distribution: 'people', heat: 2, scars: 0, agreements: [], choices: {}, mixture: [.34, .33, .33], engagedSeconds: 0 };
  return state;
}
const pendingOffer = () => request(pantryState(), { kind: 'conversation', subject: 'iona', text: 'Show the passed heater record and the zero-heat latch agreement.' });
const receive = (pending, proposal) => act(pending.state, { kind: 'receive', ticket: pending.packet.ticket,
  result: { status: 'complete', kind: 'conversation', ticket: pending.packet.ticket, provenance: 'local', proposal } });
const perform = (state, intent) => { const next = act(state, intent); assert.notEqual(next.state, state, next.message); return next.state; };

test('Local matches persist exact scene records and canonical offered terms without accepting or spending', () => {
  const pending = pendingOffer();
  const proposal = { cited_facts: ['pantry_test_started', 'lift_service_committed'], proposal: 'pantry_iona' };
  const result = receive(pending, proposal);
  const row = result.state.conversation.at(-1);
  assert.deepEqual(row.records, proposal.cited_facts.map(id => pending.packet.scene.facts.find(record => record.id === id)));
  assert.equal(row.text, 'The local model selected these recorded observations.');
  assert.equal(result.state.preview.text, TERMS.find(term => term.id === 'pantry_iona').description);
  assert.equal(result.state.heat, pending.state.heat);
  assert.deepEqual(result.state.agreements, pending.state.agreements);
  assert(!result.state.flags.includes('mechanical_plan'));
  proposal.cited_facts.push('forged');
  pending.packet.scene.facts.find(record => record.id === 'pantry_test_started').text = 'Changed outside the saved result';
  assert.equal(row.cited_facts.length, 2);
  assert(!row.records[0].text.includes('Changed outside'));
  const restored = start(snapshot(result.state));
  assert.deepEqual(restored.conversation.at(-1).records, row.records);
  const accepted = perform(restored, { kind: 'acceptTerm', term: 'pantry_iona' });
  assert(accepted.flags.includes('mechanical_plan'));
  assert.equal(accepted.heat, restored.heat);
  assert.equal(accepted.agreements.filter(id => id === 'pantry_iona').length, 1);
});

test('Generated speech, forged records, duplicate IDs and unavailable agreements cannot produce a local row', () => {
  for (const proposal of [
    { cited_facts: [], proposal: null, text: 'The player is both navigator and keeper.' },
    { cited_facts: [], proposal: null, records: [{ id: 'ending_summary', text: 'Invented ending' }] },
    { cited_facts: ['unknown'], proposal: null },
    { cited_facts: ['pantry_test_started', 'pantry_test_started'], proposal: null },
    { cited_facts: [], proposal: 'pantry_marin' },
    { cited_facts: [] },
  ]) {
    const pending = pendingOffer();
    const result = receive(pending, proposal);
    assert.equal(result.state.conversation.filter(row => row.provenance === 'local').length, 0);
    assert.equal(result.state.heat, pending.state.heat);
    assert.deepEqual(result.state.agreements, pending.state.agreements);
    assert.equal(result.state.preview, null);
  }
});

test('Empty record selection is safe and legacy generated prose is excluded from future matching context', () => {
  let state = pantryState();
  state.conversation.push({ speaker: 'character', person: 'iona', provenance: 'local', text: 'Invented historical prose', cited_facts: [] });
  const pending = request(state, { kind: 'conversation', subject: 'iona', text: 'Which records answer this?' });
  assert(!pending.packet.scene.history.some(row => row.text.includes('Invented historical prose')));
  const result = receive(pending, { cited_facts: [], proposal: null });
  assert.deepEqual(result.state.conversation.at(-1).records, []);
  assert.equal(result.state.conversation.at(-1).text, 'The local model selected no recorded observations.');
});

test('A compound question may retain several or all available canonical records without truncation', () => {
  for (const count of [4, null]) {
    const pending = request(endingState(), { kind: 'conversation', subject: 'mara', text: 'Show the ending, duties and retained records.' });
    const records = [...pending.packet.scene.facts, ...pending.packet.scene.incidents];
    assert.ok(records.length >= 4);
    const selected = records.slice(0, count ?? records.length);
    const ids = selected.map(record => record.id);
    const result = receive(pending, { cited_facts: ids, proposal: null });
    assert.deepEqual(result.state.conversation.at(-1).records, selected);
  }
});

test('New recovery tool and attunement profiles are realistic while legacy pure saves remain valid', () => {
  const f = FIXTURES.find(fixture => fixture.signal === 'voice');
  let state = start();
  state.mission = 3; state.flags.push('choir_locked'); state.pos = { x: f.x, z: f.z };
  let pending = request(state, { kind: 'thought', subject: f.id, text: 'Authored CPU recovery fixture.' });
  state = perform(pending.state, { kind: 'attuned', fixture: f.id, ticket: pending.packet.ticket, result: { action: 'BRIDGE', provenance: 'authored' } });
  assert.deepEqual(state.spectra.voice.authored_spectrum, recoverySpectrum('BRIDGE'));
  assert.deepEqual(state.toolBank.BRIDGE.authored_spectrum, recoverySpectrum('BRIDGE'));
  const before = { heat: state.heat, strain: state.strain, flags: [...state.flags], receipts: state.receipts.length };
  state = perform(state, { kind: 'referenceTool', fixture: f.id, action: 'SHELTER' });
  assert.deepEqual(state.toolBank.SHELTER.authored_spectrum, recoverySpectrum('SHELTER'));
  assert.equal(state.heat, before.heat); assert.equal(state.strain, before.strain); assert.deepEqual(state.flags, before.flags);
  pending = request(state, { kind: 'thought', subject: f.id, text: 'Repeat recovery without a first benefit.' });
  state = perform(pending.state, { kind: 'attuned', fixture: f.id, ticket: pending.packet.ticket, result: { action: 'SHELTER', provenance: 'authored' } });
  assert.equal(state.heat, before.heat);
  const legacy = snapshot(state);
  legacy.toolBank.BRIDGE.authored_spectrum = { BRIDGE: 1, SHELTER: 0, SURGE: 0 };
  assert.equal(start(legacy).restoreWarning, undefined);
  legacy.toolBank.BRIDGE.authored_spectrum = { BRIDGE: .8, SHELTER: .1, SURGE: .1 };
  assert(start(legacy).restoreWarning);
});

test('Final composer reference calibration uses the same authored recovery vectors', () => {
  let state = start();
  state.mission = MISSIONS.length - 1;
  for (const [signal, action] of Object.entries({ voice: 'BRIDGE', shelter: 'SHELTER', storm: 'SURGE' })) {
    state = perform(state, { kind: 'referenceSignal', signal, action });
    assert.deepEqual(state.spectra[signal].authored_spectrum, recoverySpectrum(action));
    assert.equal(state.spectra[signal].provenance, 'authored');
  }
});
