import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectReviewedWorkflow,sourceManifestHash,verifySourceDefinition} from './reviewed-workflows.mjs';

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

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function manifestFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-manifest-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const entries=[['package.json','{"name":"fixture","private":true}'],['package-lock.json','{"name":"fixture","lockfileVersion":3}']];
 for(const [file,bytes] of entries)fs.writeFileSync(path.join(root,file),bytes);
 const source_manifest={files:entries.map(([file,bytes])=>({path:file,sha256:digest(bytes)}))};
 const job={id:'fixture',repo:'danielsinewe/fixture',node_version:24,source_manifest,workflow_hash:sourceManifestHash(source_manifest),steps:[{argv:['node','check.mjs']}]};
 return{root,job};
}
test('explicit npm manifest definition verifies paired exact bytes and canonical path order',t=>{
 const {root,job}=manifestFixture(t);assert.equal(verifySourceDefinition(job,root),true);
 assert.deepEqual(selectReviewedWorkflow(job),job);assert.equal(sourceManifestHash({files:[...job.source_manifest.files].reverse()}),job.workflow_hash);
 const before=JSON.stringify(job);verifySourceDefinition(job,root);assert.equal(JSON.stringify(job),before);
 fs.writeFileSync(path.join(root,'package-lock.json'),'changed lockfile');assert.throws(()=>verifySourceDefinition(job,root),/manifest changed/);
});
test('manifest definitions reject absent pairs, duplicate paths, traversal, unknown fields and ambiguous workflow modes',t=>{
 const {root,job}=manifestFixture(t),files=job.source_manifest.files;
 for(const value of [{files:files.slice(0,1)},{files:[...files,files[0]]},{files:[{...files[0],path:'../package.json'},files[1]]},{files:[{...files[0],path:'/package.json'},files[1]]},{files:[{...files[0],path:'web\\package.json'},files[1]]},{files,steps:[]},{files:[{...files[0],command:'unreviewed'},files[1]]},{files:[files[0],{...files[1],path:'web/package-lock.json'}]}])assert.throws(()=>sourceManifestHash(value));
 for(const extra of [{workflow:'ci.yml'},{workflow_variants:{}},{node_version:22},{steps:[]}])assert.throws(()=>selectReviewedWorkflow({...job,...extra}));
 assert.throws(()=>selectReviewedWorkflow(job,'f'.repeat(64)),/no reviewed/);
 fs.unlinkSync(path.join(root,'package.json'));assert.throws(()=>verifySourceDefinition(job,root));
});
test('manifest reads reject links outside the source and oversized files before execution',t=>{
 const {root,job}=manifestFixture(t);const outside=fs.mkdtempSync(path.join(os.tmpdir(),'outside-manifest-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.writeFileSync(path.join(outside,'package.json'),'outside');fs.unlinkSync(path.join(root,'package.json'));fs.symlinkSync(path.join(outside,'package.json'),path.join(root,'package.json'));
 assert.throws(()=>verifySourceDefinition(job,root),/bounds/);fs.unlinkSync(path.join(root,'package.json'));fs.writeFileSync(path.join(root,'package.json'),'x');fs.truncateSync(path.join(root,'package.json'),2*1024*1024+1);assert.throws(()=>verifySourceDefinition(job,root),/bounds/);
});

test('paired workspace manifests are supported without allowing an escaping directory',t=>{
 const {root,job}=manifestFixture(t);fs.mkdirSync(path.join(root,'web'));
 for(const file of job.source_manifest.files){fs.copyFileSync(path.join(root,file.path),path.join(root,'web',file.path));file.path='web/'+file.path;}
 job.workflow_hash=sourceManifestHash(job.source_manifest);assert.equal(verifySourceDefinition(job,root),true);
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'outside-workspace-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(root,'web',file),path.join(outside,file));
 fs.rmSync(path.join(root,'web'),{recursive:true});fs.symlinkSync(outside,path.join(root,'web'));assert.throws(()=>verifySourceDefinition(job,root),/bounds/);
});

test('explicit archive policy rejects unexpected env files before legacy checks and preserves the workflow hash guard',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archive-policy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'ci.yml'),'fixture');const workflow_hash=createHash('sha256').update('fixture').digest('hex');
 const job={workflow:'ci.yml',workflow_hash,source_archive:{exclude_environment_files:true,verify_filtered_tree:true}};assert.equal(verifySourceDefinition(job,root),true);
 fs.mkdirSync(path.join(root,'nested'));fs.writeFileSync(path.join(root,'nested/.env.secret'),'never-read-secret');assert.equal(verifySourceDefinition(job,root,'checkout'),true);assert.throws(()=>verifySourceDefinition(job,root,'filtered_archive'),/environment files/);fs.unlinkSync(path.join(root,'nested/.env.secret'));
 fs.symlinkSync('/unavailable-private-source',path.join(root,'nested/.env.link'));assert.equal(verifySourceDefinition(job,root,'checkout'),true);assert.throws(()=>verifySourceDefinition(job,root,'filtered_archive'),/environment files/);fs.unlinkSync(path.join(root,'nested/.env.link'));
 fs.mkdirSync(path.join(root,'.env-dir'));assert.equal(verifySourceDefinition(job,root,'checkout'),true);assert.throws(()=>verifySourceDefinition(job,root,'filtered_archive'),/environment files/);fs.rmdirSync(path.join(root,'.env-dir'));
 for(const policy of ['unknown','exclude-env',{}, {exclude_environment_files:true}, {exclude_environment_files:true,verify_filtered_tree:false}, {exclude_environment_files:true,verify_filtered_tree:true,unknown:true}])assert.throws(()=>verifySourceDefinition({...job,source_archive:policy},root),/Unknown source archive/);
 assert.throws(()=>verifySourceDefinition(job,root,'unknown'),/Unknown source verification stage/);
 fs.writeFileSync(path.join(root,'ci.yml'),'changed');assert.throws(()=>verifySourceDefinition(job,root),/Workflow changed/);
});
