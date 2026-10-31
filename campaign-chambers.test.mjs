import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CATALOG, start, orient, probe, commit, view, recoverySpectrum } from './web/campaign-chambers.js';
import { mixSpectra } from './web/puzzles.js';
const ACTIONS=['BRIDGE','SHELTER','SURGE'];
const vector=weights=>Object.fromEntries(ACTIONS.map((action,index)=>[action,weights[index]]));
const cases=[], walkthroughs=[];
const check=(name,fn)=>{fn();cases.push(name);};
function solve(state){for(const [index,value] of CATALOG[state.site].stages[state.stage].solution.entries())state=orient(state,index,value);return state;}
for(const site of Object.keys(CATALOG)){
 let state=start(site); const stages=[];
 for(let phase=0;phase<3;phase++){
  const layout=CATALOG[site].stages[phase], source=vector(layout.referenceWeights);
  check(site+' '+phase+' starts unsolved and visibly unpowered',()=>{assert.equal(probe(state,source).pass,false);const zero=probe(state,vector([0,0,0]));assert.equal(zero.pass,false);assert.equal(zero.powered,false);assert.equal(zero.beams.length,0);});
  state=solve(state); const before=structuredClone(state), report=probe(state,source);
  check(site+' '+phase+' authored route and mixture solve',()=>{assert.equal(report.pass,true);assert.deepEqual(state,before);assert.ok(report.beams.length<=111);assert.ok(report.paths.every(p=>!p.cycle));for(const band of layout.required){const p=report.paths[band];assert.ok(new Set(p.visited).size>=5);assert.ok(layout.checkpoints[band].every(c=>p.visited.includes(c)));}});
  check(site+' '+phase+' save and reload preserve exact probe',()=>{assert.deepEqual(probe(start(site,JSON.parse(JSON.stringify(state))),source),report);});
  const outcome=commit(state,source);assert.equal(outcome.advanced,true);assert.equal(outcome.complete,phase===2);assert.deepEqual(outcome.consequence,{strain:0,scars:0});
  stages.push({id:layout.id,referenceWeights:layout.referenceWeights,orientations:state.orientations,paths:report.paths.map(p=>({band:p.band,cells:p.visited,port:p.exit.id})),received:report.sinks.map(s=>s.received)});state=outcome.state;
 }
 check(site+' completed state is idempotent and freezes actual committed spectrum',()=>{const result=commit(state,vector([0,0,0]));assert.equal(result.state,state);assert.deepEqual(result.consequence,{strain:0,scars:0});assert.equal(result.report.pass,true);assert.deepEqual(view(state,vector([100,0,0])).report.source,state.committedProfile);});
 check(site+' completed save restores a still-valid sealed route and spectrum',()=>{const restored=start(site,JSON.parse(JSON.stringify(state)));assert.deepEqual(restored,state);assert.equal(probe(restored,restored.committedProfile).pass,true);});
 check(site+' completed save rejects an unpowered committed spectrum',()=>{assert.throws(()=>start(site,{...structuredClone(state),committedProfile:vector([0,0,0])}),/sealed route and spectrum/);});
 check(site+' completed save rejects a failing single-band committed spectrum',()=>{assert.throws(()=>start(site,{...structuredClone(state),committedProfile:vector([0,1,0])}),/sealed route and spectrum/);});
 check(site+' completed save rejects final rotor geometry that no longer qualifies',()=>{assert.throws(()=>start(site,{...structuredClone(state),orientations:[...CATALOG[site].stages[2].initial]}),/sealed route and spectrum/);});
 walkthroughs.push({site,complete:state.complete,solved:state.solved,stages});
}
const recovery=ACTIONS.map(recoverySpectrum);
for(const site of Object.keys(CATALOG)){
 let state=start(site);
 for(const layout of CATALOG[site].stages){
  const source=mixSpectra(recovery,layout.referenceWeights);state=solve(state);
  check(site+' '+layout.id+' noisy authored recovery still solves with unchanged route and weights',()=>{const r=probe(state,source);assert.equal(r.pass,true);assert.equal(r.leakTotal,0);assert.ok(r.paths.every((p,index)=>p.exit?.id===layout.ports[index]));});
  state=commit(state,source).state;
 }
 assert.equal(state.complete,true);
}
check('Recovery profiles are explicit nonideal authored vectors, fresh per call and validate their action',()=>{assert.deepEqual(recoverySpectrum('BRIDGE'),vector([.83,.11,.06]));assert.deepEqual(recoverySpectrum('SHELTER'),vector([.06,.83,.11]));assert.deepEqual(recoverySpectrum('SURGE'),vector([.11,.06,.83]));const a=recoverySpectrum('BRIDGE');a.BRIDGE=0;assert.equal(recoverySpectrum('BRIDGE').BRIDGE,.83);assert.throws(()=>recoverySpectrum('UNKNOWN'));});
check('Wrong-exit noisy sideband cannot pass and a safe failed energize charges no damage',()=>{const state=start('voice');state.orientations=[1,0,1,3,2,1,0,3,1];const r=probe(state,recoverySpectrum('BRIDGE'));assert.equal(r.pass,false);assert.equal(r.dangerous,false);assert.ok(Math.abs(r.leakTotal-.06)<1e-9);assert.equal(r.leakMax,.025);assert.equal(r.goals.find(g=>g.id==='leakage').pass,false);const out=commit(state,recoverySpectrum('BRIDGE'));assert.equal(out.advanced,false);assert.deepEqual(out.consequence,{strain:0,scars:0});});
check('Same argmax and same geometry can pass or fail from actual component magnitudes',()=>{const state=solve(start('voice'));assert.equal(probe(state,vector([.72,.2,.08])).pass,true);assert.equal(probe(state,vector([.66,.2,.14])).pass,false);});
check('Malformed and nonfinite power rejected, huge finite components normalize safely',()=>{const state=start('voice');for(const v of [{BRIDGE:NaN,SHELTER:0,SURGE:1},{BRIDGE:Infinity,SHELTER:0,SURGE:1},{BRIDGE:-1,SHELTER:0,SURGE:1},{BRIDGE:1,SHELTER:0},[1,0,0]])assert.throws(()=>probe(state,v));const r=probe(state,vector([1e308,1e308,1e308]));assert.deepEqual(ACTIONS.map(a=>r.source[a]),[1/3,1/3,1/3]);});
check('Invalid save stage or earned-prefix claims rejected',()=>{const state=start('voice');for(const patch of [{stage:3,complete:true},{solved:['voice_2']},{orientations:[0,0,0]},{faulted:['storm_1']},{attempts:2,revision:0}])assert.throws(()=>start('voice',{...state,...patch}));});
check('Invalid orientation rejected; same-value and complete orientation are idempotent',()=>{const state=start('voice');for(const [i,v] of [[-1,0],[9,0],[0,4],[0,NaN],[0,.5]])assert.throws(()=>orient(state,i,v));assert.equal(orient(state,0,state.orientations[0]),state);});
let dangerous, exhaustiveOrientations=0, longestTrace=0, noisyPassingOrientations=0;
for(let code=0;code<262144;code++){
 let n=code;const state=start('voice');state.orientations=state.orientations.map(()=>{const v=n%4;n=Math.floor(n/4);return v;});const r=probe(state,vector([1,0,0]));
 const noisy=probe(state,recoverySpectrum('BRIDGE'));if(noisy.pass){noisyPassingOrientations++;assert.equal(noisy.leaks.length,0);}
 if(r.dangerous&&!dangerous)dangerous=state;exhaustiveOrientations++;assert.ok(r.paths.every(p=>!p.cycle));longestTrace=Math.max(longestTrace,r.beams.length);assert.ok(r.beams.length<=37);
}
check('All4^9 orientations have finite external-source paths in the reversible optical grid',()=>{assert.equal(exhaustiveOrientations,262144);assert.ok(longestTrace<=37);});
check('All4^9 configurations preserve every noisy recovery band whenever they pass',()=>{assert.ok(noisyPassingOrientations>0);});
check('Dry probe warns without damage; dangerous failed commit scars only once per stage across restore',()=>{assert.ok(dangerous);const original=structuredClone(dangerous),r=probe(dangerous,vector([1,0,0]));assert.equal(r.dangerous,true);assert.match(r.diagnosis,/\+4 strain/);assert.deepEqual(dangerous,original);const first=commit(dangerous,vector([1,0,0]));assert.equal(first.advanced,false);assert.deepEqual(first.consequence,{strain:4,scars:1});const restored=start('voice',JSON.parse(JSON.stringify(first.state)));const second=commit(restored,vector([1,0,0]));assert.deepEqual(second.consequence,{strain:0,scars:0});assert.equal(second.state.faulted.length,1);assert.equal(second.state.stage,0);});
const files=['web/campaign-chambers.js','campaign-chambers.test.mjs'];
const result={pass:true,scope:'Authored pure CPU domain fixtures. Offline searched layouts are frozen at runtime. No browser, model inference or ordinary-control play.',cases,walkthroughs,exhaustiveOrientations,noisyPassingOrientations,longestTrace,source_sha256:Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))};
fs.mkdirSync('.test-results',{recursive:true});
fs.writeFileSync('.test-results/chamber-domain.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({pass:true,cases:cases.length,sites:walkthroughs.length,stages:walkthroughs.reduce((n,w)=>n+w.stages.length,0)},null,2));
