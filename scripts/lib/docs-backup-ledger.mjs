/**
 * The DOCS-BACKUP LEDGER — how the off-Cloudflare mirror learns the keys of the
 * `docs/*` backups, which no workflow run ever logs.
 *
 * ## Why this exists — MEASURED 2026-10-02
 *
 * `mirror-estate-backups.mjs` takes its EXPECTED stores from backup.yml's
 * retention invocation (`readWorkflowPrefixes`) — which names the four
 * `docs/<repo>` prefixes, because the bucket's retention covers them — but it
 * DISCOVERS keys only by reading backup.yml run logs (it has no bucket listing
 * on this machine; see its header). The docs backups are written by the LOCAL
 * scheduled task `EstateDocsBackupR2` (`scripts/backup-docs.mjs`), never by a
 * workflow run. So the mirror expected four stores it could never find, printed
 * `[WARN] docs/<repo>: NO complete generation …` on every pipeline cycle — 583
 * lines from the 2026-08-21 16:00 run to 2026-10-02 — and mirrored none of
 * them. The three gitignored docs trees (holding `access/CREDENTIALS.md` and
 * `access/keys/`) therefore had no backup history outside Cloudflare.
 *
 * The fix is the same idea as the workflow log, made local: the one writer of
 * those keys records each one it wrote, and the mirror reads that record.
 *
 * ## The file
 *
 * `catalog-platform/.local/docs-backup-ledger.jsonl` — gitignored (`.local/`),
 * one JSON object per line, appended AFTER `wrangler r2 object put` succeeded:
 *
 *     {"key":"docs/<repo>/<stamp>.json.gz","bytes":N,"sha256":"…","written_at":"…"}
 *
 * ⚠️ Keys and hashes only — never content. It names which repos were backed up
 * and when, which is nothing the public repo does not already say.
 *
 * ⚠️ A ledger line is a claim by THIS machine that it wrote the object; the
 * mirror checks it by fetching and comparing the sha256, so a stale or wrong
 * line becomes a named failure, not a silently mirrored wrong file.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The only prefixes the ledger may satisfy. Every other store is the workflow's. */
export const LEDGER_PREFIX = 'docs/';

/** A docs backup key: `docs/<repo>/<stamp>.json.gz`, nothing else. */
const DOCS_KEY = /^docs\/[A-Za-z0-9_-]+\/[0-9TZ-]+\.json\.gz$/;

export function appendLedger(path, entry) {
  if (!DOCS_KEY.test(entry.key)) throw new Error(`refusing to ledger a non-docs key: ${entry.key}`);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

/**
 * Every well-formed entry. A torn or foreign line is SKIPPED and counted, never
 * fatal: one bad line must not stop the other repos' docs being mirrored.
 */
export function readLedger(path) {
  if (!existsSync(path)) return { entries: [], bad: 0 };
  const entries = [];
  let bad = 0;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (DOCS_KEY.test(e.key) && Number.isInteger(e.bytes) && e.bytes > 0 && /^[0-9a-f]{64}$/.test(e.sha256)) {
        entries.push(e);
      } else bad += 1;
    } catch {
      bad += 1;
    }
  }
  return { entries, bad };
}

/**
 * For each expected `docs/*` prefix, the newest ledgered generation — the same
 * `{stamp, keys, runId}` shape `discoverLatest` returns, plus `sha256` per key.
 * A docs backup is ONE object, so a ledgered generation is complete by
 * construction (no part counts to check).
 *
 * @param {string[]} prefixes expected prefixes; non-docs ones are ignored
 * @param {{key:string, sha256:string}[]} entries
 * @returns {Map<string, {stamp:string, keys:string[], runId:string, sha256:Record<string,string>}>}
 */
export function latestFromLedger(prefixes, entries) {
  const found = new Map();
  for (const prefix of prefixes) {
    if (!prefix.startsWith(LEDGER_PREFIX)) continue;
    const mine = entries.filter((e) => e.key.startsWith(`${prefix}/`));
    if (mine.length === 0) continue;
    // Stamps are fixed-width, so the lexicographically greatest key is the newest.
    const newest = mine.reduce((a, b) => (b.key > a.key ? b : a));
    const stamp = newest.key.slice(newest.key.lastIndexOf('/') + 1).split('.')[0];
    found.set(prefix, { stamp, keys: [newest.key], runId: 'ledger', sha256: { [newest.key]: newest.sha256 } });
  }
  return found;
}
