import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, chmodSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { seal, open } from './envelope.mjs';

const harness = 'danielsinewe/verkehrszeuge-ios-build';
const application = 'danielsinewe/verkehrs-zeugen-helfer';
function command(file, args, { cwd, input, output } = {}) {
  const result = spawnSync(file, args, { cwd, input, encoding: output ? undefined : 'utf8',
    stdio: output ? ['ignore', output, 'pipe'] : ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error(`${file} request step failed; inspect protected local state before retrying.`);
  return result.stdout?.toString().trim();
}
try {
  const [repository, sourceSha, build, recipientPath, directory] = process.argv.slice(2);
  if (!repository || !/^[a-f0-9]{40}$/.test(sourceSha) || !/^[1-9][0-9]{0,8}$/.test(build) || !recipientPath || !directory)
    throw new Error('Usage: node request.mjs REPOSITORY PUBLISHED_MAIN_SHA BUILD RECIPIENT_PUBLIC_PEM PRIVATE_OUTPUT_DIRECTORY');
  const root = resolve(directory), repo = resolve(repository);
  if (existsSync(root)) throw new Error('Request output already exists; preserve and inspect it before retrying.');
  const recipient = readFileSync(recipientPath, 'utf8'), recipientKey = createPublicKey(recipient);
  if (recipientKey.asymmetricKeyType !== 'rsa' || recipientKey.asymmetricKeyDetails.modulusLength < 3072)
    throw new Error('A private-cloud RSA recipient of at least 3072 bits is required.');
  command('git', ['fetch', 'origin', 'main'], { cwd: repo });
  if (command('git', ['rev-parse', 'origin/main'], { cwd: repo }) !== sourceSha)
    throw new Error('Source is no longer the latest published main; inspect concurrent changes.');
  const remote = command('git', ['config', '--get', 'remote.origin.url'], { cwd: repo });
  if (!remote.endsWith(`${application}.git`) && !remote.endsWith(application)) throw new Error('Unexpected application repository.');
  const runs = JSON.parse(command('gh', ['run', 'list', '--repo', harness, '--workflow', 'encrypted-build.yml', '--limit', '20', '--json', 'status']));
  if (runs.some(run => run.status !== 'completed')) throw new Error('Another encrypted build is pending; preserve its key.');
  mkdirSync(root, { recursive: true, mode: 0o700 }); chmodSync(root, 0o700);
  const value = name => command('gh', ['variable', 'get', name, '--repo', application]);
  const backend = { projectId: value('VITE_SUPABASE_PROJECT_ID'), url: value('VITE_SUPABASE_URL'), publishableKey: value('VITE_SUPABASE_PUBLISHABLE_KEY') };
  if (backend.projectId !== 'qrdgyonmrznmrauyiesn' || backend.url !== 'https://qrdgyonmrznmrauyiesn.supabase.co' || !backend.publishableKey.startsWith('sb_publishable_'))
    throw new Error('Public production backend configuration is incomplete.');
  const request = { schemaVersion: 1, sourceSha, build, backend };
  writeFileSync(join(root, 'request.json'), JSON.stringify(request), { mode: 0o600 });
  writeFileSync(join(root, 'recipient-public.pem'), recipient, { mode: 0o600 });
  command('git', ['archive', '--format=tar', '--prefix=source/', '--output', join(root, 'input.tar'), sourceSha], { cwd: repo });
  chmodSync(join(root, 'input.tar'), 0o600);
  command('tar', ['-rf', join(root, 'input.tar'), '-C', root, 'request.json', 'recipient-public.pem']);
  const gzip = openSync(join(root, 'input.tar.gz'), 'wx', 0o600);
  try { command('gzip', ['-c', join(root, 'input.tar')], { output: gzip }); } finally { closeSync(gzip); }
  const plain = readFileSync(join(root, 'input.tar.gz')), key = randomBytes(32);
  const context = { sourceSha, build, kind: 'ios-build-input' };
  const encrypted = seal(plain, context, { key });
  if (!open(encrypted, { key, expectedContext: context }).bytes.equals(plain)) throw new Error('Input encryption roundtrip failed.');
  writeFileSync(join(root, 'input.vzenc'), encrypted, { mode: 0o600 });
  writeFileSync(join(root, 'input-key.base64'), key.toString('base64') + '\n', { mode: 0o600 });
  const tag = `ios-${sourceSha.slice(0, 12)}-${build}-${randomBytes(6).toString('hex')}`;
  const workflowSha = JSON.parse(command('gh', ['api', `repos/${harness}/commits/main`])).sha;
  const receipt = { sourceSha, build, harness, workflowSha, tag,
    inputSha256: createHash('sha256').update(encrypted).digest('hex'),
    recipientSha256: createHash('sha256').update(recipientKey.export({type:'spki',format:'der'})).digest('hex'),
    createdAt: new Date().toISOString(), state: 'encrypted' };
  const save = () => writeFileSync(join(root, 'request-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  save();
  command('gh', ['release', 'create', tag, join(root, 'input.vzenc'), '--repo', harness, '--target', workflowSha,
    '--prerelease', '--title', `Encrypted iPhone build ${build}`, '--notes', `Authenticated encrypted build request for ${sourceSha}. No plaintext source, signing credentials or logs are published.`]);
  receipt.state = 'encrypted-input-published'; save();
  command('gh', ['secret', 'set', 'VZ_INPUT_KEY', '--repo', harness], { input: key.toString('base64') });
  receipt.state = 'input-key-staged'; save();
  command('gh', ['workflow', 'run', 'encrypted-build.yml', '--repo', harness, '--ref', 'main', '--json'],
    { input: JSON.stringify({ payload_tag: tag, source_sha: sourceSha, build_number: build }) });
  receipt.state = 'dispatched'; save();
  key.fill(0); plain.fill(0);
  unlinkSync(join(root, 'input.tar')); unlinkSync(join(root, 'input.tar.gz'));
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
