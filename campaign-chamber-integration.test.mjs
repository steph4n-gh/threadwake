import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { start, act, request, view, snapshot } from './web/campaign.js';
import { FIXTURES, FACTS } from './web/campaign-data.js';
import * as Chambers from './web/campaign-chambers.js';
let observedPackets = [];
const cases = [], actions = ['BRIDGE','SHELTER','SURGE'];
const f = FIXTURES.find(f => f.signal === 'voice');
const intent = (run, value) => { const result = act(run,value); assert.notEqual(result.state,run,result.message); return result.state; };
const op = (run,operation) => intent(run,{kind:'manual',console:f.id,operation});
const set = (run,index,value) => op(run,{op:'set',handle:'chamber_voice_r'+index,value:String(value)});
const trigger = (run,id) => op(run,{op:'trigger',trigger:'chamber_voice_'+id});
function captured(result={id:'CPU_AUTHORED_REFERENCE',action:'BRIDGE',provenance:'authored'}) {
  let run=start();run.mission=3;run.flags.push('choir_locked');run.pos={x:f.x,z:f.z};
  const pending=request(run,{kind:'thought',subject:f.id,text:'Explicit authored CPU fixture, not native inference.'});assert.ok(pending.packet);
  return intent(pending.state,{kind:'attuned',fixture:f.id,ticket:pending.packet.ticket,result});
}
function refs(run) { for(const action of actions) run=intent(run,{kind:'referenceTool',fixture:f.id,action}); return run; }
function solution(run) {
 const stage=Chambers.CATALOG.voice.stages[run.chambers.voice.stage];run=intent(run,{kind:'toolMix',fixture:f.id,weights:stage.referenceWeights});
 for(let i=0;i<9;i++)run=set(run,i,stage.solution[i]);return run;
}
function test(name,fn){fn();cases.push(name);}
const nativeFixture={id:'CPU_NATIVE_SHAPED_FIXTURE_NOT_INFERENCE',status:'complete',provenance:'local',model_revision:'AUTHORED_CPU_FIXTURE_NOT_INFERENCE',action:'SHELTER',baseline_action:'BRIDGE',probabilities_before:{BRIDGE:.8,SHELTER:.1,SURGE:.1},probabilities_after:{BRIDGE:.1,SHELTER:.8,SURGE:.1},steering:{applied:true,strength:.5,scope:'focused',delta_l2:2,changed_elements:10,edited_tokens:1}};

