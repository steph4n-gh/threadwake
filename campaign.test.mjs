import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { start, act, request, view, snapshot } from './web/campaign.js';
import { ZONES, PEOPLE, FACTS, FIXTURES, MISSIONS, TERMS } from './web/campaign-data.js';
import { heightAt, ROUTES } from './web/campaign-ground.js';

import * as Chambers from './web/campaign-chambers.js';
const cases = [];
let walkthroughCount = 0;
const test = (name, fn) => { fn(); cases.push(name); };
const fixture = id => FIXTURES.find(f => f.id === id);
function perform(run, intent, required = true) {
  const result = act(run, intent);
  if (required) assert.ok(result.state !== run, `${intent.kind}: ${result.message}`);
  return result.state;
}
function interact(run, id) {
  const f = fixture(id);
  const at = f.kind === 'item' && run.items[f.item]?.kind === 'world' ? run.items[f.item] : f;
  run.pos = { x: at.x, z: at.z };
  return perform(run, { kind: 'interact', id });
}
function settle(run, seconds = 10) {
  for (let i = 0; i < seconds * 10 && (run.motions.length || run.program); i++) run = perform(run, { kind: 'tick', seconds: .1 });
  assert.equal(run.program, null, 'Program must reach a bounded physical condition.');
  assert.equal(run.motions.length, 0);
  return run;
}
function operate(run, id, op) {
  const f = fixture(id); run.pos = { x: f.x, z: f.z };
  return perform(run, { kind: 'manual', console: id, operation: op });
}
function readyStart() {
  let r = start();
  r = interact(r, 'wake_lamp'); r = interact(r, 'wake_lamp_socket'); r = interact(r, 'wake_bearing');
  r.pos = { x: fixture('wake_console').x, z: fixture('wake_console').z };
  return r;
}
function localPlan(run, console, operations) {
  const pending = request(run, { kind: 'work_order', subject: console, text: 'Authored contract fixture request.' });
  assert.ok(pending.packet);
  const result = { status: 'complete', kind: 'work_order', ticket: pending.packet.ticket, provenance: 'local', proposal: { status: 'ready', operations } };
  return { run: pending.state, ticket: pending.packet.ticket, result };
}
const wakeOrder = [{ op: 'route', handle: 'wake_bus', value: 'lamp' }, { op: 'trigger', trigger: 'ignite_refuge' }, { op: 'after', condition: 'refuge_ready' }];

function condition(run, c) {
  if (c.flag) return run.flags.includes(c.flag);
  if (c.notFlag) return !run.flags.includes(c.notFlag);
  if (c.fact) return run.facts.includes(c.fact);
  if (c.itemInstalled) return run.items[c.itemInstalled]?.kind === 'installed';
  if (c.agreement) return run.agreements.includes(c.agreement);
  if (c.resource) return (c.min === undefined || run[c.resource] >= c.min) && (c.max === undefined || run[c.resource] <= c.max);
  return true;
}

