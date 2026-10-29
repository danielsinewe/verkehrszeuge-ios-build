import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { seal, open, symmetricKey } from './envelope.mjs';
import {selectReviewedWorkflow} from './reviewed-workflows.mjs';

process.umask(0o077);
const root = process.env.PRIVATE_BUILD_ROOT;
const jobId = process.env.EXPECTED_JOB_ID, sourceSha = process.env.EXPECTED_SOURCE_SHA;
const catalog = JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url)));
let job = catalog[jobId];
if (!root || !job || !/^danielsinewe\//.test(job.repo) || !/^[0-9a-f]{40}$/.test(sourceSha || '')) throw Error('Invalid private job identity');
const context = kind => ({ sourceSha, jobId, kind: 'quality-build-' + kind });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv[2] === 'decrypt') {
  const result = open(fs.readFileSync(path.join(root, 'input.vzenc')), { key: symmetricKey(process.env.QUALITY_INPUT_KEY), expectedContext: context('input') });
  fs.writeFileSync(path.join(root, 'input.tar.gz'), result.bytes, { flag: 'wx', mode: 0o600 });
} else if (process.argv[2] === 'encrypt') {
  const output = seal(fs.readFileSync(path.join(root, 'output.tar.gz')), context('output'), { publicKey: fs.readFileSync(path.join(root, 'recipient-public.pem')) });
  fs.writeFileSync(path.join(root, 'result.vzenc'), output, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(root, 'result.sha256'), hash(output) + '  result.vzenc\n');
} else {
  const source = path.join(root, 'source'), output = path.join(root, 'output');
  fs.mkdirSync(output, { mode: 0o700 });
  const logPath = path.join(output, 'build.log'), fd = fs.openSync(logPath, 'a', 0o600);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/TOKEN|PASSWORD|SECRET|AUTH|INPUT_KEY|API_KEY|PRIVATE_KEY/.test(key)));
  Object.assign(env, job.env || {}, { CI: 'true', NEXT_TELEMETRY_DISABLED: '1' });
  if (jobId === 'camera-native') env.PYTHONPATH = path.join(source, 'camera-cloud/audio');
  const results = []; let phase = 'identity', result, period;
  try {
    const request = JSON.parse(fs.readFileSync(path.join(root, 'request.json')));
    job=selectReviewedWorkflow(job,request.workflowHash);
    period = request.period;
    if (request.sourceSha !== sourceSha || request.repository !== job.repo || request.jobId !== jobId ||
        !/^(commit|\d{4}-\d{2}-\d{2})$/.test(period || '') ||
        request.workflowHash !== job.workflow_hash || !isDeepStrictEqual(request.steps, job.steps) ||
        hash(fs.readFileSync(path.join(source, job.workflow))) !== job.workflow_hash) throw Error('Request identity mismatch');
    for (const [index, step] of job.steps.entries()) {
      phase = 'step-' + (index + 1);
      const child = spawnSync(step.argv[0], step.argv.slice(1), { cwd: source, env, stdio: ['ignore', fd, fd], timeout: 20 * 60000 });
      const passed = !child.error && child.status === 0;
      results.push({ argv: step.argv, result: passed ? 'success' : step.continue_on_error ? 'warning' : 'failure', exitCode: child.status });
      if (!passed && !step.continue_on_error) throw Error('Private build phase failed');
      console.log('Private verification ' + phase + ' complete.');
    }
    result = { status: 'success', repository: job.repo, sourceSha, jobId, period, workflowHash: job.workflow_hash, results,
      runId: process.env.GITHUB_RUN_ID, workflowSha: process.env.GITHUB_SHA };
  } catch {
    result = { status: 'failure', repository: job.repo, sourceSha, jobId, period, workflowHash: job.workflow_hash, phase, results,
      runId: process.env.GITHUB_RUN_ID, workflowSha: process.env.GITHUB_SHA };
    console.error('Private verification failed; diagnostics are encrypted.'); process.exitCode = 1;
  } finally {
    fs.closeSync(fd);
    // Retain useful bounded diagnostics without publishing them to the public job log.
    const stat = fs.statSync(logPath);
    if (stat.size > 8 * 1024 * 1024) {
      const data = fs.readFileSync(logPath); fs.writeFileSync(logPath, Buffer.concat([data.subarray(0, 4 * 1024 * 1024), Buffer.from('\n[log truncated]\n'), data.subarray(-4 * 1024 * 1024)]));
    }
    fs.writeFileSync(path.join(output, 'quality-result.json'), JSON.stringify(result, null, 2) + '\n');
  }
}