test('Physical source capture and proximity gate chamber programming and authored recovery',()=>{
 let r=start();r.mission=3;r.flags.push('choir_locked');r.pos={x:f.x,z:f.z};
 assert.equal(act(r,{kind:'referenceTool',fixture:f.id,action:'BRIDGE'}).state,r);
 assert.equal(request(r,{kind:'work_order',subject:f.id,text:'Turn A1 right.'}).packet,null);
 r=captured();r.pos={x:0,z:0};assert.equal(act(r,{kind:'referenceTool',fixture:f.id,action:'SHELTER'}).state,r);
});
test('Capture stores the complete profile and first actual winner powers its own bank slot',()=>{
 const r=captured(nativeFixture);assert.deepEqual(r.toolBank.SHELTER.probabilities_after,nativeFixture.probabilities_after);assert.equal(r.toolBank.SHELTER.steering.delta_l2,2);
 assert.deepEqual(r.toolWeights,[0,100,0]);assert.deepEqual(r.toolMixture,nativeFixture.probabilities_after);assert.equal(r.toolBank.BRIDGE,undefined);
 const saved=start(snapshot(r));assert.equal(saved.restoreWarning,undefined);assert.deepEqual(saved.toolMixture,r.toolMixture);assert.deepEqual(saved.toolBank,r.toolBank);
 const forged=snapshot(r);forged.toolBank.SHELTER.steering.delta_l2=0;assert.ok(start(forged).restoreWarning);
});
test('Weights mix actual probabilities while authored recovery grants no world benefit',()=>{
 let r=captured(nativeFixture);const original={heat:r.heat,strain:r.strain,flags:[...r.flags],spectra:structuredClone(r.spectra)};
 r=intent(r,{kind:'referenceTool',fixture:f.id,action:'BRIDGE'});assert.equal(r.toolBank.BRIDGE.provenance,'authored');
 assert.equal(r.heat,original.heat);assert.equal(r.strain,original.strain);assert.deepEqual(r.flags,original.flags);assert.deepEqual(r.spectra,original.spectra);
 r=intent(r,{kind:'toolMix',fixture:f.id,weights:[25,75,0]});for(const [action,value]of Object.entries({BRIDGE:.2825,SHELTER:.6275,SURGE:.09}))assert.ok(Math.abs(r.toolMixture[action]-value)<1e-10);
 r=intent(r,{kind:'toolMix',fixture:f.id,weights:[0,0,100]});assert.deepEqual(r.toolMixture,{BRIDGE:0,SHELTER:0,SURGE:0});
 const panel=view(r).machines.find(m=>m.fixture===f.id);assert.ok(panel.triggers.every(t=>!t.enabled));assert.equal(panel.chamber.report.powered,false);
 assert.equal(act(r,{kind:'manual',console:f.id,operation:{op:'trigger',trigger:'chamber_voice_probe'}}).state,r);
});
test('Dynamic rotor controls use the bounded plan domain and changing mixture invalidates stale native plans',()=>{
 let r=captured();const p=request(r,{kind:'work_order',subject:f.id,text:'Turn rotor A1 to 90 degrees.'});assert.ok(p.packet);assert.equal(p.packet.scene.handles.length,9);assert.equal(p.packet.scene.handles[0].label,'Rotor A1');
 assert.deepEqual(p.packet.scene.handles[0].values.map(v=>v.id),['0','1','2','3']);
 r=intent(p.state,{kind:'toolMix',fixture:f.id,weights:[100,0,0]});
 const result={status:'complete',kind:'work_order',provenance:'local',ticket:p.packet.ticket,proposal:{status:'ready',operations:[{op:'set',handle:'chamber_voice_r0',value:'1'}]}};
 const failed=act(r,{kind:'receive',ticket:p.packet.ticket,result});assert.equal(failed.state.pending,null);assert.equal(failed.state.preview,null);assert.deepEqual(failed.state.chambers,r.chambers);
 assert.equal(act(r,{kind:'manual',console:f.id,operation:{op:'set',handle:'chamber_shelter_r0',value:'1'}}).state,r);
});
test('Dry probes are safe; dangerous commits scar once per phase even across save and reload',()=>{
 let r=refs(captured());r=intent(r,{kind:'toolMix',fixture:f.id,weights:[100,0,0]});
 let found=null;for(let code=0;code<4**9&&!found;code++){let n=code;const values=[];for(let i=0;i<9;i++){values.push(n%4);n=Math.floor(n/4);}const candidate={...r.chambers.voice,orientations:values};if(Chambers.probe(candidate,r.toolMixture).dangerous)found=values;}
 assert.ok(found);for(let i=0;i<9;i++)r=set(r,i,found[i]);const strain=r.strain,scars=r.scars;
 r=trigger(r,'probe');assert.equal(r.strain,strain);assert.equal(r.scars,scars);r=trigger(r,'probe');assert.equal(r.scars,scars);
 const before=snapshot(r);r=intent(r,{kind:'authoredPlan',console:f.id,operations:[{op:'trigger',trigger:'chamber_voice_commit'}]});assert.deepEqual(r.chambers,before.chambers);assert.equal(r.preview.strain,4);assert.equal(r.preview.scars,1);
 r=intent(r,{kind:'confirm',proposalId:r.preview.id});assert.equal(r.strain,strain+4);assert.equal(r.scars,scars+1);assert.equal(r.chambers.voice.stage,0);
 r=start(snapshot(r));assert.equal(r.restoreWarning,undefined);r=trigger(r,'commit');assert.equal(r.strain,strain+4);assert.equal(r.scars,scars+1);
});
test('Three tested phases complete the mission goal and cannot be replayed or forged by an inconsistent flag',()=>{
 let r=refs(captured());assert.ok(view(r).objectives.some(g=>g.flag==='chamber_voice_complete'&&!g.complete));
 for(let i=0;i<3;i++){r=solution(r);assert.ok(view(r).machines.find(m=>m.fixture===f.id).chamber.report.pass);r=trigger(r,'commit');assert.equal(r.chambers.voice.stage,i+1);r=start(snapshot(r));assert.equal(r.restoreWarning,undefined);}
 assert.ok(r.flags.includes('chamber_voice_complete'));assert.ok(r.facts.includes('chamber_voice_restored'));assert.ok(view(r).objectives.find(g=>g.flag==='chamber_voice_complete').complete);
 const before=snapshot(r);assert.equal(act(r,{kind:'manual',console:f.id,operation:{op:'trigger',trigger:'chamber_voice_commit'}}).state,r);assert.deepEqual(snapshot(r),before);
 const forged=snapshot(captured());forged.flags.push('chamber_voice_complete');const restored=start(forged);assert.ok(!restored.flags.includes('chamber_voice_complete'));
});
test('A confirmed bounded program advances a valid chamber phase only once and preview leaves routing intact',()=>{
 let r=refs(captured());r=solution(r);const before=snapshot(r);r=intent(r,{kind:'authoredPlan',console:f.id,operations:[{op:'trigger',trigger:'chamber_voice_probe'},{op:'trigger',trigger:'chamber_voice_commit'}]});assert.deepEqual(r.chambers,before.chambers);assert.equal(r.preview.strain,0);assert.equal(r.preview.scars,0);
 const id=r.preview.id;r=intent(r,{kind:'confirm',proposalId:id});assert.equal(r.chambers.voice.stage,1);assert.equal(r.program,null);assert.equal(act(r,{kind:'confirm',proposalId:id}).state,r);
 const restored=start(snapshot(r));assert.equal(restored.chambers.voice.stage,1);assert.equal(restored.chambers.voice.attempts,1);
});
test('Live instrument observations precede crowded history, stay bounded and reveal no authored solution',()=>{
 let r=refs(captured());r.facts=Object.keys(FACTS);r=set(r,0,2);r.conversation=Array.from({length:10},(_,i)=>({speaker:i%2?'character':'player',text:'Prior history '.repeat(40),person:'iona',provenance:'authored'}));
 const p=request(r,{kind:'work_order',subject:f.id,text:'Trace the chamber and inspect rotor A1.'});assert.ok(p.packet);
 const names=['rules','grid','goals','trace','input'].map(name=>'optics_voice_'+name);assert.deepEqual(p.packet.scene.facts.slice(0,5).map(f=>f.id),names);assert.equal(p.packet.scene.facts.length,8);assert.ok(p.packet.scene.facts.every(f=>f.text.length<=600));
 const observation=JSON.stringify(p.packet.scene.facts.slice(0,5));assert.ok(!/verified route|authored reference weights|orientations|solution/i.test(observation));assert.ok(p.packet.scene.facts[1].text.includes('A1 rotator 180°'));assert.ok(p.packet.scene.facts[2].text.includes('distinct cells'));assert.ok(p.packet.scene.facts[3].text.includes('safe dry-trace predictions'));assert.ok(p.packet.scene.facts[4].text.includes('authored'));
 assert.ok(Buffer.byteLength(JSON.stringify(p.packet),'utf8')<=16384);
 const talk=request(r,{kind:'conversation',subject:'iona',text:'What does this chamber readout say about the beam and receiver?'});assert.ok(talk.packet);assert.deepEqual(talk.packet.scene.facts.slice(0,5).map(f=>f.id),names);assert.equal(talk.packet.scene.facts.length,8);assert.ok(Buffer.byteLength(JSON.stringify(talk.packet),'utf8')<=16384);
 observedPackets = [p.packet, talk.packet];
 const reply={status:'complete',kind:'conversation',ticket:talk.packet.ticket,provenance:'local',proposal:{cited_facts:['optics_voice_grid','optics_voice_input'],proposal:null}};
 const heard=intent(talk.state,{kind:'receive',ticket:talk.packet.ticket,result:reply});assert.deepEqual(heard.conversation.at(-1).cited_facts,reply.proposal.cited_facts);
 const unrelated=request(r,{kind:'conversation',subject:'iona',text:'What do you remember about our freight?'});assert.ok(!unrelated.packet.scene.facts.some(f=>f.id.startsWith('optics_')));
 r.pos={x:0,z:0};const away=request(r,{kind:'conversation',subject:'iona',text:'What about that chamber?'});assert.ok(!away.packet.scene.facts.some(f=>f.id.startsWith('optics_')));
});
test('Named crossing duties and pantry commitments explain unavailable agreements in human language',()=>{
 let r=start();r.mission=10;r.facts.push('hearing_summary');
 assert.ok(view(r).terms.find(t=>t.id==='keeper_mara').missing.includes('Choose a navigator first.'));
 r=intent(r,{kind:'acceptTerm',term:'navigator_marin'});
 assert.ok(view(r).terms.find(t=>t.id==='navigator_vale').missing.includes('A navigator has already been chosen.'));
 assert.ok(view(r).terms.find(t=>t.id==='keeper_marin').missing.includes('Marin already has a crossing duty.'));
 r=intent(r,{kind:'acceptTerm',term:'keeper_vale'});
 assert.ok(view(r).terms.find(t=>t.id==='keeper_mara').missing.includes('A keeper has already been chosen.'));
 let p=start();p.mission=2;p.flags.push('heater_tested');p=intent(p,{kind:'acceptTerm',term:'pantry_marin'});
 assert.ok(view(p).terms.find(t=>t.id==='pantry_vale').missing.includes('The pantry allocation has already been agreed.'));
});
test('Sealed ending cards preserve actual distribution and named crossing agreements after afterglow',()=>{
 let r=start();r.mission=10;r.facts.push('hearing_summary');r=intent(r,{kind:'acceptTerm',term:'navigator_iona'});r=intent(r,{kind:'acceptTerm',term:'keeper_mara'});
 const before=request(r,{kind:'conversation',subject:'mara',text:'Who will keep the crossing record?'});assert.ok(!before.packet.scene.facts.some(f=>['ending_summary','crossing_duties'].includes(f.id)));
 // Explicit authored terminal-state fixture tests context projection, not campaign completion.
 r.phase='victory';r.distribution='archive';r.ending={distribution:'archive',heat:2,scars:1,agreements:[...r.agreements],choices:{...r.choices},mixture:[.34,.33,.33],engagedSeconds:120};
 r=intent(r,{kind:'epilogue'});assert.equal(r.people.iona.duty,'At the refuge');
 const p=request(r,{kind:'conversation',subject:'mara',text:'What happened and who took which duty?'});assert.ok(p.packet);assert.deepEqual(p.packet.scene.facts.slice(0,2).map(f=>f.id),['ending_summary','crossing_duties']);
 assert.match(p.packet.scene.facts[0].text,/people and the retained archive/);assert.match(p.packet.scene.facts[0].text,/heat at completion: 2/);assert.match(p.packet.scene.facts[0].text,/scars at completion: 1/);
 assert.match(p.packet.scene.facts[1].text,/navigator — Iona; keeper — Mara/);assert.ok(p.packet.scene.facts.length<=8);assert.deepEqual(p.packet.scene.terms,[]);
 observedPackets.push(p.packet);
 const reply={status:'complete',kind:'conversation',ticket:p.packet.ticket,provenance:'local',proposal:{cited_facts:['ending_summary','crossing_duties'],proposal:null}};
 r=intent(p.state,{kind:'receive',ticket:p.packet.ticket,result:reply});assert.deepEqual(r.conversation.at(-1).cited_facts,['ending_summary','crossing_duties']);
 const restored=start(snapshot(r));const q=request(restored,{kind:'conversation',subject:'mara',text:'Who guided the first cradle?'});assert.match(q.packet.scene.facts[1].text,/navigator — Iona; keeper — Mara/);
});
test('A completed chamber reports its sealed profile after later global tool retuning',()=>{
 let r=refs(captured());for(let i=0;i<3;i++){r=solution(r);r=trigger(r,'commit');}
 const sealed=structuredClone(r.chambers.voice.committedProfile);r=intent(r,{kind:'toolMix',fixture:f.id,weights:[0,0,100]});
 assert.deepEqual(r.toolMixture,Chambers.recoverySpectrum('SURGE'));
 let chamber=view(r).machines.find(m=>m.fixture===f.id).chamber;assert.deepEqual(chamber.report.source,sealed);assert.deepEqual(chamber.mixture,sealed);
 const p=request(r,{kind:'conversation',subject:'iona',text:'Explain this completed chamber readout and spectrum.'});const card=p.packet.scene.facts.find(f=>f.id==='optics_voice_input');
 assert.match(card.text,/Sealed committed source: BRIDGE 33.33%, SHELTER 33.33%, SURGE 33.33%/);assert.match(card.text,/Current global tool mixture.*SURGE 83.00%/);assert.ok(card.text.length<=600);
 r=start(snapshot(r));chamber=view(r).machines.find(m=>m.fixture===f.id).chamber;assert.deepEqual(chamber.mixture,sealed);assert.deepEqual(r.toolMixture,Chambers.recoverySpectrum('SURGE'));
});
test('Long routing exploration keeps completed phase evidence while its activity log stays bounded',()=>{
 let r=trigger(solution(refs(captured())),'commit');
 const committed=structuredClone(r.events.find(e=>e.type==='chamber-commit'&&e.pass));
 assert.equal(committed.orientations.length,9);assert.deepEqual(committed.mixture,Chambers.recoverySpectrum('BRIDGE'));
 assert.ok(committed.provenance.every(p=>p.probabilities&&p.provenance==='authored'));
 for(let i=0;i<1030;i++)r=set(r,0,i%4);
 assert.equal(r.events.length,1000);assert.deepEqual(r.events.find(e=>e.type==='chamber-commit'&&e.pass),committed);
 r=start(snapshot(r));assert.deepEqual(r.events.find(e=>e.type==='chamber-commit'&&e.pass),committed);
});
const paths=['web/campaign.js','web/campaign-data.js','web/campaign-chambers.js'];
mkdirSync('.test-results',{recursive:true});
writeFileSync('.test-results/chamber-observed-requests.json',JSON.stringify(observedPackets,null,2)+'\n');
const receipt={checked_at_utc:new Date().toISOString(),pass:true,scope:'Authored CPU domain fixtures and explicit authored recovery tools only. Native-shaped objects are labeled synthetic; no native inference, ordinary UI control, browser visuals or gameplay duration evidence.',cases,source_sha256:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))};
writeFileSync('.test-results/chamber-integration.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({pass:true,cases:cases.length},null,2));
