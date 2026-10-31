import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { act, request, snapshot, start, toolVector, view } from './web/campaign.js';
import { FIXTURES } from './web/campaign-data.js';
import * as Chambers from './web/campaign-chambers.js';

// Authored CPU fixtures exercise replay plumbing; none are native inference receipts.
const actions = ['BRIDGE', 'SHELTER', 'SURGE'];
const fixture = FIXTURES.find(row => row.signal === 'voice');
const cases = [], observations = [];
const perform = (run, intent) => {
  const next = act(run, intent);
  assert.notEqual(next.state, run, next.message);
  return next.state;
};
const mode = (run, value) => perform(run, { kind: 'toolSource', fixture: fixture.id, mode: value });
const panel = run => view(run).machines.find(row => row.fixture === fixture.id).chamber;
const operation = (run, value) => perform(run, { kind: 'manual', console: fixture.id, operation: value });
const trigger = (run, value) => operation(run, { op: 'trigger', trigger: `chamber_voice_${value}` });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function capture(result = { action: 'BRIDGE', provenance: 'authored' }) {
  const run = start();
  run.mission = 3; run.flags.push('choir_locked'); run.pos = { x: fixture.x, z: fixture.z };
  const pending = request(run, { kind: 'thought', subject: fixture.id, text: 'Authored CPU source replay fixture, not inference.' });
  assert.ok(pending.packet);
  return perform(pending.state, { kind: 'attuned', fixture: fixture.id, ticket: pending.packet.ticket, result });
}
function references(run) {
  for (const action of actions) run = perform(run, { kind: 'referenceTool', fixture: fixture.id, action });
  return run;
}
function solve(run) {
  const layout = Chambers.CATALOG.voice.stages[run.chambers.voice.stage];
  run = perform(run, { kind: 'toolMix', fixture: fixture.id, weights: layout.referenceWeights });
  for (let index = 0; index < 9; index++) run = operation(run, { op: 'set', handle: `chamber_voice_r${index}`, value: String(layout.solution[index]) });
  return run;
}
function secondPhase() { return solve(trigger(solve(references(capture())), 'commit')); }
function test(name, check) { check(); cases.push(name); console.log(`PASS ${name}`); }
const local = (before, after, action, baseline) => ({
  status: 'complete', id: 'CPU_SHAPED_NOT_INFERENCE', model_revision: 'CPU_AUTHORED_REVISION_NOT_INFERENCE', provenance: 'local',
  action, baseline_action: baseline, probabilities_before: before, probabilities_after: after,
  steering: { applied: true, strength: .5, scope: 'focused', delta_l2: 2, changed_elements: 10, edited_tokens: 1 },
});

test('Authored pairs use the exact catalog and explicit unchanged Shelter and Surge controls', () => {
  const run = references(capture());
  assert.equal(run.toolSourceMode, 'after');
  assert.deepEqual(run.spectra.voice.authored_spectrum_before, { BRIDGE: .83, SHELTER: .02, SURGE: .15 });
  for (const action of actions) {
    assert.deepEqual(run.toolBank[action].authored_spectrum_before, Chambers.recoverySpectrumBefore(action));
    const profile = panel(run).profiles.find(row => row.action === action);
    assert.equal(profile.paired, true); assert.equal(profile.steeringApplied, false); assert.equal(profile.comparisonStatus, 'authored_pair');
    if (action !== 'BRIDGE') assert.deepEqual(profile.before, profile.after);
  }
  const bridge = panel(run).profiles[0];
  assert.equal(bridge.before.BRIDGE, .83); assert.equal(bridge.after.BRIDGE, .83);
  assert.equal(actions.reduce((best, action) => bridge.before[action] > bridge.before[best] ? action : best), 'BRIDGE');
  assert.equal(actions.reduce((best, action) => bridge.after[action] > bridge.after[best] ? action : best), 'BRIDGE');
});

