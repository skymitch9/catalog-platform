/**
 * Which trees the docs backup archives — the pure half of
 * `scripts/backup-docs.mjs`, extracted to `scripts/lib/backup-docs-trees.mjs`
 * on 2026-09-06 when the gitignored `.claude/` folders joined the backup.
 *
 * ⚠️ WHAT THESE GUARD IS A DATA-ABSENCE BUG, in both directions:
 *
 *   too little — a `.claude` folder that is MISSING or EMPTY must be a logged
 *                no-op, never a failure. `library_catalog` has none at all and
 *                `KNOWN_ISSUES.md` KI-14 emptied three others; if the new tree
 *                were required, the incident that motivated this feature would
 *                also have broken the backup that answers it.
 *   too much   — `.claude/worktrees/` is a whole second CHECKOUT of the repo
 *                and `.claude/.wrangler/` has held live API keys (KI-3). Both
 *                must be excluded, and the exclusion must ANNOUNCE itself.
 *
 * And the docs half must not have regressed in the move: the OneDrive
 * placeholder fix (KI-9) and the outside-the-tree refusal are re-pinned here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  CLAUDE_SKIP_DIRS,
  SKIP_DIRS,
  bundleRepo,
  collectTree,
  destPathFor,
  refusalFor,
  treeLogLine,
  treeOf,
  treesFor,
  walk,
} from '../lib/backup-docs-trees.mjs';

/** A throwaway repo-shaped fixture. Returns absolute paths; caller removes it. */
function fixture(build) {
  const root = mkdtempSync(join(tmpdir(), 'backup-docs-trees-'));
  build(root);
  return root;
}

const file = (root, rel, body = 'x') => {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return full;
};

const paths = (entries) => entries.map((e) => `${e.tree}:${e.path}`).sort();

// ---------------------------------------------------------------------------
// treesFor — the two trees and their DIFFERENT failure rules
// ---------------------------------------------------------------------------

test('a repo with no `.claude` path contributes the docs tree only', () => {
  const trees = treesFor({ name: 'library_catalog', docs: '/x/docs' });
  assert.equal(trees.length, 1);
  assert.equal(trees[0].tree, 'docs');
  assert.equal(trees[0].required, true);
});

test('⚠️ docs is REQUIRED and claude is NOT — the whole failure-rule difference, in one assertion', () => {
  const trees = treesFor({ name: 'catalog-platform', docs: '/x/docs', claude: '/x/.claude' });
  assert.deepEqual(
    trees.map((t) => [t.tree, t.required]),
    [
      ['docs', true],
      ['claude', false],
    ],
  );
  // ⚠️ And they do not share an exclusion list: the claude tree excludes two
  // more directories, each for its own measured reason.
  assert.equal(trees[0].skipDirs, SKIP_DIRS);
  assert.equal(trees[1].skipDirs, CLAUDE_SKIP_DIRS);
});

test('⚠️ CLAUDE_SKIP_DIRS is SKIP_DIRS plus worktrees and .wrangler — a repo copy and a key store', () => {
  for (const d of SKIP_DIRS) assert.ok(CLAUDE_SKIP_DIRS.has(d), `${d} must still be excluded`);
  assert.ok(CLAUDE_SKIP_DIRS.has('worktrees'), 'a throwaway checkout of the whole repo must never be archived');
  assert.ok(CLAUDE_SKIP_DIRS.has('.wrangler'), 'KI-3: wrangler dev source maps have held live API keys');
  assert.equal(CLAUDE_SKIP_DIRS.size, SKIP_DIRS.size + 2, 'nothing else may be quietly dropped from .claude');
});

// ---------------------------------------------------------------------------
// collectTree — missing / empty / ok, and the exclusions
// ---------------------------------------------------------------------------