function walkthrough(options = {}) {
  walkthroughCount++;
  let run = start(); if (options.zeroStart) run.heat=0;
  const trace = [], triggerEffects = [];
  for (let chapter = 0; chapter < MISSIONS.length; chapter++) {
    assert.equal(run.mission, chapter);
    const mission = MISSIONS[chapter];
    for (let pass = 0; pass < 12 && !view(run).mission.ready; pass++) {
      const before = run.revision;
      const fs = FIXTURES.filter(f => f.missions?.includes(mission.id));
      for (const f of fs.filter(f => f.kind === 'evidence')) if (!run.facts.includes(f.fact) && (f.requires || []).every(c => condition(run, c))) run = interact(run, f.id);
      for (const f of fs.filter(f => f.kind === 'item')) {
        if (run.items[f.item]?.kind !== 'world') continue;
        const socket = fs.find(s => s.kind === 'socket' && s.item === f.item);
        if (!socket || !(socket.requires || []).every(c => condition(run, c))) continue;
        run = interact(run, f.id); run = interact(run, socket.id);
      }
      // Authored CPU route helper: knows the constructed hidden fault, as optical helpers know their catalog solution. Not player deduction or browser proof.
      if (mission.id === 'windgallery' && run.returnLine && run.facts.includes('return_line_service') && run.flags.includes('baffles_aligned') && run.flags.includes('sail_installed') && run.returnLine.phase !== 'complete') {
        const fault = run.returnLine.secret;
        const order = [['source','record_2'],['repair_site',String(fault.site)],['part',fault.kind === 'binding' ? 'bushing' : 'clutch_sleeve'],['support','pawl']].map(([handle,value])=>({op:'set',handle:'return_line_'+handle,value}));
        order.push({op:'trigger',trigger:'return_line_fit'},{op:'trigger',trigger:'return_line_commission'});
        const console = fixture('gallery_return_console'); run.pos={x:console.x,z:console.z};
        run=perform(run,{kind:'authoredPlan',console:console.id,operations:order});run=perform(run,{kind:'confirm',proposalId:run.preview.id});run=settle(run);
      }
      for (const f of fs.filter(f => f.kind === 'console' && !f.returnLine)) {
        const skip = new Set(options.archive ? ['allocate_light_load', 'seal_people_manifest'] : []);
        if (options.keepDockFreight) { skip.add('release_freight'); skip.add('lift_people'); }
        if (options.digest) skip.add('copy_original_index');
        if (options.guarded) skip.add('publish_testimony');
        if (options.allFreight) { skip.add('release_freight'); skip.add('lift_people'); skip.add('allocate_light_load'); skip.add('allocate_archive_load'); skip.add('seal_people_manifest'); skip.add('seal_archive_manifest'); }
        if (options.witnessScout) { skip.add('retain_independent_witness'); skip.add('rescue_with_latch'); skip.add(options.pantryScout ? 'rescue_with_cleared_witness' : 'rescue_with_scout'); }
        else skip.add('release_witness_to_watch');
        for (const t of f.machine.triggers) {
          if (skip.has(t.id) || run.receipts.includes('trigger:' + t.id) || !t.requires.every(c => condition(run, c))) continue;
          if (!t.requires.filter(c => c.setting).every(c => f.machine.handles.some(h => h.id === c.setting && (h.requires || []).every(id => run.facts.includes(id))))) continue;
          for (const c of t.requires.filter(c => c.setting)) {
            const h = f.machine.handles.find(h => h.id === c.setting);
            run = operate(run, f.id, { op: h.op, handle: h.id, value: c.value });
          }
          const heatBefore = run.heat; run = operate(run, f.id, { op: 'trigger', trigger: t.id }); triggerEffects.push({ mission: mission.id, trigger: t.id, heatDelta: run.heat - heatBefore }); run = settle(run);
        }
      }
      for (let agreement = 0; agreement < 3; agreement++) { const t = view(run).terms.find(t => t.eligible && (run.mission !== 2 || !options.pantry || t.id === options.pantry) && (!options.witnessScout || options.pantryScout || t.id !== 'pantry_marin')); if (!t) break; run = perform(run, { kind: 'acceptTerm', term: t.id }); }
      for (const f of fs.filter(f => f.kind === 'attune')) {
        if (run.flags.includes(f.flag) || !(f.requires || []).every(c => condition(run, c))) continue;
        run.pos = { x: f.x, z: f.z };
        const pending = request(run, { kind: 'thought', subject: f.id, text: 'Authored unit-spectrum fixture.' });
        assert.ok(pending.packet, pending.message);
        const action = options.signalActions?.[f.signal] || (options.allFreight ? 'BRIDGE' : { voice: 'BRIDGE', shelter: 'SHELTER', storm: 'SURGE' }[f.signal]);
        run = perform(pending.state, { kind: 'attuned', fixture: f.id, ticket: pending.packet.ticket, result: { id: 'authored-' + f.id, action, provenance: 'authored' } });
      }
      for (const f of fs.filter(f => f.chamber && run.flags.includes(f.flag))) {
        run.pos = { x: f.x, z: f.z };
        for (const action of ['BRIDGE', 'SHELTER', 'SURGE']) if (!run.toolBank[action]) run = perform(run, { kind: 'referenceTool', fixture: f.id, action });
        while (!run.chambers[f.signal].complete) {
          const stage = Chambers.CATALOG[f.signal].stages[run.chambers[f.signal].stage];
          run = perform(run, { kind: 'toolMix', fixture: f.id, weights: stage.referenceWeights });
          for (let index = 0; index < 9; index++) run = operate(run, f.id, { op: 'set', handle: `chamber_${f.signal}_r${index}`, value: String(stage.solution[index]) });
          run = operate(run, f.id, { op: 'trigger', trigger: `chamber_${f.signal}_probe` });
          run = operate(run, f.id, { op: 'trigger', trigger: `chamber_${f.signal}_commit` });
        }
      }
      if (run.revision === before) break;
    }
    assert.ok(view(run).mission.ready, mission.id + ' missing ' + view(run).objectives.filter(g => !g.complete).map(g => g.flag).join(','));
    trace.push({ mission: mission.id, goals: mission.goals.length, heat: run.heat, flags: run.flags.length, agreements: [...run.agreements] });
    if (chapter < MISSIONS.length - 1) run = interact(run, mission.report);
    if (options.stopAfterIndex && chapter === 5) return { run, trace, triggerEffects };
    if (options.stopBeforeSpan && chapter === 6) return { run, trace, triggerEffects };
  }
  // Final composition uses the earned station outputs; no capture replacement is needed.
  run = perform(run, { kind: 'mix', weights: [34, 33, 33] });
  const final = view(run).finale;
  assert.ok(final.canFinish, final.reasons.join(' '));
  run = perform(run, { kind: 'finish', distribution: options.archive || options.allFreight ? 'archive' : 'people' });
  return { run, trace, triggerEffects };
}

test('Catalog has twelve distinct situations, at least thirty goals and unambiguous controls', () => {
  assert.equal(MISSIONS.length, 12); assert.ok(MISSIONS.reduce((n, m) => n + m.goals.length, 0) >= 30);
  assert.equal(new Set(FIXTURES.map(f => f.id)).size, FIXTURES.length);
  const handles = FIXTURES.flatMap(f => f.machine?.handles || []);
  assert.equal(new Set(handles.map(h => h.id)).size, handles.length);
  for (const f of FIXTURES) { assert.ok(ZONES.some(z => z.id === f.zone)); for (const id of f.missions || []) assert.ok(MISSIONS.some(m => m.id === id)); }
});

test('Physical interaction requires proximity and parts have one exact location', () => {
  let r = start();
  assert.equal(act(r, { kind: 'interact', id: 'wake_lamp' }).state, r);
  r = interact(r, 'wake_lamp'); assert.equal(r.items.wake_lamp.kind, 'carried');
  r.pos = { x: 9, z: -3 }; r = perform(r, { kind: 'drop' });
  const at = { ...r.items.wake_lamp }; assert.equal(at.kind, 'world');
  r = interact(r, 'wake_lamp'); assert.equal(r.items.wake_lamp.kind, 'carried');
  r = interact(r, 'wake_lamp_socket'); assert.deepEqual(r.items.wake_lamp, { kind: 'installed', socket: 'wake_lamp_socket' });
  assert.equal(act(r, { kind: 'interact', id: 'wake_lamp_socket' }).state, r);
});

test('A work-order preview changes no world and valid confirmation waits on physical motion', () => {
  let r = readyStart(); const before = snapshot(r);
  const fixtureReply = localPlan(r, 'wake_console', wakeOrder); r = perform(fixtureReply.run, { kind: 'receive', ticket: fixtureReply.ticket, result: fixtureReply.result });
  assert.equal(r.settings.wake_bus, before.settings.wake_bus); assert.ok(r.preview); assert.ok(!r.flags.includes('refuge_lit'));
  r = perform(r, { kind: 'confirm', proposalId: r.preview.id });
  assert.equal(r.program.cursor, 2); assert.equal(r.program.waiting, 'refuge_ready'); assert.ok(!r.flags.includes('refuge_lit'));
  assert.ok(!r.facts.includes('refuge_powered'), 'Completed-state facts wait for real motion.');
  r = settle(r); assert.ok(r.flags.includes('refuge_lit')); assert.ok(r.facts.includes('refuge_powered'));
});

