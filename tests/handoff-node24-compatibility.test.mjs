import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { ROOT, CASES, strictJson, canonicalJson, sha256, readBytes, checkedPath, safeRelative, loadLock } from '../src/handoff-v1.mjs';

const HISTORICAL = '375cc01bd2355fd13edf150a4eda5ab64ed0fab7a1af9aae31c2c09177cd4cbc';
const BASELINE = '69a7eefe10de26893ca5f58b6625c54edc36758a';
const SEMANTIC = '612f39689c90a2f6b4b47df30ecaf7e3c21a0058241c0e898d293f9f4c908bd1';
const COMMIT = '473f9cac98f6ed83446e46b692db77c76b9be524';
const PINS = {
  'docs/integration-contract.md': 'fa16c825f8ad244beb21b470c56876a20ac267520e67bb2a1766447724ab764a',
  'schemas/agent-run-receipt-v1.schema.json': '0535d3d2b748c1b2ef88a09164cd99570726d1b20dc8ad204e5bf02410148f8e',
  'schemas/cli-result-v1.schema.json': 'd7d2cf25f6464bc4862a4e542c5b9736734973c6d23116284d7941b05644f73b',
};
const CORE = ['agent-claim-check-usage', 'agent-claim-check', 'bazel-bep-artifact-created-adapter', 'browser-model', 'cases', 'classifier', 'repository', 'site'];
const NEW_INPUTS = ['docs/handoff-node24.md', 'tests/handoff-node24-compatibility.test.mjs'];
const fixture = path.join(ROOT, 'fixtures/handoff-v1');
const json = p => strictJson(readBytes(p));
const same = (a, b, message) => assert.equal(canonicalJson(a), canonicalJson(b), message);
function keys(value, names) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
}
function digest(value) { assert.equal(typeof value, 'string'); assert.match(value, /^[a-f0-9]{64}$/); return value; }
function inside(root, relative) {
  assert.ok(safeRelative(relative));
  const result = path.join(root, relative);
  assert.ok(result.startsWith(root + path.sep));
  return checkedPath(result);
}

