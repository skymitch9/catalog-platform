/**
 * predeploy-markers.test.mjs — the marker dry-run's rules.
 *
 * The point of the module under test is that `npm run check:home` and
 * `npm run verify:home` assert predeploy.checks.json with the SAME code, so the
 * pre-deploy gate can never disagree with the post-deploy verifier. These tests
 * pin the two halves that could drift: the path→file map (Pages serves a
 * directory from its index.html, and getting that wrong would silently skip
 * every HTML page) and the comparison itself, including the `mustNotContain`
 * mirror that a "does the string appear" check is easy to implement backwards.
 *
 * ⚠️ These are the RULES, not the CONFIG. That the estate's own
 * predeploy.checks.json is satisfied is asserted by running check:home, which
 * is what the deploy script does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileForPath, markerMessage, markerProblems } from '../lib/predeploy-markers.mjs';

const PUB = '/pub';
const norm = (p) => p.split('\\').join('/');

test('a directory path is served by its index.html — the case that would skip every page', () => {
  // If this map were wrong for directory paths, the dry-run would fail to read
  // /, /status/, /admin/ … and (before the ENOENT-is-a-failure rule) would have
  // reported "checked" for pages it never opened.
  assert.equal(norm(fileForPath(PUB, '/')), '/pub/index.html');
  assert.equal(norm(fileForPath(PUB, '/status/')), '/pub/status/index.html');
  assert.equal(norm(fileForPath(PUB, '/status/api/')), '/pub/status/api/index.html');
});

test('an asset path is the file itself', () => {
  assert.equal(norm(fileForPath(PUB, '/assets/theme.js')), '/pub/assets/theme.js');
  assert.equal(norm(fileForPath(PUB, '/status/lib/board.js')), '/pub/status/lib/board.js');
  assert.equal(norm(fileForPath(PUB, '/assets/apex-notices.css')), '/pub/assets/apex-notices.css');
});

test('a query or fragment is dropped rather than becoming part of the filename', () => {
  // The live phase appends its own cache-buster; nothing in the config carries
  // one today, and a path that grew one must not resolve to a file that cannot
  // exist — that would read as "the page is missing".
  assert.equal(norm(fileForPath(PUB, '/status/?x=1')), '/pub/status/index.html');
  assert.equal(norm(fileForPath(PUB, '/assets/theme.js#top')), '/pub/assets/theme.js');
});

test('a satisfied page reports nothing', () => {
  const page = { path: '/', mustContain: ['<h1>Estate</h1>'], mustNotContain: ['>!Sky<'] };
  assert.deepEqual(markerProblems('<h1>Estate</h1> and no bad string', page), []);
});

test('a missing mustContain is reported, with the marker verbatim', () => {
  const page = { path: '/status/agents/', mustContain: ['id="board-fresh"'] };
  const problems = markerProblems('<div id="board-freshness">', page);
  assert.deepEqual(problems, [{ kind: 'missing', marker: 'id="board-fresh"' }]);
});

test('⚠️ a mustNotContain that is STILL THERE is reported — the mirror, in the right direction', () => {
  // The removal half is the easy one to implement backwards, and backwards it
  // would pass every deploy that failed to remove something.
  const page = { path: '/assets/estate-search.js', mustNotContain: ['const FULL_SCOPE_SIZE ='] };
  assert.deepEqual(markerProblems('const FULL_SCOPE_SIZE = 3;', page), [
    { kind: 'present', marker: 'const FULL_SCOPE_SIZE =' },
  ]);
  assert.deepEqual(markerProblems('const scopeSize = catalogs.length;', page), []);
});

test('every wrong marker is reported, not just the first — a deploy fixed one at a time is N deploys', () => {
  const page = {
    path: '/',
    mustContain: ['alpha', 'beta', 'gamma'],
    mustNotContain: ['stale'],
  };
  const problems = markerProblems('beta and stale', page);
  assert.equal(problems.length, 3);
  assert.deepEqual(problems.map((p) => p.marker), ['alpha', 'gamma', 'stale']);
});

test('a page with neither list is not an error — a bare entry asserts nothing and says so by returning nothing', () => {
  assert.deepEqual(markerProblems('anything', { path: '/todo/' }), []);
});

test('markers are compared as SUBSTRINGS, never as lines or tokens', () => {
  // Half the estate's markers are fragments of an attribute or a sentence
  // ("id=\"ops-signin\"", "not a permissions problem"), so a line- or
  // word-based comparison would fail everything.
  const page = { path: '/x', mustContain: ['not a permissions problem'] };
  assert.deepEqual(markerProblems('…an outage, not a permissions problem, so…', page), []);
});

test('the failure message names the marker AND the config entry that pins it', () => {
  const missing = markerMessage({ kind: 'missing', marker: 'id="q"' }, '/docs/');
  assert.match(missing, /MISSING/);
  assert.match(missing, /id=\\"q\\"/);
  assert.match(missing, /\/docs\//);
  assert.match(missing, /predeploy\.checks\.json/);

  const present = markerMessage({ kind: 'present', marker: '.innerHTML =' }, '/docs/docs.js');
  assert.match(present, /STILL CARRIES/);
  assert.match(present, /docs\.js/);
  // The two senses must never read alike: one says add it back, one says take it out.
  assert.notEqual(missing.startsWith('is MISSING'), present.startsWith('is MISSING'));
});
