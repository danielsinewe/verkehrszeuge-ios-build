import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectReviewedWorkflow} from './reviewed-workflows.mjs';

test('exact workflow version selects stronger fixed commands without mutating the base',()=>{
 const base={repo:'danielsinewe/fixture',workflow_hash:'a'.repeat(64),steps:[{argv:['node','base.mjs']}]};
 const hash='b'.repeat(64),steps=[...base.steps,{argv:['node','rendered.mjs']}],job={...base,workflow_variants:{[hash]:{steps}}};
 assert.deepEqual(selectReviewedWorkflow(job),base);assert.deepEqual(selectReviewedWorkflow(job,hash).steps,steps);
 assert.throws(()=>selectReviewedWorkflow(job,'c'.repeat(64)),/no reviewed/);assert.equal(job.workflow_hash,base.workflow_hash);
});
test('a source payload cannot override identity, remove a check or weaken failure handling',()=>{
 const hash='b'.repeat(64),base={workflow_hash:'a'.repeat(64),steps:[{argv:['node','base.mjs']}]};
 for(const variant of [{repo:'other'},{steps:[]},{steps:null},{steps:[{argv:['node','base.mjs'],continue_on_error:true}]}])assert.throws(()=>selectReviewedWorkflow({...base,workflow_variants:{[hash]:variant}},hash));
});
test('every committed catalog variant retains base commands and its exact workflow hash',()=>{
 const catalog=JSON.parse(fs.readFileSync(new URL('./catalog.json',import.meta.url)));
 let count=0;
 for(const job of Object.values(catalog))for(const hash of Object.keys(job.workflow_variants||{})){
  const selected=selectReviewedWorkflow(job,hash);assert.equal(selected.workflow_hash,hash);assert.equal(selected.repo,job.repo);assert.deepEqual(selected.steps.slice(0,job.steps.length),job.steps);count++;
 }
 assert.ok(count>0);
});
