/**
 * The probes must DETECT a failing-open site, or they are decoration. Two
 * in-process servers: one conformant, one with the §6-row-5 hole (a data
 * route served tokenless). The probe run must pass the first and fail the
 * second.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { probesPassed, runConformanceProbes } from '../src/probes.js';

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') throw new Error('no port');
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const target = (baseUrl: string) => ({
  baseUrl,
  protectedRoutes: [{ path: '/api/things' }, { path: '/api/other' }],
  openRoutes: [{ path: '/api/health' }],
  machineRoutes: [{ method: 'POST', path: '/api/machine/push' }],
});

test('a conformant site passes, with the never-probeable items visibly skipped', async () => {
  const { server, url } = await listen((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200).end('{"ok":true}');
      return;
    }
    // Everything else requires a token this fake never accepts.
    res.writeHead(401).end('{"error":"unauthenticated"}');
  });
  try {
    const results = await runConformanceProbes(target(url));
    assert.equal(results.length, 8, 'all eight checklist items always reported');
    assert.equal(probesPassed(results), true);
    const skipped = results.filter((r) => r.outcome === 'skipped').map((r) => r.id);
    assert.deepEqual(skipped, ['8.2#1', '8.2#4', '8.2#5', '8.2#6', '8.2#7', '8.2#8']);
    const three = results.find((r) => r.id === '8.2#3');
    assert.equal(three?.outcome, 'pass');
  } finally {
    server.close();
  }
});

test('a site failing open on ONE route is caught by #3', async () => {
  const { server, url } = await listen((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200).end('{"ok":true}');
      return;
    }
    if (req.url === '/api/other') {
      // The hole: a data route mounted before the blanket middleware.
      res.writeHead(200).end('{"data":"leaked"}');
      return;
    }
    res.writeHead(401).end('{}');
  });
  try {
    const results = await runConformanceProbes(target(url));
    assert.equal(probesPassed(results), false);
    const three = results.find((r) => r.id === '8.2#3');
    assert.equal(three?.outcome, 'fail');
    assert.match(three?.detail ?? '', /\/api\/other → 200/);
  } finally {
    server.close();
  }
});

test('a machine route answering 2xx tokenless is caught', async () => {
  const { server, url } = await listen((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200).end('{}');
      return;
    }
    if (req.url === '/api/machine/push') {
      res.writeHead(200).end('{"pushed":true}');
      return;
    }
    res.writeHead(401).end('{}');
  });
  try {
    const results = await runConformanceProbes(target(url));
    const three = results.find((r) => r.id === '8.2#3');
    assert.equal(three?.outcome, 'fail');
    assert.match(three?.detail ?? '', /machine route served tokenless/);
  } finally {
    server.close();
  }
});

test('a garbage bearer accepted anywhere is caught by #2', async () => {
  const { server, url } = await listen((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200).end('{}');
      return;
    }
    // Accepts ANY Authorization header — the no-verification hole.
    if (req.headers.authorization) {
      res.writeHead(200).end('{"data":1}');
      return;
    }
    res.writeHead(401).end('{}');
  });
  try {
    const results = await runConformanceProbes(target(url));
    const two = results.find((r) => r.id === '8.2#2');
    assert.equal(two?.outcome, 'fail');
    assert.match(two?.detail ?? '', /garbage token → 200/);
  } finally {
    server.close();
  }
});
