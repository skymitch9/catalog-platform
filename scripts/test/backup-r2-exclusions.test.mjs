/**
 * ⚠️ END-TO-END: the REAL `scripts/backup-r2.mjs`, writing a REAL dump
 * directory, against a stand-in for the Cloudflare REST API.
 *
 * ## Why this is a spawned process and not an import
 *
 * `backup-r2.mjs` is a top-level script: it reads `process.argv`, validates
 * credentials and runs its work at import time. There is nothing to import and
 * call. Exercising it therefore means running it — which is the point, because
 * the bug class these tests exist for ("the exclusion looked right and matched
 * nothing", "the manifest still listed files the dump does not contain") is
 * only ever found by running the code, never by reasoning about it.
 *
 * ## Why a fake API and not the real bucket
 *
 * The REST `objects` endpoint needs `CLOUDFLARE_API_TOKEN`, which is a GitHub
 * repo secret and is deliberately **not on the owner's machine** — the
 * `wrangler login` OAuth session does not cover it (`docs/access/RECOVERY.md`
 * §7). So the offline proof is this: the real script, the real listing/get
 * protocol, the real filesystem output. The LIVE proof is the nightly run's own
 * log, which prints the same exclusion line.
 *
 * The fixture mirrors the measured shape of `ebooks-gated` (2026-08-18): two
 * gate manifests at the root, chunk packs under `text/`, transcripts under
 * `transcripts/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../backup-r2.mjs', import.meta.url));

/** The measured shape of `ebooks-gated`, small enough to serve from memory. */
const EBOOKS_GATED = [
  { key: 'ebooks.json', body: '{"books":[]}' },
  { key: 'audio_manifest.json', body: '{"audio":[]}' },
  { key: 'text/_index.json.gz', body: 'PACK-INDEX' },
  { key: 'text/the-primal-hunter-1.jsonl.gz', body: 'PACK-ONE' },
  { key: 'text/the-primal-hunter-2.jsonl.gz', body: 'PACK-TWO' },
  { key: 'transcripts/the-primal-hunter-1.json.gz', body: 'TRANSCRIPT-ONE-VERY-LARGE' },
  { key: 'transcripts/the-primal-hunter-2.json.gz', body: 'TRANSCRIPT-TWO-VERY-LARGE' },
];