test('Fixed phase-two geometry fails at 13% Surge BEFORE and passes at 8.5% AFTER', () => {
  let run = secondPhase();
  const fixed = { orientations: [...run.chambers.voice.orientations], weights: [...run.toolWeights] };
  run = mode(run, 'before');
  const before = panel(run).report;
  assert.equal(panel(run).sourceMode, 'before'); close(before.source.SURGE, .13); assert.equal(before.pass, false);
  const surge = before.sinks.find(row => row.band === 'SURGE');
  assert.equal(surge.max, .12); assert.equal(surge.pass, false);
  const rejected = act(run, { kind: 'manual', console: fixture.id, operation: { op: 'trigger', trigger: 'chamber_voice_commit' } });
  assert.notEqual(rejected.state, run); run = rejected.state; assert.equal(run.chambers.voice.stage, 1);
  const rejectedCue = rejected.cues.find(cue => cue.kind === 'message').text;
  assert.match(rejectedCue, /^BEFORE record rejected — phase unchanged\./);
  assert.match(rejectedCue, /Surge receiver received 13\.0% \(required 0–12%\)/);
  run = mode(run, 'after');
  const after = panel(run).report;
  assert.equal(panel(run).sourceMode, 'after'); close(after.source.SURGE, .085); assert.equal(after.pass, true);
  assert.deepEqual(before.paths, after.paths);
  assert.deepEqual(run.chambers.voice.orientations, fixed.orientations); assert.deepEqual(run.toolWeights, fixed.weights);
  const accepted = act(run, { kind: 'manual', console: fixture.id, operation: { op: 'trigger', trigger: 'chamber_voice_commit' } });
  assert.notEqual(accepted.state, run); run = accepted.state; assert.equal(run.chambers.voice.stage, 2);
  const acceptedCue = accepted.cues.find(cue => cue.kind === 'message').text;
  assert.match(acceptedCue, /^AFTER record accepted — phase advanced\./);
  observations.push({ fixture: 'canonical_voice_phase_1', scope: 'Authored CPU reports after actual source-switch actions at fixed solved geometry', actualReplays: { before, after }, rejectedCue, acceptedCue });
});

test('Side replay and dry probes grant no world resources and change no rotors, captures or allocations', () => {
  let run = secondPhase();
  const fields = ['heat', 'strain', 'scars', 'surgeSeconds', 'health', 'energy', 'flags', 'facts', 'items', 'pos', 'spectra', 'toolBank', 'toolWeights', 'chambers', 'clock', 'mixture'];
  const before = structuredClone(Object.fromEntries(fields.map(key => [key, run[key]])));
  const revision = run.revision;
  run = mode(run, 'before'); assert.equal(run.revision, revision + 1);
  run = trigger(run, 'probe'); run = trigger(run, 'probe'); run = mode(run, 'after');
  assert.deepEqual(Object.fromEntries(fields.map(key => [key, run[key]])), before);
  assert.equal(act(run, { kind: 'toolSource', fixture: fixture.id, mode: 'after' }).state, run);
});

test('Native-shaped differing-winner fixture replays its actual baseline without rekeying the bank', () => {
  const record = local({ BRIDGE: .8, SHELTER: .1, SURGE: .1 }, { BRIDGE: .1, SHELTER: .8, SURGE: .1 }, 'SHELTER', 'BRIDGE');
  let run = capture(record);
  assert.deepEqual(Object.keys(run.toolBank), ['SHELTER']); assert.deepEqual(run.toolWeights, [0, 100, 0]);
  run = mode(run, 'before'); assert.deepEqual(run.toolMixture, record.probabilities_before);
  assert.equal(run.toolBank.BRIDGE, undefined); assert.equal(run.toolBank.SHELTER.action, 'SHELTER');
  const profile = panel(run).profiles[1];
  assert.deepEqual(profile.probabilities, record.probabilities_before); assert.deepEqual(profile.after, record.probabilities_after);
  assert.equal(profile.paired, true); assert.equal(profile.steeringApplied, true); assert.equal(profile.comparisonStatus, 'measured_pair');
  assert.deepEqual(view(run).finale.sources[0].vector, record.probabilities_after);
  assert.deepEqual(run.spectra.voice.probabilities_after, record.probabilities_after);
  assert.deepEqual(toolVector(record, 'before'), record.probabilities_before);
  assert.throws(() => toolVector(record, 'invalid'));
  observations.push({ scope: 'Synthetic native-shaped CPU fixture, not genuine inference', record, selected: profile });
});

