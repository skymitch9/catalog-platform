import type { Source } from './rows.js';

export interface Env {
  DB: D1Database;

  /**
   * Per-source push tokens, one secret each (`wrangler secret put
   * INDEX_PUSH_TOKEN_GAME`, etc.; `.dev.vars` locally). Per-source rather than
   * shared so one leaked token revokes one source's write access, not all
   * three, and so a source cannot overwrite a sibling's rows by accident.
   */
  INDEX_PUSH_TOKEN_GAME?: string;
  INDEX_PUSH_TOKEN_LIBRARY?: string;
  INDEX_PUSH_TOKEN_AUDIOBOOK?: string;
}

export function pushTokenFor(env: Env, source: Source): string | undefined {
  switch (source) {
    case 'game':
      return env.INDEX_PUSH_TOKEN_GAME;
    case 'library':
      return env.INDEX_PUSH_TOKEN_LIBRARY;
    case 'audiobook':
      return env.INDEX_PUSH_TOKEN_AUDIOBOOK;
  }
}
