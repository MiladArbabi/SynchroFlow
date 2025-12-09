# Specter Session Store

This directory contains the session persistence layer used by the Specter
ingestion pipeline. The ingestion logic (`session-ingestion.ts`) depends on a
minimal contract that any session store must implement.

## SessionStore Interface

```ts
export interface SessionStore {
  saveSession(session: AnonymousSession): Promise<string>;
  getAllSessionsForShop(shopId: number): AnonymousSession[];
  getSessionsLastNDays(shopId: number, days?: number): Promise<AnonymousSession[]>;
  reset(): void;
}
````

### Required behaviors

* **saveSession(session)**

  * Persists the session (sync or async).
  * Must return the `sessionId` it stored.
  * Should treat the passed object as immutable (copy it or avoid mutation).

* **getAllSessionsForShop(shopId)**

  * Returns *synchronously* all known sessions for a shop.
  * Used by analytics (`computeSessionMetrics`) during tests.
  * Must not throw if the shop has no sessions.

* **getSessionsLastNDays(shopId, days)**

  * Returns sessions filtered by timestamps.
  * Only `createdAt` is required; interpreters should assume ISO timestamps.

* **reset()**

  * Clears all stored sessions.
  * Used heavily in isolated test runs to guarantee a clean state.

Any replacement store (Redis, Postgres, KV store, etc.) must respect these
semantics, especially immutability and sync availability for metrics (or provide
a thin synchronous snapshot wrapper).

* `setSessionStoreForTests(store)` can be used to override the runtime store during tests or ad-hoc runs.

**Important:** The `createSessionStore()` factory will always return an `InMemorySessionStore` when `NODE_ENV === 'test'`. This protects unit tests from flaky async backends (Redis) and preserves synchronous getters required by `computeSessionMetrics`.

---

## Default Implementation: InMemorySessionStore

`InMemorySessionStore` is used for:

* unit tests
* dev mode
* local analytics evaluation

Key characteristics:

* Stores all sessions in an in-memory array.
* `saveSession` clones the session to prevent external mutation.
* `getAllSessionsForShop` is synchronous for test simplicity.
* `reset()` clears all state.

The singleton export:

```ts
export const sessionStore: SessionStore = new InMemorySessionStore();
```

This is what ingestion uses by default.

---

## CommonJS / ESM Interop

A compatibility shim is included so Jest (in CommonJS mode) can import:

* `default`
* named exports (`InMemorySessionStore`, `sessionStore`)

This keeps mocks simple and prevents differences between runtime and test module
shape.

---

## How to Mock the Store in Tests

Specter tests commonly mock the store using Jest’s `isolateModules`:

```ts
jest.doMock('../store/session-store', () => ({
  __esModule: true,
  InMemorySessionStore: class {
    saveSession = jest.fn(async () => 'mock-id');
    getSessionsLastNDays = jest.fn(async () => []);
  }
}));
```

Because `session-ingestion.ts` uses a `resolveStore` function, it accepts:

* a mock instance
* a mock class
* an object with `.default`
* or an object with `.InMemorySessionStore`

This keeps tests stable regardless of module export style.

---

## Extending or Replacing the Store

When implementing a new store backend, ensure:

1. The class implements the `SessionStore` interface.
2. It does *not* mutate incoming `AnonymousSession` objects.
3. It returns deterministic values for `.saveSession` and `.getAllSessionsForShop`.
4. Timestamps (`createdAt`) are parseable by `Date.parse`.

For production, a typical upgrade path would be:

* Replace `sessionStore` export with a factory or dynamic provider.
* Implement a persistent variant (Redis, SQL, etc.) behind the same interface.

---

## Future Enhancements (optional)

* Add typed index / query interfaces.
* Add TTL-based cleanup for large in-memory datasets.
* Add durability layers or batched writes for high-volume ingestion.

---
