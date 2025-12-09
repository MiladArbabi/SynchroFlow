// modules/specter/src/store/__test-helpers__/session-store-helper.ts
import { InMemorySessionStore } from '../../store/session-store';

// Keep a compatible helper but use the canonical name `reset`
export function reset(store: InMemorySessionStore) {
  // delegate to the real reset() method
  store.reset();
}

// Backwards-compatible export (in case any code still imports clearAll)
export const clearAll = reset;