import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { seal, open, symmetricKey } from './envelope.mjs';

const root = process.env.PRIVATE_BUILD_ROOT;
if (!root || !/^[0-9a-f]{40}$/.test(process.env.EXPECTED_SOURCE_SHA || '')) throw Error('Invalid private build context');
const context = kind => ({ sourceSha: process.env.EXPECTED_SOURCE_SHA, kind });
if (process.argv[2] === 'decrypt') {
  const result = open(readFileSync(join(root, 'input.vzenc')), { key: symmetricKey(process.env.CAMERA_INPUT_KEY), expectedContext: context('camera-build-input') });
  writeFileSync(join(root, 'input.tar.gz'), result.bytes, { flag: 'wx', mode: 0o600 });
} else if (process.argv[2] === 'encrypt') {
  const bytes = seal(readFileSync(join(root, 'output.tar.gz')), context('camera-build-output'), { publicKey: readFileSync(join(root, 'recipient-public.pem')) });
  writeFileSync(join(root, 'result.vzenc'), bytes, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(root, 'result.sha256'), createHash('sha256').update(bytes).digest('hex') + '  result.vzenc\n');
} else {
  const source = join(root, 'source'), output = join(root, 'output');
  mkdirSync(output, { mode: 0o700 });
  const fd = openSync(join(output, 'build.log'), 'a', 0o600);
  // Private source/test subprocesses never receive the GitHub token or input key.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|PASSWORD|SECRET|AUTH|INPUT_KEY/.test(k)));
  let phase = 'identity', result;
  function run(command, args, label, cwd = source) {
    phase = label;
    const r = spawnSync(command, args, { cwd, env, stdio: ['ignore', fd, fd], timeout: 15 * 60000 });
    if (r.error || r.status !== 0) throw Error('Private build step failed');
    console.log(label + ' complete.');
  }
  try {
    const request = JSON.parse(readFileSync(join(root, 'request.json')));
    if (request.sourceSha !== process.env.EXPECTED_SOURCE_SHA || request.repository !== 'danielsinewe/verkehrs-zeugen-helfer') throw Error('Identity mismatch');
    run('go', ['test','-race','-tags','integration','./...'], 'Camera network and media integration', join(source, 'camera-cloud/tapo'));
    env.PYTHONPATH = join(source, 'camera-cloud/audio');
    run('python3', ['-m','unittest','discover','-s','camera-cloud/mipc-video','-p','test_*.py'], 'MIPC sampling and audio isolation');
    run('docker', ['build','--platform','linux/amd64','--file','camera-cloud/tapo/Dockerfile','--target','verification','--tag','subscription-tapo:verify','camera-cloud'], 'Tapo runtime verification image');
    run('docker', ['run','--rm','subscription-tapo:verify'], 'Actual unprivileged Tapo runtime');
    run('docker', ['build','--platform','linux/amd64','--file','camera-cloud/tapo/Dockerfile','--target','production','--tag','subscription-tapo:tested','camera-cloud'], 'Tapo production image');
    run('bash', ['-euo','pipefail','-c', `docker run --detach --name tapo-test --publish 127.0.0.1:8097:8097 --env 'TAPO_CONFIG={"apiToken":"ttttttttttttttttttttttttttttttttttttttttttt","cameraIp":"192.168.2.145","username":"fixture-user","password":"fixture-password","wireGuardConfig":"invalid fixture"}' subscription-tapo:tested
trap 'docker rm --force tapo-test' EXIT
for attempt in $(seq 1 30); do if curl --fail --silent http://127.0.0.1:8097/health; then break; fi; sleep 1; done
curl --fail --silent http://127.0.0.1:8097/health
test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8097/snapshot)" = 401
curl --silent --header 'Authorization: Bearer ttttttttttttttttttttttttttttttttttttttttttt' http://127.0.0.1:8097/snapshot | python3 -c 'import json,sys; assert json.load(sys.stdin)=={"error":"tapo_vpn_invalid"}'`], 'Private API and VPN error boundary');
    run('docker', ['build','--platform','linux/amd64','--file','camera-cloud/mipc-video/Dockerfile','--tag','subscription-mipc:tested','camera-cloud'], 'MIPC production image');
    run('docker', ['run','--rm','--entrypoint','python3','--volume',`${source}/camera-cloud/audio/test_traffic_audio.py:/app/test_traffic_audio.py:ro`,'subscription-mipc:tested','-m','unittest','discover','-s','/app','-p','test_traffic_audio.py'], 'Actual MIPC audio runtime');
    for (const [image, filename] of [['subscription-tapo:tested','tapo-receiver.tar.gz'],['subscription-mipc:tested','mipc-video.tar.gz']]) {
      run('bash', ['-euo','pipefail','-c',`docker save ${image} | gzip > "$PRIVATE_BUILD_ROOT/output/${filename}"`], 'Retain tested image');
    }
    result = { status: 'success', repository: request.repository, sourceSha: request.sourceSha, runId: process.env.GITHUB_RUN_ID, workflowSha: process.env.GITHUB_SHA,
      artifacts: ['tapo-receiver.tar.gz','mipc-video.tar.gz'].map(name => ({ name, sha256: createHash('sha256').update(readFileSync(join(output, name))).digest('hex') })), deployed: false };
  } catch {
    result = { status: 'failed', phase, sourceSha: process.env.EXPECTED_SOURCE_SHA };
    console.error(phase + ' failed; diagnostics stay encrypted.'); process.exitCode = 1;
  } finally {
    closeSync(fd); writeFileSync(join(output, 'camera-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  }
}