test('Unsafe ordering, undiscovered controls and invented operations are rejected without partial effects', () => {
  let r = readyStart();
  const bad = act(r, { kind: 'authoredPlan', console: 'wake_console', operations: [{ op: 'trigger', trigger: 'ignite_refuge' }] });
  assert.equal(bad.state, r); assert.equal(r.settings.wake_bus, 'off');
  assert.equal(act(r, { kind: 'authoredPlan', console: 'wake_console', operations: [{ op: 'exec', command: 'grant inventory' }] }).state, r);
  const fresh = start(); fresh.pos = { x: fixture('wake_console').x, z: fixture('wake_console').z };
  assert.equal(act(fresh, { kind: 'manual', console: 'wake_console', operation: { op: 'route', handle: 'wake_bus', value: 'lamp' } }).state, fresh);
});

test('Run, nonce and revision freshness reject old model replies without spending', () => {
  let r = readyStart(); const p = localPlan(r, 'wake_console', wakeOrder);
  const wrong = { ...p.ticket, epoch: 'another-run' };
  assert.equal(act(p.run, { kind: 'receive', ticket: wrong, result: { ...p.result, ticket: wrong } }).state, p.run);
  r = operate(p.run, 'wake_console', { op: 'route', handle: 'wake_bus', value: 'lamp' });
  const rejected = act(r, { kind: 'receive', ticket: p.ticket, result: p.result });
  assert.equal(rejected.state.pending, null); assert.equal(rejected.state.preview, null); assert.equal(rejected.state.heat, r.heat);
});

test('Save and restore preserve physical program cursor and never replay trigger effects', () => {
  let r = readyStart(); r = perform(r, { kind: 'authoredPlan', console: 'wake_console', operations: wakeOrder });
  const id = r.preview.id; r = perform(r, { kind: 'confirm', proposalId: id });
  r = perform(r, { kind: 'tick', seconds: .7 }); const elapsed = r.motions[0].elapsed;
  const restored = start(snapshot(r)); assert.notEqual(restored.epoch, r.epoch); assert.equal(restored.pending, null); assert.equal(restored.preview, null); assert.equal(restored.motions[0].elapsed, elapsed);
  const done = settle(restored); assert.equal(done.events.filter(e => e.type === 'program-operation' && e.operation.op === 'trigger').length, 1);
  assert.equal(act(done, { kind: 'confirm', proposalId: id }).state, done);
});

test('Grounding and recovery preserve discoveries, choices and historical state', () => {
  let r = readyStart(); r.strain = 90; r.scars = 2; r = perform(r, { kind: 'ground' });
  assert.equal(r.strain, 78); assert.equal(r.scars, 2);
  const flags = [...r.flags], facts = [...r.facts]; r.pos = { x: 200, z: 200 }; r = perform(r, { kind: 'recover' });
  assert.deepEqual(r.pos, r.checkpoint); assert.deepEqual(r.flags, flags); assert.deepEqual(r.facts, facts); assert.equal(r.strain, 78);
});

test('Engaged event timestamps exclude inference, pause and idle counters', () => {
  let r = start(); r.clock = { exploration: 2, deliberation: 3, inference: 100, pause: 200, idle: 300 };
  r = interact(r, 'wake_bearing'); assert.equal(r.events.at(-1).elapsed, 5); assert.equal(r.events.at(-1).wallElapsed, 605);
});

test('Malformed saves restore a safe new campaign without adopting transient authority', () => {
  const r = readyStart(), s = snapshot(r); s.items.wake_lamp = { kind: 'installed', socket: 'made_up' };
  const repaired = start(s); assert.equal(repaired.mission, 0); assert.ok(repaired.restoreWarning); assert.equal(repaired.items.wake_lamp.kind, 'world');
});

let people, archive, emptyReserve, witnessWatch, contractedWatch;
test('All twelve missions complete using legal physical/manual transitions and explicit authored spectra', () => {
  people = walkthrough(); assert.equal(people.run.phase, 'victory'); assert.equal(people.trace.length, 12); assert.equal(people.run.distribution, 'people');
});
test('Archive preservation follows actual load and manifest commitments', () => {
  archive = walkthrough({ archive: true }); assert.equal(archive.run.phase, 'victory'); assert.ok(archive.run.flags.includes('archive_loaded')); assert.ok(archive.run.flags.includes('manifest_archive'));
  const invalid = cloneForPlay(people.run); assert.equal(act(invalid, { kind: 'finish', distribution: 'archive' }).state, invalid);
});
function cloneForPlay(r) { const value = structuredClone(r); value.phase = 'playing'; value.ending = null; return value; }
test('A route can spend all heat and complete by composing its earned station outputs', () => {
  emptyReserve = walkthrough({ allFreight: true }); assert.equal(emptyReserve.run.heat, 0); assert.equal(emptyReserve.run.phase, 'victory'); assert.ok(emptyReserve.run.flags.includes('all_freight_loaded'));
});
test('Ending invalidates pending work, rejects mechanical mutation and permits a fresh read-only epilogue conversation', () => {
  let r = people.run; assert.equal(r.pending, null); const heat = r.heat;
  assert.equal(act(r, { kind: 'acceptTerm', term: 'pantry_vale' }).state, r);
  const pending = request(r, { kind: 'conversation', subject: 'mara', text: 'What will you remember?' }); assert.ok(pending.packet); assert.equal(pending.packet.scene.terms.length, 0);
  const result = { status: 'complete', kind: 'conversation', ticket: pending.packet.ticket, provenance: 'local', proposal: { cited_facts: [], proposal: null } };
  r = perform(pending.state, { kind: 'receive', ticket: pending.packet.ticket, result }); assert.equal(r.phase, 'victory'); assert.equal(r.heat, heat);
});


