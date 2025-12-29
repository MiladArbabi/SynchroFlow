Standard Module Export Convention (LOCK THIS)
Rule 1 — Every module exports its FT1 page as a named export
export { OrdersModule } from './pages/OrdersModule';
export { SpecterModule } from './pages/SpecterModule';


❌ No default exports for module pages
❌ No mixed styles

Rule 2 — Frontend always imports modules the same way
import { OrdersModule } from '@lasyncro/order-nexus';
import { SpecterModule } from '@lasyncro/specter';


This guarantees:

JSX-safe imports

No namespace imports

No TS2786 / TS2604 ever again

Rule 3 — index.ts is the only public UI surface

Each module must expose exactly this shape:

// modules/*/src/ui/index.ts
export { OrdersModule } from './pages/OrdersModule';

// hooks
export { useOrdersFt1Scenario } from './hooks/useOrdersFt1Scenario';

// components
export { OrdersDiagnosticCard } from './components/OrdersDiagnosticCard';

// types
export type { OrdersFt1Scenario } from './types';
export type { OrdersUiIntent } from './intents';


No re-export chains. No indirection. No “clever” barrels.

🔧 Migration Plan (Safe, Incremental)
Step 1 — Update Order-Nexus (source of inconsistency)

Before

export default function OrdersModule() {}


After

export function OrdersModule() {}


Update its ui/index.ts:

export { OrdersModule } from './pages/OrdersModule';

Step 2 — Update frontend imports (mechanical)

Global replace:

- import OrdersModule from '@lasyncro/order-nexus';
+ import { OrdersModule } from '@lasyncro/order-nexus';


This is a safe refactor.
No logic changes. No runtime impact.

Step 3 — Enforce via lint (non-negotiable)

Add an ESLint rule (or custom check):

❌ forbid import X from '@lasyncro/*'

✅ require named imports from modules

This prevents regression permanently.

🧠 Why this convention wins (objectively)
Problem	Solved
JSX namespace imports	✅ eliminated
Default vs named confusion	✅ eliminated
Rollup / Vite edge cases	✅ eliminated
Jest vs build mismatches	✅ eliminated
API discoverability	✅ improved
Refactors	✅ trivial

Default exports are fine inside apps.
They are a liability across package boundaries.

🔒 Final Lock Statement

All modules/* export their FT1 page as a named export.
Frontend always imports named module pages.
No exceptions.

If this rule is broken again, it’s not a mistake — it’s an architectural regression.