// One ordered test prevents native work after any failed admission or offline check.
test('Node 24 frozen handoff compatibility, explicit offline or native-replay profile', () => {
  const started = performance.now();
  const profile = process.env.DAID_NODE24_PROFILE;
  assert.ok(['offline', 'native-replay'].includes(profile), 'explicit supported profile required');
  assert.ok(!('NODE_OPTIONS' in process.env) && !('NODE_PATH' in process.env));
  assert.ok(!process.env.DAID_FIXTURE_MODE, 'fixture generation is never supported');
  const executable = process.env.DAID_NODE_EXECUTABLE;
  assert.ok(executable && path.isAbsolute(executable), 'absolute selected Node executable required');
  checkedPath(executable);
  assert.equal(fs.realpathSync(executable), executable);
  assert.equal(process.execPath, executable);
  const local = process.platform === 'darwin' && process.arch === 'arm64' && process.versions.node === '24.19.0';
  const ci = process.platform === 'linux' && process.arch === 'x64' && process.versions.node === '24.21.0';
  assert.ok(local || ci, 'unsupported runtime tuple');
  assert.ok(profile !== 'native-replay' || local, 'native replay is local only');
  const runtime = { executable, sha256: sha256(fs.readFileSync(executable)), version: process.versions.node, platform: process.platform, arch: process.arch };
  function runtimeCheck() {
    checkedPath(executable);
    assert.equal(fs.realpathSync(executable), executable);
    assert.equal(sha256(fs.readFileSync(executable)), runtime.sha256, 'selected runtime changed');
  }
  assert.equal(process.env.DAID_LOCK_SHA256, HISTORICAL, 'explicit accepted historical digest required');
  const compatibilityDigest = digest(process.env.DAID_NODE24_LOCK_SHA256);
  assert.ok(process.env.DAID_NODE24_LOCK_PATH, 'explicit compatibility lock path required');
  const lockPath = checkedPath(path.resolve(process.env.DAID_NODE24_LOCK_PATH));
  assert.equal(lockPath, path.join(fixture, 'node24-compatibility-lock.json'));
  const lockBytes = readBytes(lockPath);
  assert.equal(sha256(lockBytes), compatibilityDigest, 'compatibility lock digest mismatch');
  const compatibility = strictJson(lockBytes);
  keys(compatibility, ['schema_version', 'public_baseline', 'semantic_sha256', 'historical', 'runtime', 'inputs']);
  assert.equal(compatibility.schema_version, 'daid_node24_compatibility_lock_v1');
  assert.equal(compatibility.public_baseline, BASELINE);
  assert.equal(compatibility.semantic_sha256, SEMANTIC);
  keys(compatibility.historical, ['path', 'sha256']);
  same(compatibility.historical, { path: 'fixtures/handoff-v1/execution-lock.json', sha256: HISTORICAL });
  keys(compatibility.runtime, ['local_node', 'ci_node']);
  same(compatibility.runtime, { local_node: '24.19.0', ci_node: '24.21.0' });
  assert.ok(Array.isArray(compatibility.inputs));
  assert.equal(compatibility.inputs.length, 2);
  same(compatibility.inputs.map(i => i.path), NEW_INPUTS);
  for (const input of compatibility.inputs) {
    keys(input, ['path', 'sha256']);
    assert.equal(sha256(readBytes(inside(ROOT, input.path))), digest(input.sha256));
  }
  const historicalPath = inside(ROOT, compatibility.historical.path);
  const historical = loadLock(historicalPath, HISTORICAL).lock;
  const inventory = fs.readdirSync(path.join(ROOT, 'tests')).filter(n => n.endsWith('.test.mjs')).sort();
  assert.deepEqual(inventory, [...CORE, 'handoff-v1', 'handoff-reproduction', 'handoff-node24-compatibility'].map(n => n + '.test.mjs').sort());
  for (const name of inventory) inside(ROOT, 'tests/' + name);
  let eg, python;
  if (profile === 'native-replay') {
    eg = process.env.DAID_EG_ROOT; python = process.env.DAID_PYTHON_EXECUTABLE;
    assert.ok(eg && path.isAbsolute(eg) && python && path.isAbsolute(python), 'native operator inputs required');
    checkedPath(eg, { directory: true });
    // The selected interpreter may be a normal versioned executable symlink.
    assert.ok(fs.statSync(python).isFile());
    assert.equal(historical.runtimes.python, '3.12.14');
  }

  const proof = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daid-node24-')));
  checkedPath(proof, { directory: true });
  assert.ok(proof !== ROOT && !proof.startsWith(ROOT + path.sep));
  if (eg) assert.ok(proof !== eg && !proof.startsWith(eg + path.sep));
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
  const receipt = { schema_version: 'daid_node24_compatibility_receipt_v1', profile, proof, runtime, historical_lock_sha256: HISTORICAL, compatibility_lock_sha256: compatibilityDigest, status: 'running', native_calls: 0, commands: [], reports: [], native: [] };
  const save = (name, value) => fs.writeFileSync(path.join(proof, name), canonicalJson(value));
  function command(exe, args, options = {}) {
    if (exe === executable) runtimeCheck();
    const t = performance.now();
    const r = spawnSync(exe, args, { env, timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options });
    receipt.commands.push({ order: receipt.commands.length + 1, executable: exe, args, exit: r.status, signal: r.signal, error: r.error?.message ?? null, elapsed_ms: performance.now() - t });
    if (exe === executable) runtimeCheck();
    return r;
  }
  function succeeded(r) { assert.ifError(r.error); assert.equal(r.status, 0, r.stderr?.toString()); return r.stdout.toString(); }
  function git(root, ...args) { return succeeded(command('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args])); }
  function capture(stem, r) {
    fs.writeFileSync(path.join(proof, stem + '.stdout'), r.stdout ?? Buffer.alloc(0));
    fs.writeFileSync(path.join(proof, stem + '.stderr'), r.stderr ?? Buffer.alloc(0));
    return { stdout_path: path.join(proof, stem + '.stdout'), stderr_path: path.join(proof, stem + '.stderr'), stdout_sha256: sha256(r.stdout ?? ''), stderr_sha256: sha256(r.stderr ?? ''), exit: r.status, command_index: receipt.commands.length - 1 };
  }
  let finalRepositoryState, expectedRepositoryState;
  try {
    const recipe = json(path.join(fixture, 'repository-recipe.json'));
    const repo = path.join(proof, 'repository'), revisions = {};
    succeeded(command('git', ['init', '--object-format=sha1', repo]));
    for (const commit of recipe.commits) {
      const entries = commit.files.map(file => {
        assert.ok(safeRelative(file.path)); assert.equal(file.mode, '100644');
        const blob = succeeded(command('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { input: file.text })).trim();
        return `${file.mode} blob ${blob}\t${file.path}\n`;
      });
      const tree = succeeded(command('git', ['-C', repo, 'mktree'], { input: entries.sort().join('') })).trim();
      const commitEnv = { ...env, GIT_AUTHOR_NAME: recipe.identity.name, GIT_AUTHOR_EMAIL: recipe.identity.email, GIT_COMMITTER_NAME: recipe.identity.name, GIT_COMMITTER_EMAIL: recipe.identity.email, GIT_AUTHOR_DATE: commit.timestamp, GIT_COMMITTER_DATE: commit.timestamp };
      revisions[commit.id] = succeeded(command('git', ['-c', 'commit.gpgsign=false', '-C', repo, 'commit-tree', tree, ...commit.parents.flatMap(id => ['-p', revisions[id]])], { env: commitEnv, input: commit.message + '\n' })).trim();
    }
    same(revisions, historical.repository_revisions);
    git(repo, 'checkout', '--detach', revisions.R1);
    save('repository-revisions.json', revisions);
    function state() {
      return { revision: git(repo, 'rev-parse', 'HEAD').trim(), status: git(repo, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored'), index_sha256: sha256(git(repo, 'ls-files', '--stage', '-z')), report_sha256: sha256(readBytes(path.join(repo, 'report.csv'))) };
    }
    const repositoryBefore = state(); assert.equal(repositoryBefore.status, '');
    finalRepositoryState = state; expectedRepositoryState = repositoryBefore;
    const childEnv = { ...env, DAID_PROOF: proof };
    // A fresh runner must not inherit the parent's internal test-child marker.
    delete childEnv.NODE_TEST_CONTEXT;
    const child = command(executable, ['--test', '--test-reporter=tap', 'tests/handoff-v1.test.mjs'], { cwd: ROOT, env: childEnv });
    receipt.focused = capture('focused', child);
    const tap = succeeded(child);
    for (const [key, value] of Object.entries({ tests: 21, pass: 21, fail: 0, skipped: 0, cancelled: 0 })) assert.match(tap, new RegExp(`^# ${key} ${value}$`, 'm'));
    assert.equal(child.stderr.length, 0);
    const reportDir = path.join(proof, 'reports'); fs.mkdirSync(reportDir);
    for (const c of CASES) {
      const expected = json(path.join(fixture, c, 'expected.json'));
      let canonicalReport;
      for (const format of ['json', 'markdown']) {
        let first;
        for (const repeat of [1, 2]) {
          const r = command(executable, ['tools/check-handoff.mjs', `fixtures/handoff-v1/${c}/packet.json`, '--execution-lock', 'fixtures/handoff-v1/execution-lock.json', '--execution-lock-sha256', HISTORICAL, '--format', format], { cwd: ROOT });
          receipt.reports.push({ case: c, format, repeat, ...capture(`reports/${c}.${format}.${repeat}`, r) });
          assert.ifError(r.error); assert.equal(r.status, c === 'invalid-source' ? 2 : 0); assert.equal(r.stderr.length, 0);
          if (first) assert.deepEqual(r.stdout, first); else first = r.stdout;
          if (format === 'json') {
            const report = strictJson(r.stdout);
            assert.equal(report.execution_lock_id, HISTORICAL);
            same(report.assessments.map(a => a.status === 'assessed' ? a.acc_receipt.finding : 'error-no-finding'), expected.findings);
            same(report.coverage.missing_check_ids, expected.missing_check_ids);
            for (const limitation of expected.limitations) assert.ok(report.native_context.limitations.includes(limitation));
            assert.equal(report.native_context.invocation.operation, 'verify');
            assert.equal(report.native_context.invocation.exit_status, expected.required_native_verify_exit);
            assert.equal(report.downstream_action_authorized, false); assert.equal(report.intent_assessment, 'not-assessed');
            assert.ok(report.sources.every(s => s.descriptor.origin.kind === 'synthetic'));
            if (c === 'missing-check') {
              assert.equal(report.coverage.expected_check_ids.length, 20); assert.equal(report.coverage.observed_check_ids.length, 18);
              same(report.coverage.missing_check_ids, ['c19', 'c20']); assert.equal(report.native_context.result.ok, true); assert.equal(report.native_context.receipt.checks.length, 18);
            }
            canonicalReport = canonicalJson(report);
          } else {
            const encoded = r.stdout.toString().match(/<pre>([\s\S]*)<\/pre>/); assert.ok(encoded);
            same(JSON.parse(encoded[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')), JSON.parse(canonicalReport));
          }
        }
      }
    }
    same(state(), repositoryBefore, 'offline checks changed repository');

    if (profile === 'native-replay') {
      const pythonReal = fs.realpathSync(python), pythonHash = sha256(fs.readFileSync(pythonReal));
      function pin() {
        runtimeCheck(); assert.equal(fs.realpathSync(python), pythonReal); assert.equal(sha256(fs.readFileSync(pythonReal)), pythonHash);
        assert.equal(succeeded(command(python, ['-I', '-S', '-B', '-c', 'import sys; print(sys.version.split()[0])'])).trim(), '3.12.14');
        checkedPath(eg, { directory: true }); assert.equal(git(eg, 'rev-parse', 'HEAD').trim(), COMMIT);
        assert.equal(git(eg, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored'), '');
        for (const name of git(eg, 'ls-tree', '-r', '--name-only', '-z', COMMIT).split('\0').filter(Boolean)) {
          const file = inside(eg, name), source = command('git', ['-C', eg, 'show', COMMIT + ':' + name]);
          succeeded(source); assert.deepEqual(readBytes(file), source.stdout, name);
        }
        for (const [name, hash] of Object.entries(PINS)) assert.equal(sha256(readBytes(inside(eg, name))), hash);
        assert.equal(succeeded(command(python, ['-I', '-S', '-B', '-c', 'import sys,tomllib; print(tomllib.load(open(sys.argv[1],"rb"))["project"]["version"])', path.join(eg, 'pyproject.toml')])).trim(), '0.1.0');
        return { commit: COMMIT, evidencegate_py_blob: git(eg, 'rev-parse', COMMIT + ':evidencegate.py').trim(), evidencegate_py_sha256: sha256(readBytes(path.join(eg, 'evidencegate.py'))), pyproject_sha256: sha256(readBytes(path.join(eg, 'pyproject.toml'))), python_path: python, python_resolved_path: pythonReal, python_sha256: pythonHash, python_version: '3.12.14', tool_version: '0.1.0' };
      }
      const launch = 'import runpy,sys; root=sys.argv[1]; sys.path.insert(0,root); sys.argv=[root+"/evidencegate.py"]+sys.argv[2:]; runpy.run_path(sys.argv[0],run_name="__main__")';
      for (const c of CASES) {
        const caseDir = path.join(proof, c); fs.mkdirSync(caseDir);
        const original = inside(ROOT, `fixtures/handoff-v1/${c}/receipt.json`), bytes = readBytes(original);
        assert.equal(sha256(bytes), historical.inputs.find(i => i.path === `fixtures/handoff-v1/${c}/receipt.json`).sha256);
        const selected = path.join(caseDir, 'receipt.json'); fs.writeFileSync(selected, bytes, { flag: 'wx' });
        for (const operation of ['validate', 'verify']) {
          const sourceBefore = pin(), before = state(); same(before, repositoryBefore);
          assert.deepEqual(readBytes(selected), bytes); assert.ok(receipt.native_calls < 10);
          const args = ['-I', '-S', '-B', '-c', launch, eg, operation, selected, ...(operation === 'verify' ? ['--repo', repo] : []), '--format', 'json'];
          const capturedAt = new Date().toISOString();
          receipt.native_calls++; save('compatibility-receipt.json', receipt);
          const r = command(python, args);
          const row = { case: c, operation, captured_at: capturedAt, ...capture(`${c}/${operation}`, r), command: [python, ...args], runtime, source_before: sourceBefore, repository_before: before, receipt_sha256: sha256(bytes) };
          receipt.native.push(row); save('compatibility-receipt.json', receipt);
          row.repository_after = state(); row.source_after = pin();
          same(row.repository_after, before); same(row.source_after, sourceBefore); assert.deepEqual(readBytes(selected), bytes);
          fs.writeFileSync(path.join(caseDir, operation + '.invocation.json'), canonicalJson(row), { flag: 'wx' });
          assert.ifError(r.error); assert.equal(r.stderr.length, 0);
          const exit = c === 'invalid-source' ? 2 : c === 'wrong-revision' && operation === 'verify' ? 1 : 0;
          assert.equal(r.status, exit);
          const value = strictJson(r.stdout);
          assert.equal(value.operation, operation); assert.equal(value.ok, exit === 0);
          same(value.findings.map(f => f.code), c === 'invalid-source' ? ['packet_load_error'] : c === 'wrong-revision' && operation === 'verify' ? ['repository_revision_mismatch'] : []);
          if (operation === 'verify') assert.deepEqual(r.stdout, readBytes(path.join(fixture, c, 'result.json')));
        }
      }
    }
    assert.equal(receipt.native_calls, profile === 'offline' ? 0 : 10);
    same(state(), repositoryBefore);
    receipt.status = 'pass';
  } catch (error) {
    receipt.status = 'fail'; receipt.error = error.stack ?? String(error); throw error;
  } finally {
    try {
      runtimeCheck(); loadLock(historicalPath, HISTORICAL);
      assert.deepEqual(readBytes(lockPath), lockBytes);
      for (const input of compatibility.inputs) assert.equal(sha256(readBytes(inside(ROOT, input.path))), input.sha256);
      if (finalRepositoryState) same(finalRepositoryState(), expectedRepositoryState);
      receipt.preservation = 'runtime, repository and both locks/all bound inputs unchanged';
    } catch (error) {
      receipt.status = 'fail'; receipt.preservation_error = error.stack ?? String(error); throw error;
    } finally {
      receipt.elapsed_ms = performance.now() - started; save('compatibility-receipt.json', receipt);
      console.log(`Retained compatibility receipt: ${path.join(proof, 'compatibility-receipt.json')}`);
    }
  }
});
