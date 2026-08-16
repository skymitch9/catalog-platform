#!/usr/bin/env node
/**
 * predeploy-check — the mechanical guard on heygabi.ai's front door.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A DEV LANE (ruling 2026-08-16).
 * The question on the table was whether to give the apex a /dev/ lane like
 * audiobook_catalog's. Ruled no, for three reasons worth keeping written
 * down, because the ruling will look wrong to someone who only remembers
 * that two lanes are "safer":
 *
 *   1. A dev lane's value scales with the cost of a bad deploy. On audiobook
 *      that cost is high — prod is the family-facing catalog behind an audit
 *      guard. On the apex it is one redeploy: Pages keeps every deployment
 *      and rolls back in about a minute.
 *   2. A preview host (<hash>.heygabi-home.pages.dev) is NOT a Firebase
 *      authorised domain, so sign-in cannot run there. A lane would inspect
 *      the static half of this site while the genuinely complex half —
 *      Operations on /status, the runbook pages, /admin — stayed invisible.
 *      Adding a stable authorised dev host means a permanent extra OAuth
 *      redirect surface, which sites/heygabi-home/deploy.md argues against.
 *   3. A lane only pays out if a human looks at it. The failures that
 *      actually shipped here were not "a bad deploy" — they were "nobody
 *      looked": an unlabeled section, a pointer aimed the wrong way. A step
 *      that depends on someone looking cannot fix a problem caused by
 *      someone not looking; it becomes ceremony, and skipped ceremony rots
 *      into a lane nobody trusts.
 *
 * So instead: a guard that runs every time, needs no one to remember it, and
 * catches the one class a preview would only catch by luck — a syntax error
 * in a public .js file silently white-screening a page. `curl /` returns 200
 * on a page whose script died at parse time; only parsing catches that.
 * (Global rule: "mechanical guards beat written advice", and "verify with the
 * right instrument — a 200 on the root route proves nothing about a
 * white-screening bundle".)
 *
 * WHAT IT CHECKS
 *   static (default)          JS parses · HTML structurally sound · tree clean
 *   --live [baseUrl]          after deploying: the real URLs serve the real strings
 *
 * The live phase is the half that closes "shipped ≠ verified". Its
 * expectations live in sites/heygabi-home/predeploy.checks.json — a page
 * whose marker is missing is a page that deployed but did not land.
 *
 * ESCAPE HATCH, deliberately awkward (global rule: an explicit env var, never
 * an easy flag): ALLOW_DIRTY_DEPLOY=1 skips the clean-tree assertion. It
 * exists for a genuine emergency and nothing else — the assertion is there
 * because `wrangler pages deploy <dir>` uploads the WORKING TREE, not a
 * commit, and on 2026-08-15 that swept another agent's half-built refactor
 * onto the live front door.
 *
 * Usage:
 *   node scripts/predeploy-check.mjs                    # static checks
 *   node scripts/predeploy-check.mjs --live             # live checks (baseUrl from config)
 *   node scripts/predeploy-check.mjs --live https://... # live checks against another host
 *   npm run check:home / npm run verify:home / npm run deploy:home
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(REPO, 'sites', 'heygabi-home');
const PUBLIC_DIR = join(SITE, 'public');
const CONFIG = join(SITE, 'predeploy.checks.json');

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const BASE_OVERRIDE = argv.find((a) => a.startsWith('http'));

const problems = [];
const fail = (where, msg) => problems.push({ where, msg });

/* ── file walking ──────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f) => relative(REPO, f).split('\\').join('/');

/* ── 1. JavaScript actually parses ─────────────────────────────────────── */

/**
 * `node --check` resolves module type from the nearest package.json, and the
 * repo root is {"type":"module"} — so a .js file here is parsed as ESM. A
 * classic script (assets/theme.js is deliberately one, so it can stamp the
 * theme before first paint) normally parses fine as ESM too, but ESM implies
 * strict mode, and a handful of legal-in-sloppy-mode constructs (octal
 * literals, `with`) would be rejected. So a failure is retried as CommonJS
 * via a .cjs copy, and only a file that fails BOTH is reported. The goal is
 * catching real syntax errors with zero false alarms — a check that cries
 * wolf gets disabled, which is worse than not having it.
 */
function checkJavaScript(files) {
  const js = files.filter((f) => ['.js', '.mjs', '.cjs'].includes(extname(f)));
  let scratch = null;
  for (const file of js) {
    if (tryParse(file)) continue;
    // Keep the FIRST error. The CommonJS retry is only a false-positive
    // guard, and its failure text is about module type ("Failed to load the
    // ES module… set type: module"), which buries the actual syntax error
    // the developer needs to see.
    const realError = lastError;
    scratch ??= mkdtempSync(join(tmpdir(), 'predeploy-'));
    const asCjs = join(scratch, 'retry.cjs');
    copyFileSync(file, asCjs);
    if (tryParse(asCjs)) continue;
    fail(rel(file), `does not parse:\n${realError.trim().split('\n').map((l) => `      ${l}`).join('\n')}`);
  }
  return js.length;
}

let lastError = '';
function tryParse(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return true;
  } catch (err) {
    lastError = String(err.stderr || err.message)
      .split('\n')
      .filter((l) => l && !l.includes('node:internal'))
      .slice(0, 6)
      .join('\n');
    return false;
  }
}

/* ── 2. HTML is structurally sound ─────────────────────────────────────── */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Content is text, not markup — skip to the close tag without parsing inside. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
/**
 * Elements whose end tag HTML makes optional. Omitting `</li>` or `</p>` is
 * legal and common, so an unclosed one is never reported — otherwise this
 * check would flag correct markup, and see the note above about crying wolf.
 */