test('A late reply cannot mutate a newly sealed ending', () => {
  let r = cloneForPlay(people.run);
  const p = request(r, { kind: 'conversation', subject: 'mara', text: 'What remains of the freight?' });
  assert.ok(p.packet); r = perform(p.state, { kind: 'finish', distribution: 'people' });
  const reply = { status: 'complete', kind: 'conversation', ticket: p.packet.ticket, provenance: 'local', proposal: { cited_facts: [], proposal: null } };
  assert.equal(act(r, { kind: 'receive', ticket: p.packet.ticket, result: reply }).state, r);
});

test('Durable costly history remains available after transient event and dialogue retention is cleared', () => {
  let r = cloneForPlay(people.run); r.events = []; r.conversation = [];
  const p = request(r, { kind: 'conversation', subject: 'mara', text: 'Why did I release the freight at the dock?' });
  assert.ok(p.packet.scene.incidents.some(i => i.id === 'freight_released_event'));
  assert.ok(p.packet.scene.incidents.find(i => i.id === 'freight_released_event').text.includes('released'));
  assert.equal(p.packet.scene.facts.some(f => typeof f.text !== 'string'), false);
});

test('Conversation cannot cite undiscovered facts or propose an ineligible agreement', () => {
  let r = readyStart(); let p = request(r, { kind: 'conversation', subject: 'marin', text: 'Invent a new memory.' });
  const reply = { status: 'complete', kind: 'conversation', ticket: p.packet.ticket, provenance: 'local', proposal: { cited_facts: ['unknown'], proposal: null } };
  let rejected = act(p.state, { kind: 'receive', ticket: p.packet.ticket, result: reply });
  assert.equal(rejected.state.pending, null); assert.deepEqual(rejected.state.flags, r.flags); assert.equal(rejected.state.conversation.filter(l => l.speaker === 'character').length, 0);
  p = request(r, { kind: 'conversation', subject: 'marin', text: 'Promise an unavailable service.' });
  const offer = { ...reply, ticket: p.packet.ticket, proposal: { cited_facts: [], proposal: 'pantry_marin' } };
  rejected = act(p.state, { kind: 'receive', ticket: p.packet.ticket, result: offer });
  assert.equal(rejected.state.agreements.length, 0); assert.equal(rejected.state.heat, r.heat);
});

test('An attunement starts only after its physical source is recovered', () => {
  const r = start(); r.mission = 3; const f = fixture('choir_voice_signal'); r.pos = { x: f.x, z: f.z };
  assert.equal(request(r, { kind: 'thought', subject: f.id, text: 'Capture this voice.' }).packet, null);
});

test('A new measured retuning charges once but cannot farm the initial reserve benefit', () => {
  let r = cloneForPlay(people.run); r.mission = 3; const f = fixture('choir_voice_signal'); r.pos = { x: f.x, z: f.z };
  const p = request(r, { kind: 'thought', subject: f.id, text: 'Authored CPU retuning fixture.', strength: .5, bias: 'SHELTER' });
  const thought = { id: 'fixture-thought', status: 'complete', provenance: 'local', model_revision: 'AUTHORED_CPU_FIXTURE_NOT_INFERENCE', action: 'SHELTER', baseline_action: 'BRIDGE', probabilities_before: { BRIDGE: .8, SHELTER: .1, SURGE: .1 }, probabilities_after: { BRIDGE: .1, SHELTER: .8, SURGE: .1 }, steering: { applied: true, strength: .5, scope: 'focused', delta_l2: 2, changed_elements: 10, edited_tokens: 1 } };
  const heat = r.heat, strain = r.strain;
  r = perform(p.state, { kind: 'attuned', fixture: f.id, ticket: p.packet.ticket, result: thought });
  assert.equal(r.heat, heat); assert.equal(r.strain, strain + 3);
  assert.equal(act(r, { kind: 'attuned', fixture: f.id, ticket: p.packet.ticket, result: thought }).state, r);
  const q = request(r, { kind: 'thought', subject: f.id, text: 'Reject impossible measurement.' });
  const invalid = { ...thought, id: 'zero-measurement', steering: { ...thought.steering, delta_l2: 0 } };
  const invalidReply = act(q.state, { kind: 'attuned', fixture: f.id, ticket: q.packet.ticket, result: invalid });
  assert.equal(invalidReply.state.pending, null); assert.deepEqual(invalidReply.state.spectra, q.state.spectra); assert.equal(invalidReply.state.strain, q.state.strain);
});

test('Trigger effects are idempotent across manual and saved-program paths', () => {
  let r = cloneForPlay(emptyReserve.run); r.mission = 8; const f = fixture('governor_console'); r.pos = { x: f.x, z: f.z };
  const heat = r.heat, flags = [...r.flags];
  r = operate(r, f.id, { op: 'trigger', trigger: 'allocate_full_load' });
  assert.equal(r.heat, heat); assert.deepEqual(r.flags, flags);
});

test('NPC agreements produce an authored physical station assignment', () => {
  assert.equal(people.run.agreements.includes('pantry_marin'), true);
  assert.equal(people.run.people.marin.duty, 'navigator');
  const home = PEOPLE.find(p => p.id === 'marin');
  assert.equal(people.run.people.marin.x, home.dutyPositions.navigator.x);
  assert.equal(people.run.people.marin.z, home.dutyPositions.navigator.z);
});

test('Inference, idle and paused time cannot complete any story objective', () => {
  const r = start(); r.clock.inference = 3600; r.clock.idle = 3600; r.clock.pause = 3600;
  const advanced = act(r, { kind: 'tick', seconds: 1 });
  assert.equal(advanced.state, r); assert.equal(r.mission, 0); assert.equal(r.flags.length, 0);
});

