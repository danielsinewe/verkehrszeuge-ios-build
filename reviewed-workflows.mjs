import {isDeepStrictEqual} from 'node:util';

// Only committed, reviewed manifest entries select commands. Source payloads
// provide the workflow hash; they cannot override commands or job identity.
export function selectReviewedWorkflow(job,workflowHash=job?.workflow_hash){
 if(!job||!/^[a-f0-9]{64}$/.test(workflowHash||''))throw Error('Workflow changed: no reviewed workflow version');
 const {workflow_variants:variants,...base}=job;
 if(workflowHash===base.workflow_hash)return base;
 const variant=variants&&Object.hasOwn(variants,workflowHash)?variants[workflowHash]:null;
 if(!variant||typeof variant!=='object'||Array.isArray(variant)||Object.keys(variant).some(key=>key!=='steps'))throw Error('Workflow changed: no reviewed workflow version');
 if(Object.hasOwn(variant,'steps')&&(!Array.isArray(variant.steps)||variant.steps.length<base.steps.length||!isDeepStrictEqual(variant.steps.slice(0,base.steps.length),base.steps)))throw Error('Reviewed workflow version must retain every base check');
 return {...base,...(variant.steps?{steps:variant.steps}:{}),workflow_hash:workflowHash};
}