/** A stand-in for `api.cloudflare.com/client/v4`, serving one bucket. */
async function startFakeApi(objectsByBucket) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const m = url.pathname.match(/\/accounts\/[^/]+\/r2\/buckets\/([^/]+)\/objects(?:\/(.*))?$/);
    if (!m) {
      res.writeHead(404).end('no route');
      return;
    }
    const [, bucket, rawKey] = m;
    const objects = objectsByBucket[bucket] ?? [];

    if (rawKey === undefined || rawKey === '') {
      const result = objects.map((o) => ({
        key: o.key,
        size: Buffer.byteLength(o.body),
        etag: 'etag-' + o.key,
        last_modified: '2026-08-19T00:00:00.000Z',
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, errors: [], result, result_info: { is_truncated: false } }));
      return;
    }

    const key = rawKey.split('/').map(decodeURIComponent).join('/');
    const hit = objects.find((o) => o.key === key);
    if (!hit) {
      res.writeHead(404).end('missing');
      return;
    }
    res.writeHead(200).end(hit.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}/client/v4` };
}

function run(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

/** Every file under a directory, as POSIX-ish relative paths. */
async function walk(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

test('⚠️ a real ebooks-gated dump contains text/ and the manifests and NO transcripts/', async (t) => {
  const { server, base } = await startFakeApi({ 'ebooks-gated': EBOOKS_GATED });
  const outDir = await mkdtemp(join(tmpdir(), 'r2-excl-'));
  t.after(async () => {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  });

  const { code, stdout, stderr } = await run(['ebooks-gated'], {
    CLOUDFLARE_API_BASE: base,
    CLOUDFLARE_API_TOKEN: 'test-token',
    CLOUDFLARE_ACCOUNT_ID: 'test-account',
    BACKUP_OUT_DIR: outDir,
  });
  assert.equal(code, 0, `backup-r2.mjs exited ${code}\n${stdout}\n${stderr}`);

  // 1. THE FILES. This is the assertion the whole change is for.
  const files = await walk(outDir);
  assert.deepEqual(files, [
    'manifest.json',
    'objects/audio_manifest.json',
    'objects/ebooks.json',
    'objects/text/_index.json.gz',
    'objects/text/the-primal-hunter-1.jsonl.gz',
    'objects/text/the-primal-hunter-2.jsonl.gz',
  ]);
  assert.ok(!existsSync(join(outDir, 'objects', 'transcripts')), 'transcripts/ was downloaded anyway');
  assert.equal(files.filter((f) => f.startsWith('objects/text/')).length, 3, 'a pack went missing');

  // 2. THE MANIFEST must list exactly what the dump holds — the bulk restore
  //    loops it — and must itself state what was left out.
  const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.objects.length, 5);
  assert.ok(!manifest.objects.some((o) => o.key.startsWith('transcripts/')), 'the manifest promised a file the dump lacks');
  assert.equal(manifest.excluded.length, 1);
  assert.equal(manifest.excluded[0].prefix, 'transcripts/');
  assert.equal(manifest.excluded[0].count, 2);
  assert.match(manifest.excluded[0].reason, /owner decision 2026-08-19/);

  // 3. THE LOG must say what was skipped and why — twice, once inline and once
  //    in the summary, because the inline line scrolls past in a real run.
  const lines = stdout.split('\n').filter((l) => l.includes('SKIPPING prefix "transcripts/"'));
  assert.equal(lines.length, 2, `expected the exclusion logged inline AND in the summary:\n${stdout}`);
  assert.match(lines[0], /2 object\(s\), 50 bytes NOT backed up/);
  assert.match(lines[0], /backup-restore\.md/);
});

test('a bucket with no rules is dumped whole — the exclusion is per-bucket, not global', async (t) => {
  const { server, base } = await startFakeApi({
    'library-covers': [{ key: 'transcripts/not-really.jpg', body: 'JPEG' }, { key: 'a/b.jpg', body: 'JPEG2' }],
  });
  const outDir = await mkdtemp(join(tmpdir(), 'r2-excl-'));
  t.after(async () => {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  });

  const { code, stdout } = await run(['library-covers'], {
    CLOUDFLARE_API_BASE: base,
    CLOUDFLARE_API_TOKEN: 'test-token',
    CLOUDFLARE_ACCOUNT_ID: 'test-account',
    BACKUP_OUT_DIR: outDir,
  });
  assert.equal(code, 0, stdout);
  assert.deepEqual(await walk(outDir), ['manifest.json', 'objects/a/b.jpg', 'objects/transcripts/not-really.jpg']);
  assert.ok(!stdout.includes('SKIPPING prefix'), 'an exclusion leaked into a bucket that has none');
});

test('⚠️ an exclusion that swallows the WHOLE bucket FAILS — never a cheerful empty backup', async (t) => {
  const { server, base } = await startFakeApi({
    'ebooks-gated': [{ key: 'transcripts/a.gz', body: 'A' }, { key: 'transcripts/b.gz', body: 'B' }],
  });
  const outDir = await mkdtemp(join(tmpdir(), 'r2-excl-'));
  t.after(async () => {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  });

  const { code, stdout, stderr } = await run(['ebooks-gated'], {
    CLOUDFLARE_API_BASE: base,
    CLOUDFLARE_API_TOKEN: 'test-token',
    CLOUDFLARE_ACCOUNT_ID: 'test-account',
    BACKUP_OUT_DIR: outDir,
  });
  assert.notEqual(code, 0, 'a backup containing nothing reported success');
  assert.match(stdout + stderr, /removed by a prefix\s+exclusion|removed by a prefix exclusion/);
});

test('--dry-run lists, reports the exclusion, and writes nothing at all', async (t) => {
  const { server, base } = await startFakeApi({ 'ebooks-gated': EBOOKS_GATED });
  const outDir = join(await mkdtemp(join(tmpdir(), 'r2-excl-')), 'should-not-exist');
  t.after(() => server.close());

  const { code, stdout } = await run(['ebooks-gated', '--dry-run'], {
    CLOUDFLARE_API_BASE: base,
    CLOUDFLARE_API_TOKEN: 'test-token',
    CLOUDFLARE_ACCOUNT_ID: 'test-account',
    BACKUP_OUT_DIR: outDir,
  });
  assert.equal(code, 0, stdout);
  assert.ok(!existsSync(outDir), '--dry-run created the output directory');
  assert.match(stdout, /would back up 5 object\(s\)/);
  assert.match(stdout, /2 object\(s\) excluded/);
  assert.match(stdout, /SKIPPING prefix "transcripts\/"/);
});