test('Old v3 saves default only absent mode to AFTER and missing authored baseline stays held fixed', () => {
  const saved = snapshot(references(capture()));
  delete saved.toolSourceMode;
  for (const profile of Object.values(saved.toolBank)) delete profile.authored_spectrum_before;
  let run = start(saved);
  assert.equal(run.restoreWarning, undefined); assert.equal(run.version, 3); assert.equal(run.toolSourceMode, 'after');
  const fixed = { ...run.toolMixture };
  run = mode(run, 'before'); assert.deepEqual(run.toolMixture, fixed);
  for (const profile of panel(run).profiles) {
    assert.equal(profile.paired, false); assert.equal(profile.comparisonStatus, 'legacy_fixed'); assert.deepEqual(profile.before, profile.after);
  }
  const pending = request(run, { kind: 'work_order', subject: fixture.id, text: 'Read the source.' });
  assert.match(pending.packet.scene.facts.find(row => row.id === 'optics_voice_input').text, /legacy held fixed; no before record/);
  const restored = start(snapshot(run)); assert.equal(restored.toolSourceMode, 'before'); assert.deepEqual(restored.toolMixture, fixed);
});

test('Invalid present mode and noncanonical authored baseline fail save validation', () => {
  const valid = snapshot(references(capture()));
  for (const value of [undefined, null, 'BEFORE', '', false, 0]) {
    const saved = structuredClone(valid); saved.toolSourceMode = value;
    assert.match(start(saved).restoreWarning, /source mode/);
  }
  for (const value of [undefined, null, { BRIDGE: .83, SHELTER: .03, SURGE: .14 }, { BRIDGE: .83, SHELTER: .02, SURGE: .15, extra: 0 }]) {
    const saved = structuredClone(valid); saved.toolBank.BRIDGE.authored_spectrum_before = value;
    assert.match(start(saved).restoreWarning, /neural tool/);
  }
  for (const action of actions) {
    const saved = structuredClone(valid);
    saved.toolBank[action].authored_spectrum = Object.fromEntries(actions.map(band => [band, band === action ? 1 : 0]));
    assert.match(start(saved).restoreWarning, /neural tool/, 'A paired canonical baseline cannot authorize a noncanonical after spectrum.');
    delete saved.toolBank[action].authored_spectrum_before;
    assert.equal(start(saved).restoreWarning, undefined, 'An actual unpaired legacy one-hot profile remains compatible.');
  }
});

test('Replay requires captured available apparatus and physical proximity', () => {
  let run = start(); run.mission = 3; run.flags.push('choir_locked'); run.pos = { x: fixture.x, z: fixture.z };
  assert.equal(act(run, { kind: 'toolSource', fixture: fixture.id, mode: 'before' }).state, run);
  run = capture(); run.pos = { x: 0, z: 0 };
  assert.equal(act(run, { kind: 'toolSource', fixture: fixture.id, mode: 'before' }).state, run);
  run.pos = { x: fixture.x, z: fixture.z };
  assert.equal(act(run, { kind: 'toolSource', fixture: fixture.id, mode: 'baseline' }).state, run);
  assert.equal(act(run, { kind: 'toolSource', fixture: 'unknown', mode: 'before' }).state, run);
});

test('Changing source invalidates both rehearsed work and pending native-shaped proposals', () => {
  let run = perform(capture(), { kind: 'authoredPlan', console: fixture.id, operations: [{ op: 'set', handle: 'chamber_voice_r0', value: '2' }] });
  assert.equal(run.preview.chamber.sourceMode, 'after');
  const proposalId = run.preview.id;
  run = mode(run, 'before');
  assert.equal(act(run, { kind: 'confirm', proposalId }).state, run);
  const pending = request(run, { kind: 'work_order', subject: fixture.id, text: 'Turn A1.' });
  run = mode(pending.state, 'after');
  const before = structuredClone(run.chambers);
  const received = act(run, { kind: 'receive', ticket: pending.packet.ticket, result: { status: 'complete', kind: 'work_order', provenance: 'local', ticket: pending.packet.ticket, proposal: { status: 'ready', operations: [{ op: 'set', handle: 'chamber_voice_r0', value: '2' }] } } });
  assert.equal(received.state.pending, null); assert.equal(received.state.preview, null); assert.deepEqual(received.state.chambers, before);
});