const OPTIONAL_END = new Set(['p', 'li', 'td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'option', 'dt', 'dd']);

const lineAt = (src, index) => src.slice(0, index).split('\n').length;

function checkHtml(src) {
  const found = [];
  const stack = [];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end === -1) { found.push(`line ${lineAt(src, lt)}: unterminated <!-- comment`); break; }
      i = end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(lt, lt + 120));
    if (!m) { i = lt + 1; continue; }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();

    // Walk to '>' honouring quoted attribute values, so a '>' inside an
    // attribute (common in inline SVG data URIs) does not end the tag early.
    let j = lt + m[0].length;
    let quote = null;
    while (j < src.length) {
      const c = src[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j++;
    }
    if (j >= src.length) { found.push(`line ${lineAt(src, lt)}: unterminated <${name}> tag`); break; }
    const selfClosing = src[j - 1] === '/';
    i = j + 1;

    if (closing) {
      while (stack.length && stack.at(-1).name !== name && OPTIONAL_END.has(stack.at(-1).name)) stack.pop();
      if (!stack.length) {
        found.push(`line ${lineAt(src, lt)}: </${name}> closes nothing`);
      } else if (stack.at(-1).name !== name) {
        const open = stack.at(-1);
        found.push(`line ${lineAt(src, lt)}: </${name}> closes <${open.name}> opened at line ${open.line}`);
        const depth = stack.map((f) => f.name).lastIndexOf(name);
        if (depth !== -1) stack.length = depth;
      } else {
        stack.pop();
      }
      continue;
    }

    if (VOID.has(name) || selfClosing) continue;

    if (RAW_TEXT.has(name)) {
      const close = new RegExp(`</\\s*${name}\\s*>`, 'i').exec(src.slice(i));
      if (!close) { found.push(`line ${lineAt(src, lt)}: <${name}> is never closed`); break; }
      i += close.index + close[0].length;
      continue;
    }

    stack.push({ name, line: lineAt(src, lt) });
  }

  for (const open of stack) {
    if (!OPTIONAL_END.has(open.name)) found.push(`line ${open.line}: <${open.name}> is never closed`);
  }
  return found;
}

function checkAllHtml(files) {
  const html = files.filter((f) => extname(f) === '.html');
  for (const file of html) {
    const src = readFileSync(file, 'utf8');
    for (const p of checkHtml(src)) fail(rel(file), p);
    // A page with no <title> is a page that shows a URL in the tab and in
    // every bookmark — cheap to assert, easy to forget on a new page.
    if (!/<title>[^<]*\S[^<]*<\/title>/i.test(src)) fail(rel(file), 'has no non-empty <title>');
  }
  return html.length;
}

/* ── 3. The tree is clean (what actually gets uploaded) ────────────────── */

function checkCleanTree() {
  if (process.env.ALLOW_DIRTY_DEPLOY === '1') {
    console.log('  ⚠️  clean-tree assertion SKIPPED (ALLOW_DIRTY_DEPLOY=1) — you are shipping uncommitted files.');
    return;
  }
  let dirty = '';
  try {
    dirty = execFileSync('git', ['status', '--porcelain', '--', relative(REPO, PUBLIC_DIR)], {
      cwd: REPO, encoding: 'utf8',
    }).trim();
  } catch {
    fail('git', 'could not read git status — refusing to certify the tree');
    return;
  }
  if (dirty) {
    fail(
      'working tree',
      'uncommitted changes under the directory a deploy would upload:\n' +
        dirty.split('\n').map((l) => `      ${l}`).join('\n') +
        '\n      `wrangler pages deploy <dir>` ships the WORKING TREE, not a commit — commit first,' +
        '\n      or deploy from `git worktree add <tmp> HEAD` if another agent shares this checkout.',
    );
  }
}

/* ── 4. Live: the deployed URLs serve the expected strings ─────────────── */

async function checkLive() {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch (err) {
    fail(rel(CONFIG), `unreadable: ${err.message}`);
    return 0;
  }
  const base = (BASE_OVERRIDE || config.baseUrl).replace(/\/$/, '');
  console.log(`  against ${base}`);

  for (const page of config.pages) {
    const url = base + page.path;
    let res, body;
    try {
      res = await fetch(url + (url.includes('?') ? '&' : '?') + 'predeploy=' + Date.now(), {
        headers: {
          // A default fetch UA gets WAF-blocked here and returns "error code:
          // 1010", which reads exactly like a broken deploy and is not one.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
          'Cache-Control': 'no-cache',
        },
      });
      body = await res.text();
    } catch (err) {
      fail(url, `did not answer: ${err.message}`);
      continue;
    }
    if (!res.ok) { fail(url, `HTTP ${res.status}`); continue; }
    for (const needle of page.mustContain) {
      if (!body.includes(needle)) fail(url, `served 200 but is MISSING: ${JSON.stringify(needle)}`);
    }
  }
  return config.pages.length;
}

/* ── run ───────────────────────────────────────────────────────────────── */

const files = walk(PUBLIC_DIR);
console.log(`predeploy-check — ${LIVE ? 'LIVE' : 'STATIC'} — ${rel(PUBLIC_DIR)}`);

if (LIVE) {
  const n = await checkLive();
  console.log(`  ${n} page(s) fetched`);
} else {
  const jsCount = checkJavaScript(files);
  const htmlCount = checkAllHtml(files);
  checkCleanTree();
  console.log(`  ${jsCount} JS file(s) parsed · ${htmlCount} HTML file(s) structurally checked · tree checked`);
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s) — NOT safe to deploy:\n`);
  for (const p of problems) console.error(`  ${p.where}\n    ${p.msg}\n`);
  process.exit(1);
}
console.log('✓ all checks passed');
