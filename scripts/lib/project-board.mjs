/**
 * project-board.mjs — the pure half of push-project-board.mjs: which slugs are
 * legal, what a section body must be, and how big the push would be.
 *
 * Kept apart from the CLI so the rules are testable with no network and no
 * token (scripts/test/project-board.test.mjs). The contract they enforce is
 * docs/info/agent-board-contract.md §11; the Worker enforces the same slug
 * pattern (apps/auth-worker/src/agent-board.ts PROJECT_SECTION_RE) — ⚠️ change
 * the two together, or a push the wrapper accepts will be treated by the Worker
 * as an ordinary, unprotected section.
 */

export const SLUG_RE = /^[a-z0-9-]{1,40}$/;
export const BOARD_MAX_BYTES = 256 * 1024;

/** `black-bloc` → `{ name: 'project_black-bloc' }`, or `{ error }` in words. */
export function sectionNameFor(slug) {
  const s = typeof slug === 'string' ? slug : '';
  if (!SLUG_RE.test(s)) {
    return {
      error:
        `"${s}" is not a project slug. Use 1–40 characters of lowercase a–z, digits and hyphens ` +
        '(e.g. black-bloc, library-catalog) — it becomes the board section project_<slug>.',
    };
  }
  return { name: `project_${s}` };
}

/** File text → `{ body }` (a plain object), or `{ error }` in words. Strips a
 *  leading BOM: PowerShell's Out-File writes one and JSON.parse then rejects a
 *  perfect file (docs/info/agent-board-contract.md §8). */
export function parseSectionBody(text) {
  const clean = String(text ?? '').replace(/^﻿/, '');
  let body;
  try {
    body = JSON.parse(clean);
  } catch (err) {
    return { error: `That file is not valid JSON (${err.message}). Nothing was pushed.` };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      error:
        'The project section must be a JSON OBJECT — {"name": …, "agents": […], …} — not an array or a bare value. ' +
        'Write the section body itself; the wrapper adds the project_<slug> key. Nothing was pushed.',
    };
  }
  return { body };
}

/** The board that would be pushed: the draft with this one section set. */
export function mergedBoard(draft, name, body) {
  const base = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  return { ...base, [name]: body };
}

/** Bytes as board-draft.mjs writes the draft (2-space indent). */
export function bytesOf(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), 'utf8');
}
