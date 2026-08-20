/**
 * cors-coverage.test.ts — every API route the browser calls must be reachable
 * BY THE BROWSER.
 *
 * ⚠️ WHY THIS EXISTS. Twice in one day (2026-08-20) a correct Worker route
 * shipped that the browser could not use, and both times the symptom lied:
 *
 *   1. `/api/estate/keys` shipped with NO CORS MOUNT. The page reported
 *      "Could not reach the key service (network)" — which is what a rejected
 *      preflight looks like from JavaScript, and is indistinguishable from a
 *      Worker that is down. CSP was fine, the route was fine, the files were
 *      served.
 *   2. The revoke button shipped as `DELETE`, and `adminCors()` allows only
 *      GET/POST/OPTIONS. The browser refused at the preflight; the button did
 *      nothing at all, and the UI called it a network error.
 *
 * Neither is visible to a type-check, a unit test, or a structural page check.
 * The route exists, the handler is right, the markup is right — and the thing
 * still cannot be used. `status-pages.md` already warned in prose that "a CORS
 * mount is not implied by a route"; prose did not stop it happening twice, so
 * this is the mechanical version.
 *
 * ⚠️ DELIBERATELY COARSE, AND THAT IS THE DESIGN. A first version tried to
 * resolve each call to its exact URL and quietly missed every call made through
 * a `const KEYS_URL = ...` — which is exactly how the revoke button was
 * written, so replaying bug 2 against it PASSED. A guard with a hole precisely
 * where the bug lived is worse than no guard, because it gets credited as
 * coverage. This version asks a question it cannot get wrong: for each FILE,
 * every verb it uses must be allowed by at least one mount covering a path that
 * file mentions. It can over-report (a file calling two APIs with different
 * verb sets), and an over-report is a loud, fixable failure rather than a
 * silent gap.
 *
 * ⚠️ IT READS THE REAL FRONTEND, not a list someone maintains. A hand-kept
 * inventory of "routes the browser calls" is one more thing to forget to
 * update, and it would have been just as wrong on both of the days above.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const SITE = join(process.cwd(), '..', '..', 'sites', 'heygabi-home', 'public');
const INDEX_TS = join(process.cwd(), 'src', 'index.ts');

/** Verbs that cannot produce the failure this file is about. */
const IGNORED_VERBS = new Set(['HEAD']);

function jsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) jsFiles(p, out);
    else if (e.endsWith('.js')) out.push(p);
  }
  return out;
}

/** `app.use('<pattern>', <helper>())` → the CORS patterns and their helper. */
function mounts(): { pattern: string; helper: string }[] {
  const src = readFileSync(INDEX_TS, 'utf8');
  const found: { pattern: string; helper: string }[] = [];
  for (const m of src.matchAll(/app\.use\('([^']+)',\s*(\w+)\(\)\)/g)) {
    if (m[2].toLowerCase().includes('cors')) found.push({ pattern: m[1], helper: m[2] });
  }
  return found;
}

/** helper name → the verbs it actually allows. */
function allowedMethods(): Record<string, string[]> {
  const src = readFileSync(INDEX_TS, 'utf8');
  const out: Record<string, string[]> = {};
  for (const m of src.matchAll(/function (\w*[Cc]ors)\(\)[\s\S]*?allowMethods: \[([^\]]+)\]/g)) {
    out[m[1]] = m[2].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  }
  return out;
}

/**
 * Per frontend file: which auth-API paths it names, and which verbs it uses
 * AGAINST THE AUTH WORKER specifically.
 *
 * ⚠️ THE ORIGIN CHECK IS NOT OPTIONAL. A first version counted every verb in
 * the file and immediately cried wolf: admin.js PATCHes
 * `${app.origin}/api/admin/users/:id/role` — a DIFFERENT service — while also
 * calling the auth Worker elsewhere, so it looked like a broken control and was
 * not one. A guard that fails on a clean tree gets ignored, and an ignored
 * guard is worse than none: it still gets credited as coverage.
 *
 * Calls are classified by what the URL expression names — AUTH_ORIGIN, the
 * literal host, or a const bound to either. Resolving the const DECLARATION is
 * reliable; it was resolving its USAGES that failed before, and this needs only
 * the former.
 */
