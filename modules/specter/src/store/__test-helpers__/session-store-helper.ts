// modules/specter/src/store/__test-helpers__/session-store-helper.ts
import { InMemorySessionStore } from '../../store/session-store';

export function clearAll(store: InMemorySessionStore) {
  // helper wrapper used by tests — delegate to the real reset() method
  // kept the helper name for test callers; under the hood we call reset()
  store.reset();
}