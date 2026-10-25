import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,existsSync,cpSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const root=process.env.PRIVATE_BUILD_ROOT;
if(!root)throw new Error('An isolated workspace is required.');
const platform=process.env.NATIVE_PLATFORM, mode=process.argv[2];
if(!['ios','android'].includes(platform)||!/^\d+$/.test(process.env.EXPECTED_BUILD??'')||!/^[a-f0-9]{40}$/.test(process.env.EXPECTED_SOURCE_SHA??''))throw new Error('Invalid verification selector.');
const context=kind=>({sourceSha:process.env.EXPECTED_SOURCE_SHA,build:process.env.EXPECTED_BUILD,platform,kind});
if(mode==='context-input'||mode==='context-output'){
 const kind=mode==='context-input'?'native-ui-input':'native-ui-output';
 writeFileSync(join(root,mode==='context-input'?'input-context.json':'output-context.json'),JSON.stringify(context(kind)),{mode:0o600});
 process.exit(0);
}
const request=JSON.parse(readFileSync(join(root,'request.json'),'utf8'));
if(request.sourceSha!==process.env.EXPECTED_SOURCE_SHA||request.build!==process.env.EXPECTED_BUILD||request.platform!==platform||!/^[a-f0-9]{40}$/.test(request.toolingSha??''))throw new Error('Authenticated request identity differs.');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
if(mode==='verify-input'){
 for(const [name,digest] of Object.entries(request.files)){
  if(name.startsWith('/')||name.split('/').includes('..')||hash(join(root,name))!==digest)throw new Error('Private package digest differs.');
 }
 mkdirSync(join(root,'output'),{recursive:true,mode:0o700});
 console.log('Verified authenticated native packages.');process.exit(0);
}
const output=join(root,'output');mkdirSync(output,{recursive:true,mode:0o700});
const logPath=join(output,'native-test.log'),fd=openSync(logPath,'a',0o600);
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/TOKEN|PASSWORD|SECRET|AUTH|INPUT_KEY|REVIEW_LOGIN/.test(key)));
let phase='initialization', simulator, status='failed';
function run(file,args,label,cwd=root,capture=false){
 phase=label;
 console.log(`Native verification phase: ${label}`);
 const r=spawnSync(file,args,{cwd,env,encoding:capture?'utf8':undefined,stdio:capture?['ignore','pipe','pipe']:['ignore',fd,fd]});
 if(r.error||r.status!==0)throw new Error('Native verification phase failed.');
 return capture?r.stdout.trim():undefined;
}
function gatherIos(){
 if(!simulator)return;
 try{
  const data=run('xcrun',['simctl','get_app_container',simulator,'app.verkehrszeuge.screenshot-tests.xctrunner','data'],'collect screens',root,true);
  const directory=join(data,'Documents/StoreScreenshots');
  if(existsSync(directory))cpSync(directory,join(output,'screens'),{recursive:true});
 }catch{}
}
try{
 if(platform==='ios'){
  Object.assign(env,{REVIEW_LOGIN_EMAIL:request.login.email,REVIEW_LOGIN_PASSWORD:request.login.password,HOMEBREW_NO_AUTO_UPDATE:'1'});
  run('brew',['install','xcodegen'],'prepare test tooling');
  simulator=run('xcrun',['simctl','create','Private Native Verification','com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'],'create simulator',root,true);
  if(!/^[A-F0-9-]{36}$/i.test(simulator))throw new Error('Unexpected simulator identity.');
  run('xcrun',['simctl','boot',simulator],'boot simulator');
  run('xcrun',['simctl','bootstatus',simulator,'-b'],'wait for simulator');
  run('xcrun',['simctl','status_bar',simulator,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100'],'set capture status');
  run('xcodebuild',['-project','source/ios/App/App.xcodeproj','-scheme','App','-configuration','Release','-destination',`platform=iOS Simulator,id=${simulator}`,'-derivedDataPath',join(root,'app-derived'),'CODE_SIGNING_ALLOWED=NO',`CURRENT_PROJECT_VERSION=${request.build}`,'build'],'compile exact native shell');
  const app=join(root,'app-derived/Build/Products/Release-iphonesimulator/App.app');
  run('python3',['-c',"import plistlib,sys; p=plistlib.load(open(sys.argv[1],'rb')); assert p['CFBundleIdentifier']=='app.verkehrszeuge' and p['CFBundleVersion']==sys.argv[2]",join(app,'Info.plist'),request.build],'verify compiled identity');
  run('xcrun',['simctl','install',simulator,app],'install simulator app');
  if(request.recordingFixtures){
   const fixtures=join(root,'fixtures/ios-recordings');
   const data=run('xcrun',['simctl','get_app_container',simulator,'app.verkehrszeuge','data'],'locate disposable recording storage',root,true);
   const destination=join(data,'Library/Application Support/evidence-recordings');
   const files=readdirSync(fixtures,{withFileTypes:true});
   if(files.length>8||!request.recordingFixtures.otherOwnerId||request.recordingFixtures.otherOwnerId===request.login.userId)throw new Error('Invalid synthetic recovery fixture selector.');
   mkdirSync(destination,{recursive:true,mode:0o700});
   for(const file of files){
    const relative=`fixtures/ios-recordings/${file.name}`;
    if(!file.isFile()||!/^[-a-f0-9]{36}\.(mov|json)$/.test(file.name)||!request.files[relative])throw new Error('Only authenticated synthetic recording files are allowed.');
    if(file.name.endsWith('.json')){
     const row=JSON.parse(readFileSync(join(fixtures,file.name),'utf8'));
     if(![request.login.userId,request.recordingFixtures.otherOwnerId].includes(row.ownerId))throw new Error('Fixture owner differs.');
    }
    cpSync(join(fixtures,file.name),join(destination,file.name));
   }
   env.NATIVE_RECORDING_RECOVERY_FIXTURE='1';
  }
  run('python3',['tooling/screenshots-project.py','--output',join(root,'test-project')],'prepare isolated UI runner');
  run('xcodegen',['generate','--spec',join(root,'test-project/project.json'),'--project',join(root,'test-project')],'generate UI project');
  run('xcodebuild',['-project',join(root,'test-project/StoreScreenshots.xcodeproj'),'-scheme','StoreScreenshots','-configuration','Release','-destination',`platform=iOS Simulator,id=${simulator}`,'-derivedDataPath',join(root,'test-derived'),'-parallel-testing-enabled','NO','CODE_SIGNING_ALLOWED=NO','-only-testing:StoreScreenshots/StoreScreenshots/testSignedInVideoJourney','test'],'native UI assertions');
  gatherIos();
  if(request.recordingFixtures){
   const data=run('xcrun',['simctl','get_app_container',simulator,'app.verkehrszeuge','data'],'audit acknowledged originals',root,true);
   const storage=join(data,'Library/Application Support/evidence-recordings');
   const rows=readdirSync(storage).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(readFileSync(join(storage,name),'utf8')));
   if(rows.some(row=>row.ownerId===request.login.userId)||rows.filter(row=>row.ownerId===request.recordingFixtures.otherOwnerId).length!==1)throw new Error('Durable acknowledgement or owner isolation failed.');
   writeFileSync(join(output,'recording-fixture-audit.json'),JSON.stringify({ownedOriginalsAfterHandoff:0,otherOwnerOriginalPreserved:true,syntheticMedia:true,physicalCameraTested:false},null,2));
  }
 }else{
  const serial='emulator-5554',adb=(args,label,capture=false)=>run('adb',['-s',serial,...args],label,root,capture);
  if(adb(['shell','getprop','ro.kernel.qemu'],'verify disposable emulator',true)!=='1')throw new Error('Only a disposable emulator is allowed.');
  adb(['install','-r',join(root,'application.apk')],'install native QA package');
  adb(['install','-r',join(root,'tests.apk')],'install isolated UI runner');
  const login=join(root,'qa-login.json');writeFileSync(login,JSON.stringify(request.login),{mode:0o600});
  adb(['push',login,'/data/local/tmp/native-qa-login.json'],'stage disposable account');
  adb(['shell','run-as','app.verkehrszeuge.qa','mkdir','-p','files'],'prepare account input');
  adb(['shell','run-as','app.verkehrszeuge.qa','cp','/data/local/tmp/native-qa-login.json','files/qa-login.json'],'copy account input');
  adb(['shell','rm','/data/local/tmp/native-qa-login.json'],'remove staged account');unlinkSync(login);
  adb(['shell','settings','put','secure','show_ime_with_hard_keyboard','1'],'enable real OS keyboard');
  adb(['shell','am','instrument','-w','-r','-e','class','app.verkehrszeuge.SignedInVideoJourneyTest','app.verkehrszeuge.qa.test/androidx.test.runner.AndroidJUnitRunner'],'native UI assertions');
  if(!/^OK \([0-9]+ tests?\)/m.test(readFileSync(logPath,'utf8')))throw new Error('Native assertions did not pass.');
  adb(['shell','am','force-stop','app.verkehrszeuge.qa'],'close app after durable upload');
 }
 status='success';
}catch{
 console.error(`Private native verification stopped in ${phase}; diagnostics remain encrypted.`);
 process.exitCode=1;
}finally{
 const failedPhase=phase;
 if(platform==='ios')gatherIos();
 else{
  try{run('adb',['-s','emulator-5554','pull','/sdcard/Android/data/app.verkehrszeuge.qa/files/native-journey/.',join(output,'screens')],'collect screens');}catch{}
 }
 closeSync(fd);
 let log=readFileSync(logPath,'utf8').replace(/Type '[^']*' into[^\n]*(?:SecureTextField|TextField)/g,'Type [redacted] into a native field');
 for(const secret of [request.login.email,request.login.password,request.login.userId])if(secret)log=log.split(secret).join('[disposable test login]');
 writeFileSync(logPath,log,{mode:0o600});
 if(status==='success'&&!existsSync(join(output,'screens/verified.json'))){status='failed';process.exitCode=1;}
 writeFileSync(join(output,'verification.json'),JSON.stringify({status,phase:failedPhase,...context('native-ui-result'),toolingSha:request.toolingSha,workflowSha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,simulatedDevice:true,nativeCapture:platform==='android',physicalDeviceCapture:false},null,2),{mode:0o600});
 console.log(`Native verification ${status}; only encrypted result files are retained.`);
}