test('A carried essential part cannot be dropped into the void', () => {
  let r = interact(start(), 'wake_lamp');
  r.pos = { x: 25, z: 25 }; assert.equal(heightAt(r.pos.x, r.pos.z, r.flags), null);
  const rejected = act(r, { kind: 'drop' });
  assert.equal(rejected.state, r); assert.equal(r.items.wake_lamp.kind, 'carried');
  assert.match(rejected.message, /stable ground/);
  r = perform(r, { kind: 'recover' }); assert.equal(r.items.wake_lamp.kind, 'carried');
  r = perform(r, { kind: 'drop' }); assert.equal(heightAt(r.items.wake_lamp.x, r.items.wake_lamp.z, r.flags), 0);
});

test('Recovery and restore repair legacy stranded parts without resetting story progress', () => {
  let r = readyStart();
  r.items.wake_lamp = { kind: 'world', fixture: 'wake_lamp', x: 25, z: 25 };
  const flags = [...r.flags], facts = [...r.facts]; r.pos = { x: 25, z: 25 };
  const saved = snapshot(r), restored = start(saved);
  assert.deepEqual(restored.flags, flags); assert.deepEqual(restored.facts, facts);
  assert.equal(heightAt(restored.pos.x, restored.pos.z, restored.flags), 0);
  assert.equal(heightAt(restored.items.wake_lamp.x, restored.items.wake_lamp.z, restored.flags), 0);
  assert.deepEqual(restored.items.wake_lamp, { kind: 'world', fixture: 'wake_lamp', x: fixture('wake_lamp').x, z: fixture('wake_lamp').z });
  r = perform(r, { kind: 'recover' }); assert.deepEqual(r.flags, flags); assert.equal(heightAt(r.items.wake_lamp.x, r.items.wake_lamp.z, r.flags), 0);
});

test('Stale and malformed attunements clear only their matching pending request', () => {
  let r = cloneForPlay(people.run); r.mission = 3;
  const f = fixture('choir_voice_signal'); r.pos = { x: f.x, z: f.z };
  const p = request(r, { kind: 'thought', subject: f.id, text: 'Authored stale-attunement fixture.' }); assert.ok(p.packet);
  r = operate(p.state, 'choir_console', { op: 'set', handle: 'choir_left', value: 'high' });
  const before = snapshot(r), result = { id: 'stale-fixture', action: 'SURGE', provenance: 'authored' };
  const rejected = act(r, { kind: 'attuned', fixture: f.id, ticket: p.packet.ticket, result });
  assert.equal(rejected.state.pending, null); assert.deepEqual(rejected.state.spectra, before.spectra);
  assert.equal(rejected.state.heat, before.heat); assert.equal(rejected.state.strain, before.strain);
  r = rejected.state; r.pos = { x: f.x, z: f.z };
  const a = request(r, { kind: 'thought', subject: f.id, text: 'First fixture request.' });
  const b = request(a.state, { kind: 'thought', subject: f.id, text: 'Second fixture request.' });
  const old = act(b.state, { kind: 'attuned', fixture: f.id, ticket: a.packet.ticket, result });
  assert.equal(old.state, b.state); assert.equal(old.state.pending.nonce, b.packet.ticket.nonce);
});

test('Bridge opens actual shared shortcut floor while unrelated locked routes remain void', () => {
  let r = cloneForPlay(people.run); r.mission = 3;
  const f = fixture('choir_voice_signal'); r.flags = r.flags.filter(id => id !== f.flag && id !== 'shortcut_choir');
  const shortcut = ROUTES.find(route => route.flag === 'shortcut_choir');
  const midpoint = { x: (shortcut.a.x + shortcut.b.x) / 2, z: (shortcut.a.z + shortcut.b.z) / 2 };
  assert.equal(heightAt(midpoint.x, midpoint.z, r.flags), null);
  r.pos = { x: f.x, z: f.z }; const p = request(r, { kind: 'thought', subject: f.id, text: 'Authored bridge fixture.' });
  r = perform(p.state, { kind: 'attuned', fixture: f.id, ticket: p.packet.ticket, result: { id: 'bridge-floor', action: 'BRIDGE', provenance: 'authored' } });
  assert.equal(heightAt(midpoint.x, midpoint.z, r.flags), 0);
  const restored = start(snapshot(r)); assert.equal(heightAt(midpoint.x, midpoint.z, restored.flags), 0);
});

test('Initial Surge stores a bounded physical overdrive and retuning cannot farm it', () => {
  let r = cloneForPlay(people.run); r.mission = 3;
  const f = fixture('choir_voice_signal'); r.flags = r.flags.filter(id => id !== f.flag); r.surgeSeconds = 0; r.pos = { x: f.x, z: f.z };
  let p = request(r, { kind: 'thought', subject: f.id, text: 'Authored overdrive fixture.' });
  r = perform(p.state, { kind: 'attuned', fixture: f.id, ticket: p.packet.ticket, result: { id: 'initial-surge', action: 'SURGE', provenance: 'authored' } });
  assert.equal(r.surgeSeconds, 75); const strain = r.strain;
  p = request(r, { kind: 'thought', subject: f.id, text: 'Authored retune fixture.' });
  r = perform(p.state, { kind: 'attuned', fixture: f.id, ticket: p.packet.ticket, result: { id: 'second-surge', action: 'SURGE', provenance: 'authored' } });
  assert.equal(r.surgeSeconds, 75); assert.equal(r.strain, strain);
  assert.equal(start(snapshot(r)).surgeSeconds, 75);
  r.flags = r.flags.filter(id => id !== f.flag); r.surgeSeconds = 140;
  p = request(r, { kind: 'thought', subject: f.id, text: 'Authored saturation fixture.' });
  r = perform(p.state, { kind: 'attuned', fixture: f.id, ticket: p.packet.ticket, result: { id: 'saturated-surge', action: 'SURGE', provenance: 'authored' } });
  assert.equal(r.surgeSeconds, 150);
});