function perFile(): { file: string; paths: string[]; verbs: string[] }[] {
  const AUTH_PATH = /(?:\$\{AUTH_ORIGIN\}|https:\/\/auth\.heygabi\.ai)(\/api\/[^`'"\s?,)]*)/g;

  const out: { file: string; paths: string[]; verbs: string[] }[] = [];
  for (const f of jsFiles(SITE)) {
    const src = readFileSync(f, 'utf8');

    const paths = [
      ...new Set(
        [...src.matchAll(AUTH_PATH)].map((m) =>
          m[1].replace(/\$\{[^}]+\}/g, ':x').replace(/\/+$/, ''),
        ),
      ),
    ];
    if (!paths.length) continue; // this file does not talk to the auth Worker

    // Consts bound to an auth URL count as naming the auth origin.
    const authNames = new Set<string>();
    for (const m of src.matchAll(
      /(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*(?:AUTH_ORIGIN|auth\.heygabi\.ai)/g,
    )) {
      authNames.add(m[1]);
    }

    // ⚠️ EVERY VERB IN THE FILE, minus ones that provably belong to a DIFFERENT
    // service. Two cleverer versions were tried and BOTH silently missed bug 2:
    // one only saw inline URL literals; the other required a call to prove it
    // targeted the auth Worker, and api.js reaches it through a helper
    // (`authedFetch(KEYS_URL + ...)`) so no fetch there names the origin at all.
    // Each time, replaying the real bug against the guard PASSED.
    //
    // So this counts verbs bluntly and subtracts only what it can justify. The
    // one real cross-service caller is admin.js, which PATCHes
    // `${app.origin}/api/admin/users/:id/role` — a different Worker entirely —
    // while also calling this one. A verb is dropped only when it sits beside
    // an `/api/admin/` URL.
    //
    // Blunt-and-correct beats clever-and-holey: a false alarm costs a minute of
    // reading, a missed one costs a dead control nobody can see is dead.
    const verbs = new Set<string>();
    for (const m of src.matchAll(/method:\s*['\"]([A-Z]+)['\"]/g)) {
      const verb = m[1];
      if (IGNORED_VERBS.has(verb)) continue;
      const near = src.slice(Math.max(0, (m.index ?? 0) - 300), (m.index ?? 0) + 100);
      if (/\/api\/admin\//.test(near)) continue; // the other service's route
      verbs.add(verb);
    }
    void authNames; // the declaration scan documents which consts are ours

    out.push({ file: f.slice(SITE.length + 1), paths, verbs: [...verbs] });
  }
  return out;
}

function covers(pattern: string, path: string): boolean {
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

const MOUNTS = mounts();
const METHODS = allowedMethods();
const FILES = perFile();

test('the scanner actually found the wiring (guards against a silent no-op)', () => {
  // ⚠️ A coverage test that scans nothing passes forever. These floors are what
  // stop this file quietly becoming decoration.
  assert.ok(MOUNTS.length > 10, `only found ${MOUNTS.length} CORS mounts`);
  assert.ok(Object.keys(METHODS).length >= 3, `only found ${Object.keys(METHODS).length} cors helpers`);
  assert.ok(FILES.length >= 5, `only found ${FILES.length} frontend files calling the auth API`);
  assert.ok(
    FILES.some((f) => f.file.includes('api')),
    'the machine-keys page was not scanned at all',
  );
});

test('⚠️ every auth-API path the frontend names has a CORS mount', () => {
  const bad: string[] = [];
  for (const f of FILES) {
    for (const p of f.paths) {
      if (!MOUNTS.some((m) => covers(m.pattern, p))) bad.push(`  ${p}  (${f.file})`);
    }
  }
  assert.deepEqual(
    bad,
    [],
    '\nCalled by the browser but with no app.use(..., cors()) in index.ts, so the preflight\n' +
      'is refused and the page reports a NETWORK error:\n' + bad.join('\n'),
  );
});

test('⚠️ every verb a file uses is allowed by a mount that file can reach', () => {
  const bad: string[] = [];
  for (const f of FILES) {
    const allowed = new Set<string>();
    for (const p of f.paths) {
      const mount = MOUNTS.find((m) => covers(m.pattern, p));
      if (mount && METHODS[mount.helper]) for (const v of METHODS[mount.helper]) allowed.add(v);
    }
    if (!allowed.size) continue; // no covered path; the test above reports it
    for (const v of f.verbs) {
      if (!allowed.has(v)) {
        bad.push(
          `  ${f.file} uses ${v}, but its routes allow only ${[...allowed].join(', ')}\n` +
            `    paths: ${f.paths.join(', ')}`,
        );
      }
    }
  }
  assert.deepEqual(
    bad,
    [],
    '\nRefused at the CORS preflight: the control does nothing at all and the UI reports\n' +
      'it as a network failure:\n' + bad.join('\n'),
  );
});

test('every CORS mount names a helper that exists', () => {
  // A typo'd helper name would throw at runtime on the first request to that
  // path, which is a worse place to find out than here.
  for (const m of MOUNTS) {
    assert.ok(METHODS[m.helper], `${m.pattern} uses ${m.helper}(), which has no allowMethods`);
  }
});
