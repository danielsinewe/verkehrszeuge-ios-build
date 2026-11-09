import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeProofScope} from './native-proof-scope.mjs';

test('the259 isolated policy request cannot inherit a CameraX phase or capture flag',()=>{
 const scope=nativeProofScope({suite:'recording-capture',proofKind:'synthetic-admission-policy-only'},'android');
 const envelope=JSON.parse(JSON.stringify({status:'success',...scope}));
 assert.equal(envelope.nativeCapture,false);assert.equal(envelope.actualCapture,false);
 assert.equal(envelope.captureScope,'synthetic-policy-only');assert.match(envelope.phase,/Synthetic admission policy/);
 assert.doesNotMatch(envelope.phase,/CameraX recording|strict live capture proof/);
 assert.throws(()=>nativeProofScope({suite:'recording-capture',proofKind:'synthetic-admission-policy-only',actualCapture:true},'android'),/cannot declare/);
});
test('the existing real recording journey retains its phase and native capture scope',()=>{
 for(const proofKind of [undefined,'camerax-recording-capture']){
  const scope=nativeProofScope({suite:'recording-capture',proofKind},'android');
  assert.equal(scope.nativeCapture,true);assert.equal(scope.actualCapture,null);
  assert.equal(scope.phase,'CameraX recording and strict live capture proof');
 }
});
test('unknown supplied scripts are unknown even when they claim actual capture',()=>{
 for(const actualCapture of [undefined,true]){
  const scope=nativeProofScope({suite:'recording-capture',proofKind:'future-policy-test',actualCapture},'android');
  assert.equal(scope.nativeCapture,null);assert.equal(scope.actualCapture,null);assert.equal(scope.captureScope,'unknown');
  assert.match(scope.phase,/scope unknown/);
 }
});
test('explicit false overrides a capture default; strings cannot become truthy capture',()=>{
 const scope=nativeProofScope({suite:'recording-capture',actualCapture:false},'android');
 assert.equal(scope.nativeCapture,false);assert.equal(scope.actualCapture,false);assert.doesNotMatch(scope.phase,/CameraX/);
 assert.throws(()=>nativeProofScope({suite:'recording-capture',actualCapture:'false'},'android'),/boolean/);
});
test('existing ordinary Android and iOS UI journeys keep their defaults',()=>{
 assert.equal(nativeProofScope({},'android').nativeCapture,true);
 assert.equal(nativeProofScope({},'ios').nativeCapture,false);
 assert.equal(nativeProofScope({},'ios').actualCapture,null);
});