test('Explicit afterglow brings people home while preserving the sealed ending and exact reload position', () => {
  const ending = structuredClone(people.run.ending);
  const pending = request(people.run, { kind: 'conversation', subject: 'mara', text: 'Authored pre-afterglow fixture.' });
  let r = perform(pending.state, { kind: 'epilogue' });
  assert.equal(r.phase, 'victory'); assert.equal(r.epilogue, true); assert.equal(r.pending, null);
  assert.deepEqual(r.ending, ending); assert.equal(heightAt(r.pos.x, r.pos.z, r.flags), 0);
  for (const person of PEOPLE) { const pose = person.dutyPositions.epilogue; assert.equal(r.people[person.id].x, pose.x); assert.equal(r.people[person.id].z, pose.z); assert.equal(r.people[person.id].zone, 'refuge'); }
  assert.equal(act(r, { kind: 'epilogue' }).state, r);
  assert.equal(act(r, { kind: 'acceptTerm', term: 'pantry_vale' }).state, r);
  const q = request(r, { kind: 'conversation', subject: 'mara', text: 'What do you remember now?' });
  assert.match(q.packet.scene.place, /Refuge/); assert.match(q.packet.scene.objective, /complete/); assert.deepEqual(q.packet.scene.terms, []);
  const old = { status: 'complete', kind: 'conversation', ticket: pending.packet.ticket, provenance: 'local', proposal: { cited_facts: [], proposal: null } };
  assert.equal(act(q.state, { kind: 'receive', ticket: pending.packet.ticket, result: old }).state, q.state);
  r.pos = { x: 7, z: 4 }; const restored = start(snapshot(r)); assert.deepEqual(restored.pos, r.pos); assert.deepEqual(restored.ending, ending);
});

test('Investigation rejects unsupported cause, sequence and attribution without changing world state', () => {
  let r = start(); r.mission = 6;
  for (const id of ['testimony_dock_tally', 'testimony_archive_margin', 'testimony_relay_trace', 'testimony_maintenance']) r = interact(r, id);
  const id = 'testimony_console';
  const failure = (trigger, pattern) => {
    const before = snapshot(r), rejected = act(r, { kind: 'manual', console: id, operation: { op: 'trigger', trigger } });
    assert.equal(rejected.state, r); assert.deepEqual(snapshot(r), before); assert.match(rejected.message, pattern);
    assert.ok(!rejected.message.includes('testimony_'), 'Feedback gives an evidential reason, not internal settings.');
  };
  r.pos = { x: fixture(id).x, z: fixture(id).z };
  failure('compare_testimony', /cause.*not supported/);
  for (const [handle, value] of [['testimony_claim', 'denial'], ['testimony_record', 'tally'], ['testimony_witness', 'marin']]) r = operate(r, id, { op: 'set', handle, value });
  r = operate(r, id, { op: 'trigger', trigger: 'compare_testimony' }); assert.ok(r.flags.includes('contradiction_proven'));
  failure('establish_sequence', /ordering.*not supported/);
  r = operate(r, id, { op: 'set', handle: 'testimony_record', value: 'trace' });
  r = operate(r, id, { op: 'set', handle: 'testimony_sequence', value: 'hold_request_warning' });
  r = operate(r, id, { op: 'trigger', trigger: 'establish_sequence' }); assert.ok(r.flags.includes('sequence_proven'));
  failure('establish_responsibility', /attribution.*not supported/);
  r = operate(r, id, { op: 'set', handle: 'testimony_record', value: 'maintenance' });
  r = operate(r, id, { op: 'set', handle: 'testimony_responsibility', value: 'central' });
  r = operate(r, id, { op: 'trigger', trigger: 'establish_responsibility' }); assert.ok(r.flags.includes('responsibility_proven'));
  r = operate(r, id, { op: 'set', handle: 'testimony_duty', value: 'lookout' });
  r = operate(r, id, { op: 'trigger', trigger: 'release_witness_to_watch' });
  assert.equal(r.people.marin.duty, 'scout'); assert.equal(r.people.marin.zone, 'gallery'); assert.ok(r.flags.includes('witness_support_ready'));
  const restored = start(snapshot(r)); assert.equal(restored.people.marin.duty, 'scout'); assert.ok(restored.flags.includes('witness_support_ready'));
  r = operate(r, id, { op: 'set', handle: 'testimony_duty', value: 'witness' });
  assert.equal(act(r, { kind: 'manual', console: id, operation: { op: 'trigger', trigger: 'retain_independent_witness' } }).state, r);
});

test('A cleared witness supplies a distinct physical span route without a pantry agreement', () => {
  const watched = walkthrough({ witnessScout: true }); witnessWatch = watched;
  assert.ok(!watched.run.agreements.includes('pantry_marin'));
  assert.ok(watched.run.facts.includes('witness_on_watch')); assert.ok(watched.run.facts.includes('witness_span_rescue'));
  assert.ok(!watched.run.facts.includes('span_manual_rescue')); assert.ok(!watched.run.facts.includes('span_assisted_rescue'));
  assert.ok(watched.run.receipts.includes('trigger:rescue_with_cleared_witness'));
  assert.equal(watched.run.phase, 'victory');
  assert.equal(watched.triggerEffects.find(e => e.trigger === 'rescue_with_cleared_witness').heatDelta, 0, 'Uncontracted lookout recovers no heat.');
});

