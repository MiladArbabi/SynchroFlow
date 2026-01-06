# FT1 Module Implementation Playbook (LOCKED)

**Purpose**
Define the **only valid process** for adding an FT1-capable module that integrates correctly across:

* backend signals
* readiness aggregation
* frontend adapters
* module UI
* activation (Aha → checklist)

If a module does not follow this process **exactly**, it is not FT1-complete.

---

## 0. Non-Negotiable Principles (Read Once)

1. **Facts flow down. Decisions flow up.**
2. **Unknown ≠ zero**
3. **Frontend never infers**
4. **Modules never fetch**
5. **Only one place decides scenarios**

Violating any of these guarantees silent bugs.

---

## 1. Define the FT1 Scenarios (Module-Owned)

**Owner:** `modules/<module>/src/ui/types.ts`

You must define **exact, finite scenario names** up front.

Example (Specter):

```ts
export type SpecterFt1Scenario =
  | 'LOADING'
  | 'NO_SESSIONS'
  | 'LOW_SIGNAL'
  | 'HEALTHY';
```

Rules:

* Scenario names are **stable API**
* They are **not negotiable later**
* UI, tests, adapters, and analytics depend on them

---

## 2. Backend: Emit Signals Only (No Interpretation)

**Owner:** `apps/backend/src/onboarding/providers/<module>.provider.ts`

### Rules

* Emit **facts**, not UI states
* Emit `*.known` booleans where uncertainty exists
* Preserve `null` explicitly

Example (Specter):

```ts
return [
  { name: 'specter.sessionsKnown', value: boolean },
  { name: 'specter.sessionCount', value: number | null },
  { name: 'specter.signalConfidence', value: number | null }
];
```

Forbidden:

* Emitting `"NO_SESSIONS"`
* Coercing `null → 0`
* Guessing readiness

---

## 3. Readiness Aggregation (Zero Logic)

**Owner:** existing readiness system
Nothing to change per module.

Rule:

* Aggregation must remain **dumb**
* Missing providers = missing modules
* Signals pass through untouched

---

## 4. Frontend Adapter (Pure Mapping, Nothing Else)

**Owner:** `apps/frontend/src/pages/<module>/use<Module>Ft1Adapter.ts`

### What adapters do

* Extract the module block
* Read signals
* Map to **module props**
* Preserve `null` vs `0`

Example:

```ts
export function mapSpecterFt1Props(data: any): SpecterModuleProps {
  const mod = data.modules.find(m => m.moduleId === 'specter');
  const signals = mod?.signals ?? [];

  const get = (n: string) =>
    signals.find(s => s.name === n)?.value;

  const known = get('specter.sessionsKnown') === true;
  const raw = get('specter.sessionCount');

  return {
    sessionCount: !known ? null : Number(raw),
    signalConfidence: get('specter.signalConfidence') ?? null
  };
}
```

### Hard bans

* ❌ Hooks
* ❌ Loading logic
* ❌ Scenario inference
* ❌ Lifecycle checks

Adapters are **pure functions**.

---

## 5. Scenario Resolution Hook (Single Authority)

**Owner:** `modules/<module>/src/ui/hooks/use<Module>Ft1Scenario.ts`

This hook is the **only place** where scenarios are decided.

Example:

```ts
export function useSpecterFt1Scenario(
  input: { sessionCount: number | null; signalConfidence: number | null }
): SpecterFt1Scenario {

  if (input.sessionCount === null) return 'LOADING';
  if (input.sessionCount === 0) return 'NO_SESSIONS';
  if (input.signalConfidence === null) return 'LOW_SIGNAL';
  return 'HEALTHY';
}
```

Rules:

* Order matters
* `null` always wins first
* No UI concerns
* Fully testable

---

## 6. Diagnostic Card (API-Locked)

**Owner:** `modules/<module>/src/ui/components/*DiagnosticCard.tsx`

Must be **API-compatible** with OrderNexus:

```ts
type Props = {
  title: string;
  message: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  testId?: string;
};
```

Why:

* Enables shared tests
* Enables shared patterns
* Prevents UI drift

---

## 7. Module Page (Deterministic Switch)

**Owner:** `modules/<module>/src/ui/pages/<Module>Module.tsx`

Responsibilities:

* Call scenario hook
* Switch on scenario
* Render **one card only**
* Emit intents (never side effects)

Example pattern:

```tsx
switch (scenario) {
  case 'NO_SESSIONS':
    return (
      <DiagnosticCard
        testId="..."
        title="..."
        message="..."
        ctaLabel="..."
        onCtaClick={() => emit('install-sdk')}
      />
    );
}
```

Rules:

* No data inspection
* No guessing
* No routing
* No checklist logic

---

## 8. Public Module Exports (Critical)

**Owner:** `modules/<module>/package.json` + `src/ui/index.ts`

### Required

* Default export = Module Page
* Named exports = hooks, types, cards

Example:

```ts
export { default } from './pages/SpecterModule';
export { useSpecterFt1Scenario } from './hooks/useSpecterFt1Scenario';
export type { SpecterFt1Scenario } from './types';
export type { SpecterUiIntent } from './intents';
```

If this is wrong:

* JSX breaks
* Frontend cannot import
* Builds fail unpredictably

---

## 9. Frontend Page (Mount Only)

**Owner:** `apps/frontend/src/pages/<Module>Page.tsx`

Frontend page:

* Gates by lifecycle
* Fetches readiness
* Calls adapter
* Mounts module

Nothing else.

```tsx
return <SpecterModule {...props} onIntent={onIntent} />;
```

If logic creeps in here → architecture regression.

---

## 10. Aha / Activation Adapter

**Owner:** `apps/frontend/src/wiring/<module>AhaAdapter.ts`

Responsibilities:

1. Receive intent
2. Set checklist focus
3. Open checklist
4. Emit analytics

Never:

* Decide which scenario
* Inspect module state

---

## 11. Mandatory Test Matrix

Each FT1 module must have:

| Layer         | Test                 |
| ------------- | -------------------- |
| Scenario hook | pure scenario tests  |
| Adapter       | null vs zero mapping |
| Module UI     | scenario → card      |
| CTA           | intent emission      |

If any are missing → **FT1 incomplete**

---

## 12. Replication Checklist (For Products / Analytics / Finances)

For each new module:

1. Define scenarios
2. Emit backend signals
3. Add adapter
4. Add scenario hook
5. Add module page
6. Export correctly
7. Mount in frontend
8. Wire Aha adapter
9. Add tests
10. Verify LOADING vs ZERO behavior

Skip any step and you will debug for days later.

---

## Final Lock Statement

> FT1 is not a UI feature.
> It is a **contract across layers**.

Once a module follows this playbook:

* behavior is deterministic
* onboarding is trustworthy
* UI is explainable
* future FT2+ is possible

This process is now **the reference**.
