import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.env.PRIVATE_BUILD_ROOT;
if (!root) throw new Error('Private build root is required.');
const source = join(root, 'source'), output = join(root, 'output');
mkdirSync(output, { recursive: true, mode: 0o700 });
const fd = openSync(join(output, 'build.log'), 'a', 0o600);
let phase = 'request';
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/TOKEN|PASSWORD|SECRET|AUTH|VZ_INPUT_KEY/.test(name)));
function run(command, args, label, cwd = source) {
  phase = label;
  const result = spawnSync(command, args, { cwd, env, stdio: ['ignore', fd, fd] });
  if (result.error || result.status !== 0) throw new Error('Build phase failed.');
  console.log(`${label} complete.`);
}
let result;
try {
  const request = JSON.parse(readFileSync(join(root, 'request.json'), 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(request.sourceSha) || !/^[1-9][0-9]{0,8}$/.test(request.build) ||
      request.sourceSha !== process.env.EXPECTED_SOURCE_SHA || request.build !== process.env.EXPECTED_BUILD ||
      request.backend.projectId !== 'qrdgyonmrznmrauyiesn' ||
      request.backend.url !== 'https://qrdgyonmrznmrauyiesn.supabase.co' ||
      !request.backend.publishableKey.startsWith('sb_publishable_')) throw new Error('Invalid request identity.');
  Object.assign(env, { VITE_SUPABASE_PROJECT_ID: request.backend.projectId,
    VITE_SUPABASE_URL: request.backend.url, VITE_SUPABASE_PUBLISHABLE_KEY: request.backend.publishableKey });
  run('xcodebuild', ['-version'], 'Apple toolchain');
  run('npm', ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'], 'Dependency installation');
  run('python3', ['-m', 'unittest', 'discover', '-s', 'scripts/ios-release', '-p', 'test_*.py'], 'iPhone release tests');
  run('swiftc', ['ios/App/App/EvidenceRecordingStore.swift', 'scripts/ios-release/recording-recovery-tests.swift', '-o', join(root, 'recording-recovery-tests')], 'Compile production recovery checks');
  run(join(root, 'recording-recovery-tests'), [join(root, 'recording-recovery')], 'Real movie recovery checks');
  copyFileSync(join(root, 'recording-recovery/recording-recovery-verification.json'), join(output, 'recording-recovery-verification.json'));
  run('npm', ['run', 'typecheck'], 'Typecheck');
  run('npx', ['vitest', 'run', 'tests/ios-capture-permissions.test.ts', 'tests/ios-recording-recovery.test.ts', 'tests/native-evidence-capture.test.ts', 'tests/capture-back-navigation.test.tsx', 'tests/native-platform.test.ts', 'tests/native-cors.test.ts', 'tests/native-cors.server.test.ts'], 'iPhone routing regressions');
  run('npm', ['run', 'build:native'], 'Native interface build');
  run('npx', ['cap', 'sync', 'ios'], 'iOS synchronization');
  phase = 'packaged backend verification';
  const assets = join(source, 'ios/App/App/public/assets');
  const js = readdirSync(assets).filter(name => name.endsWith('.js')).map(name => readFileSync(join(assets, name), 'utf8')).join('\n');
  if (!js.includes(request.backend.url) || !js.includes(request.backend.publishableKey)) throw new Error('Packaged backend identity mismatch.');
  const archive = join(output, 'Verkehrszeuge.xcarchive');
  run('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', archive,
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', `CURRENT_PROJECT_VERSION=${request.build}`, 'archive'], 'Device archive compilation');
  for (const path of ['Products/Applications/App.app/PrivacyInfo.xcprivacy', 'Products/Applications/App.app/public/index.html'])
    if (!existsSync(join(archive, path))) throw new Error('Device archive incomplete.');
  run('python3', ['-c', "import plistlib,sys; p=plistlib.load(open(sys.argv[1],'rb')); assert p['ApplicationProperties']['CFBundleIdentifier']=='app.verkehrszeuge'", join(archive, 'Info.plist')], 'Archive identity');
  writeFileSync(join(archive, 'source-sha.txt'), request.sourceSha + '\n');
  copyFileSync(join(source, 'ios/App/App/App.entitlements'), join(archive, 'required-entitlements.plist'));
  result = { status: 'success', sourceSha: request.sourceSha, build: request.build, version: '1.0',
    bundleId: 'app.verkehrszeuge', signing: 'pending-private-cloud', workflowSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, assetCount: readdirSync(assets).length };
  phase = 'complete';
} catch {
  result = { status: 'failed', phase, sourceSha: process.env.EXPECTED_SOURCE_SHA, build: process.env.EXPECTED_BUILD };
  console.error(`${phase} failed; diagnostics will be encrypted for the private cloud recipient.`);
  process.exitCode = 1;
} finally {
  closeSync(fd);
  writeFileSync(join(output, 'build-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
}