test('A later retained-witness duty overrides an old pantry scouting agreement without a heat reward', () => {
  let r = walkthrough({ stopBeforeSpan: true }).run;
  assert.equal(r.mission, 7); assert.ok(r.agreements.includes('pantry_marin')); assert.ok(r.flags.includes('witness_retained'));
  assert.equal(r.people.marin.duty, 'witness');
  r = interact(r, 'span_anchor'); r = interact(r, 'span_anchor_socket'); r = interact(r, 'span_load_plate');
  r = operate(r, 'span_console', { op: 'set', handle: 'span_support', value: 'assisted' });
  r = operate(r, 'span_console', { op: 'set', handle: 'span_gate', value: 'open' });
  r = start(snapshot(r));
  const before = snapshot(r), heat = r.heat;
  const rejected = act(r, { kind: 'manual', console: 'span_console', operation: { op: 'trigger', trigger: 'rescue_with_scout' } });
  assert.equal(rejected.state, r); assert.deepEqual(snapshot(r), before); assert.equal(r.heat, heat); assert.equal(r.people.marin.duty, 'witness');
  r = operate(r, 'span_console', { op: 'set', handle: 'span_support', value: 'manual' });
  r = operate(r, 'span_console', { op: 'set', handle: 'span_latch', value: 'locked' });
  r = operate(r, 'span_console', { op: 'trigger', trigger: 'rescue_with_latch' }); r = settle(r);
  assert.ok(r.flags.includes('span_rescued')); assert.equal(r.heat, heat); assert.equal(r.people.marin.duty, 'witness');
  assert.ok(!r.facts.includes('span_assisted_rescue')); assert.ok(r.facts.includes('span_manual_rescue'));
});

test('A pantry scouting contract plus a current lookout duty supplies a prepared line and one heat', () => {
  const watched = walkthrough({ witnessScout: true, pantryScout: true }); contractedWatch = watched;
  assert.ok(watched.run.agreements.includes('pantry_marin')); assert.ok(watched.run.flags.includes('witness_support_ready'));
  assert.ok(watched.run.facts.includes('span_assisted_rescue')); assert.ok(!watched.run.facts.includes('witness_span_rescue'));
  assert.ok(watched.run.receipts.includes('trigger:rescue_with_scout'));
  assert.ok(!watched.run.receipts.includes('trigger:rescue_with_cleared_witness'));
  assert.equal(watched.triggerEffects.find(e => e.trigger === 'rescue_with_scout').heatDelta, 1, 'Prepared contracted line recovers exactly one heat.');
  assert.equal(watched.run.phase, 'victory');
});


