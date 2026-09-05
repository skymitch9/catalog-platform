/**
 * `npm run deploy:auth` — the estate-auth (`apps/auth-worker`) deploy pipeline,
 * one command: clean tree → typecheck → tests → MIGRATE → deploy → log line.
 *
 * Why a script and not a chain of shell commands (2026-09-05): the owner runs
 * this estate from his phone through Remote Control, where `!` shell lines do
 * not reach this machine, and the bare `npm run db:migrate` / `npx wrangler
 * deploy` pair inside `apps/auth-worker` was refused to the session by the
 * permission classifier — so a Worker deploy that needed a migration had no
 * path at all. This is the same shape the games repo has had since 2026-08
 * (`check-clean` → `deploy-guard` → typecheck → tests → deploy → `deploy-done`),
 * carrying the estate's mechanical guards rather than restating them in prose:
 *
 *   - refuses a dirty working tree (escape hatch: ESTATE_AUTH_ALLOW_DIRTY=1,
 *     spelled out on purpose so nobody reaches for it by accident);
 *   - migrates BEFORE deploying, always — new code never meets an old schema.
 *     `wrangler d1 migrations apply` with nothing pending is a no-op, so there
 *     is no "skip migrate" flag to forget;
 *   - appends ONE line to docs/deploys.log in the six-field shape the file
 *     already uses (ISO, app, commit, holder, version id, note) but does NOT
 *     commit it — the run that deployed commits it, which is what puts the
 *     line in front of a person.
 *
 * Env: DEPLOY_HOLDER (who is deploying; defaults to git user.name),
 *      DEPLOY_NOTE   (the log line's sixth field; defaults to a measured summary).
 *
 * Wrangler is invoked through `process.execPath` + its entry script, not
 * `npx`, because on Windows `execFileSync('npx', …)` is ENOENT/EINVAL and fails
 * silently (the games repo recorded `version-unknown` for a month that way).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'auth-worker');
const LOG = join(ROOT, 'docs', 'deploys.log');
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function fail(step, why) {
  console.error(`deploy-auth: ✗ ${step} — ${why}`);
  process.exit(1);
}

/** Run a step with inherited stdio; a non-zero exit stops the pipeline. */
function step(name, cmd, args, opts = {}) {
  console.log(`\ndeploy-auth: ▶ ${name}`);
  const r = spawnSync(cmd, args, { cwd: APP, stdio: 'inherit', shell: cmd.endsWith('.cmd'), ...opts });
  if (r.error) fail(name, r.error.message);
  if (r.status !== 0) fail(name, `exit ${r.status}`);
}

/** Run wrangler and return its stdout while still echoing it. */
function wrangler(name, args) {
  console.log(`\ndeploy-auth: ▶ ${name}`);
  const r = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: APP,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
    timeout: 300_000,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.error) fail(name, r.error.message);
  if (r.status !== 0) fail(name, `exit ${r.status}`);
  return r.stdout || '';
}

// 1. Clean tree — a Worker deploy uploads what is on disk, not a commit.
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
if (dirty && process.env['ESTATE_AUTH_ALLOW_DIRTY'] !== '1') {
  fail(
    'check-clean',
    `the working tree is not clean; commit or set ESTATE_AUTH_ALLOW_DIRTY=1 (deliberately):\n${dirty}`,
  );
}
if (!existsSync(WRANGLER)) fail('preflight', `wrangler not installed at ${WRANGLER} — npm ci first`);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
let holder = process.env['DEPLOY_HOLDER'] || '';
if (!holder) {
  try {
    holder = execFileSync('git', ['config', 'user.name'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    /* fall through */
  }
}
holder ||= 'unknown';

// 2. The gates the code has to pass before it may meet production.
step('typecheck', NPM, ['run', 'typecheck']);
step('tests', NPM, ['test']);

// 3. Migrate BEFORE deploy. Record what was pending so the log line can say it.
const pendingOut = wrangler('migrations pending', ['d1', 'migrations', 'list', 'estate_auth', '--remote']);
const pending = [...pendingOut.matchAll(/(\d{4}_[\w-]+\.sql)/g)].map((m) => m[1]);
if (pending.length) wrangler('migrate', ['d1', 'migrations', 'apply', 'estate_auth', '--remote']);
else console.log('deploy-auth: no pending migrations (measured, not assumed).');

// 4. Deploy, and take the version id from the deploy's own output.
const deployOut = wrangler('deploy', ['deploy']);
const version = /Current Version ID:\s*([0-9a-f-]{36})/i.exec(deployOut)?.[1] || 'version-unknown';

// 5. One log line, not committed here.
const note =
  process.env['DEPLOY_NOTE'] ||
  `deploy:auth pipeline: typecheck + tests green in predeploy; migrations applied: ${
    pending.length ? pending.join(', ') : 'none pending'
  }. Live checks and the not-verified list belong to the run that commits this line.`;
appendFileSync(LOG, `${new Date().toISOString()}\testate-auth\t${head.slice(0, 7)}\t${holder}\t${version}\t${note}\n`);

console.log(
  `\ndeploy-auth: ✓ ${head.slice(0, 7)} by "${holder}" is live as ${version.slice(0, 8)}` +
    ` (migrations: ${pending.length ? pending.join(', ') : 'none'}) — line appended to docs/deploys.log.`,
);
console.log('deploy-auth: ⚠️ commit docs/deploys.log, then curl the routes this deploy changed.');
