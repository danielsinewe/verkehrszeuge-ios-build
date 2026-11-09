// Scope describes the authenticated request, not successful camera measurements.
// A supplied script must never inherit capture claims from its transport suite.
export function nativeProofScope(request, platform) {
 if(platform!=='android'||request.suite!=='recording-capture')return {
  proofKind:'native-ui-journey',phase:'native UI assertions',
  nativeCapture:platform==='android',actualCapture:null,captureScope:'native-ui-journey',
 };
 if(request.actualCapture!==undefined&&typeof request.actualCapture!=='boolean')throw Error('actualCapture must be a boolean.');
 const kind=request.proofKind;
 if(kind==='synthetic-admission-policy-only'){
  if(request.actualCapture===true)throw Error('Synthetic policy proof cannot declare actual capture.');
  return {proofKind:kind,phase:'Synthetic admission policy on Android; no camera or PixelCopy',
   nativeCapture:false,actualCapture:false,captureScope:'synthetic-policy-only'};
 }
 if(request.actualCapture===false)return {
  proofKind:kind??'unspecified',phase:'Supplied Android proof; capture explicitly disabled',
  nativeCapture:false,actualCapture:false,captureScope:'capture-disabled',
 };
 // No proofKind is the existing real CameraX recording journey. New scripts
 // with an unknown kind cannot promote themselves with actualCapture:true.
 if(kind===undefined||kind==='camerax-recording-capture')return {
  proofKind:kind??'camerax-recording-capture',phase:'CameraX recording and strict live capture proof',
  nativeCapture:true,actualCapture:null,captureScope:'recording-capture',
 };
 return {proofKind:kind,phase:'Supplied Android proof; capture scope unknown',
  nativeCapture:null,actualCapture:null,captureScope:'unknown'};
}