const proposedRoutes={}, budgetPaths=[];
test('Public and guarded named/digest routes each complete; guarded named archive and zero-heat full freight remain feasible',()=>{
 for(const [id,options]of Object.entries({guarded_people:{guarded:true},guarded_archive:{guarded:true,archive:true},guarded_all_zero_heat:{guarded:true,allFreight:true},public_digest:{digest:true},guarded_digest:{guarded:true,digest:true},guarded_digest_zero_start:{guarded:true,digest:true,zeroStart:true}})){
  const result=walkthrough(options);proposedRoutes[id]=result.trace;assert.equal(result.run.phase,'victory');
  if(options.guarded){assert.ok(result.run.agreements.includes('keeper_mara'));assert.ok(!result.run.agreements.includes('navigator_mara'));}
  if(options.digest){assert.ok(result.run.flags.includes('digest_records'));assert.ok(!result.run.flags.includes('archive_loaded'));assert.equal(result.run.distribution,'people');}
  if(options.allFreight)assert.equal(result.run.heat,0);
 }
});
test('Named copying pays once upfront; zero heat still permits the free digest and onward main goals',()=>{
 let r=start();r.mission=5;r.flags.push('shelves_raised');r.facts.push('archive_loads');r.heat=1;
 r=operate(r,'index_console',{op:'set',handle:'index_record',value:'original'});r=operate(r,'index_console',{op:'trigger',trigger:'copy_original_index'});assert.equal(r.heat,0);assert.ok(r.flags.includes('original_records'));assert.ok(r.facts.includes('named_copy_paid'));
 r=operate(r,'index_console',{op:'trigger',trigger:'copy_original_index'});assert.equal(r.heat,0);
 let z=start();z.mission=5;z.flags.push('shelves_raised');z.facts.push('archive_loads');z.heat=0;z=operate(z,'index_console',{op:'set',handle:'index_record',value:'original'});
 const failed=act(z,{kind:'manual',console:'index_console',operation:{op:'trigger',trigger:'copy_original_index'}});assert.equal(failed.state,z);
 z=operate(z,'index_console',{op:'set',handle:'index_record',value:'digest'});z=operate(z,'index_console',{op:'trigger',trigger:'copy_index_digest'});assert.equal(z.heat,0);assert.ok(z.flags.includes('archive_copy_ready'));assert.ok(z.flags.includes('digest_records'));
});
test('Guarded custody moves Mara now, reserves her later role and public custody keeps all navigator choices',()=>{
 let base=start();base.mission=6;base.flags.push('responsibility_proven');base.facts.push('dock_tally','archive_margin');
 let guarded=operate(base,'testimony_console',{op:'set',handle:'testimony_publication',value:'private'});guarded=operate(guarded,'testimony_console',{op:'trigger',trigger:'guard_testimony'});
 assert.equal(guarded.people.mara.duty,'keeper');assert.equal(guarded.people.mara.zone,'crown');assert.ok(guarded.flags.includes('mara_keeper_reserved'));
 let publicRun=operate(base,'testimony_console',{op:'set',handle:'testimony_publication',value:'public'});publicRun=operate(publicRun,'testimony_console',{op:'trigger',trigger:'publish_testimony'});assert.equal(publicRun.people.mara.duty,'Archive keeper');
 for(const r of[guarded,publicRun]){r.mission=10;r.facts.push('hearing_summary');}
 assert.equal(view(guarded).terms.find(t=>t.id==='navigator_mara').eligible,false);assert.equal(view(publicRun).terms.find(t=>t.id==='navigator_mara').eligible,true);
 guarded=perform(guarded,{kind:'acceptTerm',term:'navigator_iona'});assert.equal(view(guarded).terms.find(t=>t.id==='keeper_vale').eligible,false);assert.equal(view(guarded).terms.find(t=>t.id==='keeper_mara').eligible,true);
 guarded=perform(guarded,{kind:'acceptTerm',term:'keeper_mara'});assert.ok(guarded.flags.includes('keeper_agreed'));
 const legacy=start();legacy.mission=10;legacy.flags.push('record_guarded');legacy.facts.push('hearing_summary');assert.equal(view(legacy).terms.find(t=>t.id==='navigator_mara').eligible,true,'Older guarded saves did not promise the new Mara reservation.');
});
test('Digest cannot acquire or manifest named archive freight, while passenger completion remains available',()=>{
 let r=cloneForPlay(people.run);r.flags=r.flags.filter(f=>f!=='original_records');
 assert.equal(view(r).finale.distributions.find(d=>d.id==='archive').eligible,false);assert.equal(view(r).finale.distributions.find(d=>d.id==='people').eligible,true);
 r.mission=8;r.flags=r.flags.filter(f=>!['load_chosen','archive_loaded','people_priority'].includes(f));r.receipts=r.receipts.filter(id=>!id.startsWith('trigger:allocate_'));r.flags.push('capacity_verified');r.facts.push('counterweight_loads');
 r=operate(r,'governor_console',{op:'set',handle:'mass_cargo',value:'archive'});assert.equal(act(r,{kind:'manual',console:'governor_console',operation:{op:'trigger',trigger:'allocate_archive_load'}}).state,r);
 r=operate(r,'governor_console',{op:'set',handle:'mass_cargo',value:'light'});r=operate(r,'governor_console',{op:'trigger',trigger:'allocate_light_load'});assert.ok(r.flags.includes('people_priority'));
});
test('Split full-bundle price preserves first-Bridge, first-Surge and Vale-plus-one-Shelter all-freight routes',()=>{
 const configs={surge_all:{allFreight:true,signalActions:{voice:'SURGE'}},clinic_shelter_all:{guarded:true,allFreight:true,pantry:'pantry_vale',signalActions:{voice:'SHELTER',shelter:'BRIDGE',storm:'BRIDGE'}},clinic_two_shelters_all:{guarded:true,allFreight:true,pantry:'pantry_vale',signalActions:{voice:'SHELTER',shelter:'SHELTER',storm:'BRIDGE'}},clinic_bridge_then_shelter_all:{allFreight:true,pantry:'pantry_vale',signalActions:{voice:'BRIDGE',shelter:'SHELTER',storm:'BRIDGE'}},clinic_surge_then_shelter_all:{guarded:true,allFreight:true,pantry:'pantry_vale',signalActions:{voice:'SURGE',shelter:'SHELTER',storm:'BRIDGE'}}};
 assert.equal(emptyReserve.trace[8].heat,0,'The existing all-Bridge route naturally spends 3→2 dock→1 scan→0 full bundle.');
 for(const[id,options]of Object.entries(configs)){
  const result=walkthrough(options);proposedRoutes[id]=result.trace;assert.equal(result.run.phase,'victory');assert.ok(result.run.flags.includes('manifest_all'));assert.ok(result.run.facts.includes('named_copy_paid'));assert.ok(result.run.facts.includes('named_bundle_kept'));
  assert.equal(result.triggerEffects.find(e=>e.trigger==='copy_original_index').heatDelta,-1);assert.equal(result.triggerEffects.find(e=>e.trigger==='allocate_full_load').heatDelta,-1);
  if(id==='clinic_two_shelters_all')assert.equal(result.trace[8].heat,1);else assert.equal(result.trace[8].heat,0);
 }
});
test('Current fresh-start pre-copy budget retains at least one heat in all18 dock/pantry/first-signal combinations',()=>{
 let count=0,minimum=Infinity;
 for(const keepDockFreight of[false,true])for(const pantry of['pantry_marin','pantry_vale','pantry_iona'])for(const voice of['BRIDGE','SHELTER','SURGE']){
  const result=walkthrough({keepDockFreight,pantry,signalActions:{voice},stopAfterIndex:true});assert.ok(result.run.facts.includes('named_copy_paid'));const before=result.trace[5].heat+1;minimum=Math.min(minimum,before);budgetPaths.push({initialHeat:3,dock:keepDockFreight?'auxiliary':'service',pantry,voice,beforeCopy:before,afterCopy:result.trace[5].heat});assert.ok(before>=1);count++;
 }
 assert.equal(count,18);assert.equal(minimum,1);
});
test('Mara has a tailored truthful keeper confirmation under both public and guarded custody',()=>{
 for(const guarded of[false,true]){
  let r=start();r.mission=10;r.facts.push('hearing_summary');if(guarded)r.flags.push('record_guarded','mara_keeper_reserved');
  r=perform(r,{kind:'acceptTerm',term:'navigator_iona'});const term=view(r).terms.find(t=>t.id==='keeper_mara');assert.equal(term.label,'Confirm Mara as record keeper');assert.ok(term.eligible);
  r=perform(r,{kind:'acceptTerm',term:'keeper_mara'});assert.equal(r.incidents.find(i=>i.id==='keeper_mara').text,'Mara confirmed the keeper’s duty for the crossing record and the second cradle.');
 }
});
mkdirSync('.test-results', { recursive: true });
const receipt = { pass: true, scope: 'Authored CPU domain fixtures only. Positions are supplied to test proximity and are not ordinary-control browser play or model inference.', cases, source_sha256: createHash('sha256').update(readFileSync('web/campaign.js')).digest('hex'), content_sha256: createHash('sha256').update(readFileSync('web/campaign-data.js')).digest('hex'), witness_trigger_effects: { uncontracted: witnessWatch.triggerEffects.filter(e => e.mission === 'spanrescue'), contracted: contractedWatch.triggerEffects.filter(e => e.mission === 'spanrescue') }, pre_copy_budget_paths: budgetPaths, proposed_routes: proposedRoutes, campaigns: { people: people.trace, archive: archive.trace, zero_heat: emptyReserve.trace, witness_watch: witnessWatch.trace, contracted_watch: contractedWatch.trace }, endings: [people.run.ending, archive.run.ending, emptyReserve.run.ending, witnessWatch.run.ending, contractedWatch.run.ending] };
writeFileSync('.test-results/campaign-domain.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, cases: cases.length, walkthroughs: walkthroughCount, missions_per_walkthrough: MISSIONS.length, scope: receipt.scope }, null, 2));