test('Observation cards name selected physics, stay bounded and reveal no solution', () => {
  let run = mode(secondPhase(), 'before');
  const pending = request(run, { kind: 'work_order', subject: fixture.id, text: 'Explain this source spectrum.' });
  const cards = pending.packet.scene.facts.filter(row => row.id.startsWith('optics_'));
  assert.equal(cards.length, 5); assert.ok(cards.every(row => row.text.length <= 600));
  assert.match(cards.find(row => row.id.endsWith('_input')).text, /Actual normalized BEFORE source/);
  assert.match(cards.find(row => row.id.endsWith('_trace')).text, /BEFORE safe dry-trace/);
  assert.ok(!/verified route|authored reference weights|orientations|solution/i.test(JSON.stringify(cards)));
  assert.ok(Buffer.byteLength(JSON.stringify(pending.packet)) <= 16384);
  observations.push({ scope: 'Authored CPU bounded source observations', cards });
});

test('Final seal retains selected vectors, source side and native-shaped identity after retuning and overwrite', () => {
  const record = local(Chambers.recoverySpectrumBefore('BRIDGE'), Chambers.recoverySpectrum('BRIDGE'), 'BRIDGE', 'BRIDGE');
  let run = capture(record);
  for (const action of ['SHELTER', 'SURGE']) run = perform(run, { kind: 'referenceTool', fixture: fixture.id, action });
  run = trigger(solve(run), 'commit'); run = trigger(solve(run), 'commit');
  run = mode(solve(run), 'before'); assert.equal(panel(run).report.pass, true);
  const expected = structuredClone(run.toolMixture), revision = run.revision;
  const sealedResult = act(run, { kind: 'manual', console: fixture.id, operation: { op: 'trigger', trigger: 'chamber_voice_commit' } });
  assert.notEqual(sealedResult.state, run); run = sealedResult.state;
  const sealCue = sealedResult.cues.find(cue => cue.kind === 'message').text;
  assert.match(sealCue, /^BEFORE record accepted — chamber sealed\./);
  assert.equal(run.chambers.voice.complete, true);
  const event = structuredClone(run.events.findLast(row => row.type === 'chamber-commit'));
  assert.equal(event.sourceMode, 'before'); assert.equal(event.sourceRevision, revision);
  assert.deepEqual(event.provenance[0].probabilities, record.probabilities_before);
  const sealed = structuredClone(view(run).finale.sources[0]);
  close(sealed.vector.BRIDGE, expected.BRIDGE); close(sealed.vector.SHELTER, expected.SHELTER); close(sealed.vector.SURGE, expected.SURGE);
  assert.equal(sealed.components[0].recordId, record.id); assert.equal(sealed.components[0].modelRevision, record.model_revision);
  assert.equal(sealed.components[0].sourceMode, 'before'); assert.equal(sealed.components[0].sourceRevision, revision);
  assert.deepEqual(sealed.components[0].probabilities, record.probabilities_before);
  run = mode(run, 'after'); run = perform(run, { kind: 'referenceTool', fixture: fixture.id, action: 'BRIDGE' });
  run = perform(run, { kind: 'toolMix', fixture: fixture.id, weights: [0, 0, 100] });
  assert.deepEqual(view(run).finale.sources[0], sealed); assert.deepEqual(panel(run).mixture, run.chambers.voice.committedProfile);
  run = start(snapshot(run)); assert.equal(run.restoreWarning, undefined); assert.deepEqual(view(run).finale.sources[0], sealed);
  assert.deepEqual(run.events.findLast(row => row.type === 'chamber-commit'), event);
  observations.push({ scope: 'Synthetic native-shaped CPU seal, not genuine inference', event, sealed, sealCue });
});

mkdirSync('.test-results', { recursive: true });
const files = ['web/campaign.js', 'web/campaign-chambers.js', 'neural-echo.test.mjs'];
writeFileSync('.test-results/neural-echo.json', JSON.stringify({ pass: true, checked_at_utc: new Date().toISOString(),
  scope: 'Authored CPU state and routing tests plus explicitly synthetic native-shaped records. No inference, browser, UI, player, or activation efficacy claim.',
  cases, observations, source_sha256: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])) }, null, 2) + '\n');
console.log(`${cases.length} neural source replay CPU cases passed.`);
