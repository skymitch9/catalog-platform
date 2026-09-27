/**
 * project-board.test.mjs — push-project-board.mjs, the wrapper any repo's
 * session calls to publish its own card on /status/agents (contract §11).
 *
 * No network and no token anywhere in here: --check and every refusal return
 * before the pusher is exec'd, and that is exactly what these pin — a wrapper
 * that reached the network on a bad slug, or printed the token on --check,
 * would look fine from the outside.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { bytesOf, mergedBoard, parseSectionBody, sectionNameFor } from '../lib/project-board.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = join(ROOT, 'scripts', 'push-project-board.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'project-board-test-'));

function write(name, text) {
  const p = join(TMP, name);
  writeFileSync(p, text, 'utf8');
  return p;
}

function run(args, env = {}) {
  const clean = { ...process.env, ...env };
  if (!('ESTATE_CONDUCTOR_TOKEN' in env)) delete clean.ESTATE_CONDUCTOR_TOKEN;
  return spawnSync(process.execPath, [WRAPPER, ...args], { encoding: 'utf8', env: clean, cwd: TMP, timeout: 20_000 });
}

test('sectionNameFor: the slug becomes project_<slug>; anything else is refused in words', () => {
  assert.deepEqual(sectionNameFor('black-bloc'), { name: 'project_black-bloc' });
  assert.deepEqual(sectionNameFor('a'), { name: 'project_a' });
  for (const bad of ['', 'Black-Bloc', 'black_bloc', 'a b', 'x'.repeat(41), '../etc', undefined]) {
    const out = sectionNameFor(bad);
    assert.ok(out.error, `"${bad}" must be refused`);
    assert.match(out.error, /lowercase/);
  }
});

test('parseSectionBody: an object passes; arrays, bare values and bad JSON are refused', () => {
  assert.deepEqual(parseSectionBody('{"name":"x"}'), { body: { name: 'x' } });
  assert.deepEqual(parseSectionBody('﻿{"name":"x"}'), { body: { name: 'x' } }, 'a BOM is stripped, not fatal');
  assert.match(parseSectionBody('[1,2]').error, /JSON OBJECT/);
  assert.match(parseSectionBody('"hi"').error, /JSON OBJECT/);
  assert.match(parseSectionBody('null').error, /JSON OBJECT/);
  assert.match(parseSectionBody('{nope').error, /not valid JSON/);
});

test('mergedBoard: sets exactly one section and leaves the rest of the draft alone', () => {
  const draft = { agents: [1], project_b: { name: 'B' } };
  assert.deepEqual(mergedBoard(draft, 'project_a', { name: 'A' }), { agents: [1], project_b: { name: 'B' }, project_a: { name: 'A' } });
  assert.deepEqual(draft, { agents: [1], project_b: { name: 'B' } }, 'the draft object itself is not mutated');
  assert.deepEqual(mergedBoard(null, 'project_a', {}), { project_a: {} });
  assert.ok(bytesOf({ a: 1 }) > 0);
});

test('--check: prints the section name and sizes, writes nothing, sends nothing, never the token', () => {
  const file = write('bb.json', JSON.stringify({ name: 'Black Bloc', agents: [{ name: 'x', state: 'running' }] }));
  const secret = 'do-not-print-me-0123456789abcdef';
  const res = run(['black-bloc', file, '--check'], { ESTATE_CONDUCTOR_TOKEN: secret });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /section:\s+project_black-bloc/);
  assert.match(res.stdout, /section bytes:\s+\d+/);
  assert.match(res.stdout, /payload bytes:\s+\d+ of 262144/);
  assert.match(res.stdout, /\$ESTATE_CONDUCTOR_TOKEN is set/);
  assert.ok(!res.stdout.includes(secret) && !res.stderr.includes(secret), 'the token value never appears');
});

test('--check with no token anywhere says MISSING rather than failing', () => {
  const file = write('ok.json', '{}');
  const res = run(['black-bloc', file, '--check', '--token-file', join(TMP, 'nope.txt')]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /MISSING/);
});

test('refusals: bad slug, non-object, missing file, missing token — each in words, exit 1', () => {
  const ok = write('ok2.json', '{"name":"x"}');
  const arr = write('arr.json', '[1]');

  const slug = run(['Black_Bloc', ok]);
  assert.equal(slug.status, 1);
  assert.match(slug.stderr, /not a project slug/);

  const nonObject = run(['black-bloc', arr]);
  assert.equal(nonObject.status, 1);
  assert.match(nonObject.stderr, /JSON OBJECT/);

  const missing = run(['black-bloc', join(TMP, 'absent.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Could not read/);

  const noToken = run(['black-bloc', ok, '--token-file', join(TMP, 'nope.txt')]);
  assert.equal(noToken.status, 1);
  assert.match(noToken.stderr, /No conductor token/);
  assert.match(noToken.stderr, /Nothing was pushed/);

  const tokenFlag = run(['black-bloc', ok, '--token', 'x']);
  assert.equal(tokenFlag.status, 1);
  assert.match(tokenFlag.stderr, /no --token flag/);
});

test('a refused push never creates the shared draft', () => {
  const draft = join(ROOT, '.local', 'agent-board.json');
  const before = existsSync(draft);
  run(['Bad', write('x.json', '{}')]);
  run(['black-bloc', write('y.json', '{}'), '--token-file', join(TMP, 'nope.txt')]);
  assert.equal(existsSync(draft), before);
});