test('⚠️ a MISSING .claude is status "missing" with zero files — not a throw, not a failure', () => {
  const root = fixture((r) => file(r, 'docs/README.md'));
  try {
    const result = collectTree({ tree: 'claude', root: join(root, '.claude'), required: false, skipDirs: CLAUDE_SKIP_DIRS });
    assert.equal(result.status, 'missing');
    assert.deepEqual(result.entries, []);
    assert.equal(result.bytes, 0);
    // The refusal rule must not fire on it.
    assert.equal(refusalFor([{ tree: 'claude', required: false, file_count: 0 }]), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('⚠️ an EMPTY .claude is status "empty", and that is a DIFFERENT fact from missing', () => {
  const root = fixture((r) => mkdirSync(join(r, '.claude'), { recursive: true }));
  try {
    const result = collectTree({ tree: 'claude', root: join(root, '.claude'), required: false, skipDirs: CLAUDE_SKIP_DIRS });
    assert.equal(result.status, 'empty', 'the post-KI-14 state of three repos — it was there and held nothing');
    assert.deepEqual(result.entries, []);
    // A file count alone cannot tell these apart, which is why both statuses
    // are carried into the archive's own manifest.
    assert.notEqual(result.status, 'missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a populated .claude archives every file, nested ones included', () => {
  const root = fixture((r) => {
    file(r, '.claude/settings.local.json', '{"permissions":{}}');
    file(r, '.claude/agents/reviewer.md', '# reviewer');
    file(r, '.claude/skills/deploy/SKILL.md', '# deploy');
  });
  try {
    const result = collectTree({ tree: 'claude', root: join(root, '.claude'), required: false, skipDirs: CLAUDE_SKIP_DIRS });
    assert.equal(result.status, 'ok');
    assert.deepEqual(paths(result.entries), [
      'claude:agents/reviewer.md',
      'claude:settings.local.json',
      'claude:skills/deploy/SKILL.md',
    ]);
    // POSIX separators in the archive so a restore is not Windows-shaped.
    for (const e of result.entries) assert.ok(!e.path.includes('\\'), `${e.path} must use / separators`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('⚠️ worktrees/ and .wrangler/ are EXCLUDED — and the exclusion ANNOUNCES itself', () => {
  const root = fixture((r) => {
    file(r, '.claude/settings.local.json', '{}');
    file(r, '.claude/worktrees/wt1/src/index.ts', 'export {}');
    file(r, '.claude/.wrangler/tmp/dev-1/index.js.map', 'a-source-map');
  });
  try {
    const logged = [];
    const result = collectTree(
      { tree: 'claude', root: join(root, '.claude'), required: false, skipDirs: CLAUDE_SKIP_DIRS },
      { log: (m) => logged.push(m) },
    );
    assert.deepEqual(paths(result.entries), ['claude:settings.local.json']);
    // ⚠️ NO SILENT CAPS. A skip that says nothing is a silent cap wearing a
    // comment — both must be reported, by name, in the log AND in the ledger
    // that goes into the archive.
    const why = result.skipped.map((s) => s.why).join(' | ');
    assert.match(why, /worktrees/);
    assert.match(why, /\.wrangler/);
    assert.equal(result.skipped.length, 2);
    assert.equal(logged.filter((l) => l.includes('SKIPPED')).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// walk — the docs-half guarantees that must not have regressed in the move
// ---------------------------------------------------------------------------

/**
 * ⚠️ JUNCTIONS, NOT FILE SYMLINKS. Windows refuses a symlink to a non-admin
 * without Developer Mode (measured here: `EPERM`), so a symlink-based test
 * SKIPS on the very machine the estate runs on — an unrunnable guard is not a
 * guard. A directory junction needs no elevation, and it is also the real
 * shape: three of the four `.claude` folders ARE junctions to
 * `C:\lcw\onedrive-excluded\<repo>\.claude`. On POSIX the type argument is
 * ignored and this makes an ordinary symlink, which exercises the same branch.
 */
const linkDir = (target, path) => symlinkSync(target, path, 'junction');

test('⚠️ KI-9 + the .claude junctions: a directory link resolving INSIDE the tree is FOLLOWED', () => {
  const root = fixture((r) => {
    file(r, 'store/settings.local.json', '{}');
    file(r, 'store/agents/reviewer.md', '# reviewer');
  });
  try {
    // The exact estate shape: `.claude` is a junction and its target holds the
    // files. `realpathSync` resolves the ROOT first, so everything inside is
    // contained by the only definition that matters.
    linkDir(join(root, 'store'), join(root, '.claude'));
    const skipped = [];
    const files = walk(join(root, '.claude'), join(root, '.claude'), { skipped });
    assert.equal(files.length, 2, 'a junctioned .claude must archive normally, not come back empty');
    assert.deepEqual(skipped, []);

    // ...and end to end, through the same path the script takes.
    const { entries, trees } = bundleRepo({ name: 'fix', docs: join(root, 'store'), claude: join(root, '.claude') });
    assert.equal(trees.find((t) => t.tree === 'claude').status, 'ok');
    assert.equal(entries.filter((e) => e.tree === 'claude').length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('⚠️ a link INSIDE the tree that points OUTSIDE it is refused, and the refusal names where it went', () => {
  const root = fixture((r) => {
    file(r, 'docs/real.md', 'hello');
    file(r, 'outside/secret.md', 'nope');
  });
  try {
    linkDir(join(root, 'outside'), join(root, 'docs/escape'));
    const skipped = [];
    const files = walk(join(root, 'docs'), join(root, 'docs'), { skipped });
    assert.equal(files.length, 1, 'only the real file — the escape hatch must not be walked');
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].why, /resolves OUTSIDE the tree/);
    assert.match(skipped[0].why, /outside/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('⚠️ a DANGLING junction (the KI-14 shape) is a logged no-op, never a crash', () => {
  const root = fixture((r) => file(r, 'docs/README.md', '# docs'));
  try {
    const target = join(root, 'gone');
    mkdirSync(target);
    linkDir(target, join(root, '.claude'));
    rmSync(target, { recursive: true, force: true }); // the junction now dangles

    const { entries, trees } = bundleRepo({ name: 'fix', docs: join(root, 'docs'), claude: join(root, '.claude') });
    const claude = trees.find((t) => t.tree === 'claude');
    assert.ok(['missing', 'empty'].includes(claude.status), `dangling junction must not throw, got ${claude.status}`);
    assert.equal(claude.file_count, 0);
    assert.equal(refusalFor(trees), null, 'the docs backup still lands');
    assert.equal(entries.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('walk on a path that does not exist returns nothing rather than throwing', () => {
  assert.deepEqual(walk('/definitely/not/here/at/all', '/definitely/not/here/at/all'), []);
});

// ---------------------------------------------------------------------------
// bundleRepo — the two trees in ONE archive, which is the design decision
// ---------------------------------------------------------------------------

test('⚠️ ONE archive carries BOTH trees, each entry tagged with the tree it came from', () => {
  const root = fixture((r) => {
    file(r, 'docs/README.md', '# docs');
    file(r, 'docs/access/keys/README.md', '# keys');
    file(r, '.claude/settings.local.json', '{}');
  });
  try {
    const { entries, trees, bytes } = bundleRepo({ name: 'fix', docs: join(root, 'docs'), claude: join(root, '.claude') });
    assert.deepEqual(paths(entries), [
      'claude:settings.local.json',
      'docs:README.md',
      'docs:access/keys/README.md',
    ]);
    assert.deepEqual(
      trees.map((t) => [t.tree, t.status, t.file_count]),
      [
        ['docs', 'ok', 2],
        ['claude', 'ok', 1],
      ],
    );
    assert.equal(bytes, entries.reduce((n, e) => n + e.bytes, 0));
    // Every entry round-trips byte-exact: base64 + sha256 + length, the three
    // things restore-docs.mjs re-checks before it will write anything.
    for (const e of entries) assert.equal(Buffer.from(e.b64, 'base64').length, e.bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('⚠️ THE KI-14 CASE: an empty .claude does NOT stop the docs backup', () => {
  const root = fixture((r) => {
    file(r, 'docs/README.md', '# docs');
    mkdirSync(join(r, '.claude'), { recursive: true });
  });
  try {
    const { entries, trees } = bundleRepo({ name: 'fix', docs: join(root, 'docs'), claude: join(root, '.claude') });
    assert.equal(entries.length, 1);
    assert.equal(refusalFor(trees), null, 'an empty OPTIONAL tree must never refuse the run');
    const claude = trees.find((t) => t.tree === 'claude');
    assert.equal(claude.status, 'empty');
    // ⚠️ It still gets a log line. A no-op that says nothing is
    // indistinguishable from a step that never ran.
    assert.match(treeLogLine(claude), /EMPTY/);
    assert.match(treeLogLine(claude), /which is fine/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('⚠️ AND THE OTHER DIRECTION: an empty docs tree still REFUSES the whole repo', () => {
  const root = fixture((r) => {
    mkdirSync(join(r, 'docs'), { recursive: true });
    file(r, '.claude/settings.local.json', '{}');
  });
  try {
    const { trees } = bundleRepo({ name: 'fix', docs: join(root, 'docs'), claude: join(root, '.claude') });
    const refusal = refusalFor(trees);
    assert.ok(refusal, 'zero docs files is a moved directory or a typo in REPOS, never an empty backup');
    assert.equal(refusal.tree, 'docs');
    // ⚠️ A `.claude` that DID yield files must not paper over it — the refusal
    // is per required tree, never on the archive's total file count.
    assert.equal(trees.find((t) => t.tree === 'claude').file_count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a repo with no claude path bundles exactly as it did before 2026-09-06', () => {
  const root = fixture((r) => file(r, 'docs/README.md', '# docs'));
  try {
    const { entries, trees } = bundleRepo({ name: 'fix', docs: join(root, 'docs') });
    assert.equal(trees.length, 1);
    assert.deepEqual(paths(entries), ['docs:README.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The restore mapping
// ---------------------------------------------------------------------------

test('⚠️ an entry with NO `tree` means docs — every archive written before 2026-09-06 still restores', () => {
  assert.equal(treeOf({ path: 'README.md' }), 'docs');
  assert.equal(destPathFor({ path: 'README.md' }, '/out'), resolve('/out', 'README.md'));
});

test('the docs layout under --into is UNCHANGED, and claude lands in .claude/', () => {
  assert.equal(destPathFor({ tree: 'docs', path: 'access/keys/README.md' }, '/out'), resolve('/out/access/keys/README.md'));
  assert.equal(destPathFor({ tree: 'claude', path: 'settings.local.json' }, '/out'), resolve('/out/.claude/settings.local.json'));
});

test('🔴 a `..` in an archived path is REFUSED rather than written outside --into', () => {
  assert.throws(() => destPathFor({ tree: 'docs', path: '../../etc/passwd' }, '/out'), /OUTSIDE/);
  assert.throws(() => destPathFor({ tree: 'claude', path: '../../../x' }, '/out'), /OUTSIDE/);
  // ...and the message says what happened, what it needs and what to do — a
  // person must never be shown a bare failure.
  try {
    destPathFor({ tree: 'docs', path: `..${sep}escape` }, '/out');
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /never contains one/);
    assert.match(err.message, /inspect the path first/);
  }
});
