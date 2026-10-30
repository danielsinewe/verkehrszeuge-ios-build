import {isDeepStrictEqual} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function manifestFiles(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='files')||!Array.isArray(value.files)||value.files.length<2||value.files.length>32)throw Error('Invalid reviewed source manifest');
 const seen=new Set();
 const files=value.files.map(file=>{
  if(!file||typeof file!=='object'||Array.isArray(file)||Object.keys(file).some(k=>!['path','sha256'].includes(k))||typeof file.path!=='string'||file.path.length>240||!/^(?:[a-zA-Z0-9._-]+\/)*(?:package|package-lock)\.json$/.test(file.path)||file.path.split('/').some(part=>['.','..'].includes(part))||seen.has(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256||''))throw Error('Invalid reviewed source manifest file');
  seen.add(file.path);return {path:file.path,sha256:file.sha256};
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const locks=files.filter(file=>file.path.endsWith('package-lock.json'));
 if(!locks.length||locks.some(file=>!seen.has(file.path.replace(/package-lock\.json$/,'package.json'))))throw Error('Reviewed source manifest needs a paired package and lockfile');
 return files;
}
export function sourceManifestHash(manifest){return hash(JSON.stringify({kind:'source_manifest',files:manifestFiles(manifest)}));}
export function verifySourceDefinition(job,root){
 if(!Object.hasOwn(job,'source_manifest')){
  if(hash(fs.readFileSync(path.join(root,job.workflow)))!==job.workflow_hash)throw Error('Workflow changed: no reviewed workflow version');
  return true;
 }
 if(job.workflow||job.workflow_variants||sourceManifestHash(job.source_manifest)!==job.workflow_hash||job.node_version!==24||Number(process.versions.node.split('.')[0])!==24)throw Error('Source manifest definition or Node24 runtime changed');
 const base=fs.realpathSync(root);let total=0;
 for(const file of manifestFiles(job.source_manifest)){
  const target=path.join(base,file.path);let stat,real,bytes;
  try{stat=fs.lstatSync(target);real=fs.realpathSync(target);}catch{throw Error('Source manifest file unavailable');}
  if(!stat.isFile()||stat.isSymbolicLink()||!real.startsWith(base+path.sep)||stat.size>2*1024*1024||(total+=stat.size)>8*1024*1024)throw Error('Source manifest file is outside the reviewed bounds');
  try{bytes=fs.readFileSync(target);}catch{throw Error('Source manifest file unavailable');}
  if(hash(bytes)!==file.sha256)throw Error('Source manifest changed: review before execution');
 }
 return true;
}

// Only committed, reviewed manifest entries select commands. Source payloads
// provide the workflow hash; they cannot override commands or job identity.
export function selectReviewedWorkflow(job,workflowHash=job?.workflow_hash){
 if(!job||!/^[a-f0-9]{64}$/.test(workflowHash||''))throw Error('Workflow changed: no reviewed workflow version');
 if(Object.hasOwn(job,'source_manifest')){
  if(job.workflow||job.workflow_variants||sourceManifestHash(job.source_manifest)!==job.workflow_hash||workflowHash!==job.workflow_hash||job.node_version!==24||!Array.isArray(job.steps)||job.steps.length<1||job.steps.length>32)throw Error('Source manifest changed: no reviewed definition');
  return {...job};
 }
 const {workflow_variants:variants,...base}=job;
 if(workflowHash===base.workflow_hash)return base;
 const variant=variants&&Object.hasOwn(variants,workflowHash)?variants[workflowHash]:null;
 if(!variant||typeof variant!=='object'||Array.isArray(variant)||Object.keys(variant).some(key=>key!=='steps'))throw Error('Workflow changed: no reviewed workflow version');
 if(Object.hasOwn(variant,'steps')&&(!Array.isArray(variant.steps)||variant.steps.length<base.steps.length||!isDeepStrictEqual(variant.steps.slice(0,base.steps.length),base.steps)))throw Error('Reviewed workflow version must retain every base check');
 return {...base,...(variant.steps?{steps:variant.steps}:{}),workflow_hash:workflowHash};
}
