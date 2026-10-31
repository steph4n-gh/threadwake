import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const resultsDir = path.join(root, '.test-results');
mkdirSync(resultsDir, { recursive: true });

const suites = [
  ['campaign-domain', process.execPath, ['campaign.test.mjs']],
  ['optical-domain', process.execPath, ['campaign-chambers.test.mjs']],
  ['chamber-integration', process.execPath, ['campaign-chamber-integration.test.mjs']],
  ['neural-echo', process.execPath, ['neural-echo.test.mjs']],
  ['record-matching', process.execPath, ['campaign-record-match.test.mjs']],
  ['audio-engine', process.execPath, ['audio-engine.test.mjs']],
  ['campaign-model-contract', 'python3', ['-B', 'campaign_mind_test.py']],
  ['worker-protocol', 'python3', ['-B', 'brain_contract_test.py']],
  ['host-contract', 'python3', ['-B', 'tests/test_host.py']],
  ['model-setup', 'python3', ['-B', 'tests/test_model_setup.py']],
  ['guard-contract', 'python3', ['-B', 'tests/test_guard.py']],
  ['probe-lifecycle', 'python3', ['-B', 'tests/test_native_probe.py']],
];
const results = [];
const startedAt = new Date().toISOString();

for (const [name, executable, args] of suites) {
  console.log(`Running ${name}...`);
  const started = Date.now();
  const child = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
  });
  const log = [child.stdout || '', child.stderr || '', child.error?.message || ''].filter(Boolean).join('\n');
  writeFileSync(path.join(resultsDir, `${name}.log`), log);
  const pass = child.status === 0 && !child.error;
  results.push({ name, args, pass, exit_code: child.status, signal: child.signal, elapsed_ms: Date.now() - started });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) process.stderr.write(log + '\n');
}

const pass = results.every(result => result.pass);
writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify({
  pass,
  started_at_utc: startedAt,
  finished_at_utc: new Date().toISOString(),
  scope: 'Self-contained authored CPU behavior and loopback contracts. No browser, model files, GPU, or historical player receipts.',
  suites: results,
}, null, 2) + '\n');
console.log(`${results.filter(result => result.pass).length}/${results.length} CPU suites passed. Logs: .test-results/`);
process.exitCode = pass ? 0 : 1;
