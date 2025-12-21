Below is a **complete, authoritative, lock-level document**.
You can copy-paste this verbatim into:

```
docs/activation-surface/activationSurface-ftMinus1-locked.md
```

No placeholders. No TODOs. This is a **system contract**, not a draft.

---

# Activation Surface — FT-1 (Locked)

**Status:** 🔒 LOCKED
**Applies to:** FT-1, FT0
**Last stabilized:** 2025-12-21
**Scope:** Backend → Shared → UI activation pipeline

---

## 1. Purpose of This Document

This document **freezes and codifies** the FT-1 activation architecture.

It exists to:

* Prevent architectural drift
* Eliminate ambiguity between backend, shared logic, and UI
* Establish **non-negotiable ownership boundaries**
* Serve as the **single source of truth** for activation gating before FT1

Any future changes **must explicitly reference this document** and justify deviations.

---

## 2. What “FT-1 Activation” Means

FT-1 represents the **pre-activation reality**:

* The system has *truth* but not *readiness*
* Decisions are already being made (data, syncs, entitlements)
* Activation determines whether those decisions are **informed**

FT-1 is **not**:

* A marketing funnel
* A UI trick
* A feature gate hack

FT-1 **is a truth exposure mechanism**.

---

## 3. Architectural Layers (Hard Separation)

### 3.1 Domain / Activation Logic (Pure, Backend-Owned)

**Location**

```
modules/shared/src/activation
```

**Files**

```
derivationVersion.ts
deriveActivationVerdict.ts
deriveFT0Phase.ts
deriveActivationSurfaceState.ts
types.ts
index.ts
```

**Responsibilities**

* Determine *truth*, never UI
* Decide:

  * BLOCKED / PENDING / ACTIVE
  * FT0 phase
  * Activation surface state
* Be:

  * Pure
  * Deterministic
  * Testable
  * Versioned

**Explicitly Forbidden**

* UI props
* Copy
* Labels
* Module IDs
* React concepts

---

### 3.2 Backend IO Layer (Adapter + Audit)

**Location**

```
apps/backend/src/api/activation
```

**Responsibilities**

* Gather snapshots (identity, integrations, entitlements)
* Call shared derivation logic
* Persist **audit events**
* Adapt domain output into a transport-safe response

**Key Rule**

> Backend owns *truth*, not *presentation*

#### Audit Responsibilities (Mandatory)

The backend is responsible for:

* Writing activation audit events **for every evaluation**
* Ensuring audit schema exists **before** activation routes are enabled
* Logging (not throwing) on audit persistence failure
* Emitting identifiers sufficient for forensic reconstruction

Audit writes are **best-effort but mandatory**.
Silent omission is a system violation.

---

### 3.3 Shared UI Activation Layer (Contract + Mapping)

**Location**

```
modules/shared/src/ui/activation
```

**Files**

```
activation-mapper.ts
buildActivationSurfaceProps.ts
ActivationSurface.tsx
types.ts
index.ts
visuals/
```

This layer is the **only translator** between:

* Domain activation state
* UI-consumable activation props

#### Key Principle

> UI never inspects domain verdicts directly.

---

### 3.4 Frontend Usage Layer

**Location**

```
apps/frontend/src/activation
```

**Responsibilities**

* Fetch activationSurface
* Provide module-specific surface config
* Render via `ModuleActivationBoundary`
* Supply action handlers

**Forbidden**

* Inspecting verdict reasons
* Branching on domain enums
* Inferring readiness

---

## 4. Activation Data Flow (Canonical)

```
[ Backend ]
  └─ deriveActivationVerdict
  └─ deriveFT0Phase
  └─ deriveActivationSurfaceState
  └─ audit write
  └─ API response
          ↓
[ Frontend ]
  └─ mapActivationSurfaceToUIState
  └─ buildActivationSurfaceProps
  └─ ModuleActivationBoundary
  └─ ActivationSurface
```

There are **no alternative paths**.

---

## 5. Domain → UI Contract

### 5.1 Domain Output (Immutable)

```ts
ActivationSurfaceState =
  | BLOCKED_AUTH
  | BLOCKED_SHOP
  | CONNECT_INTEGRATION
  | SYNC_IN_PROGRESS
  | READY_PENDING_MODULES
  | ACTIVE
```

This is **semantic truth**, not UI language.

---

### 5.2 UI Props Contract

```ts
ActivationSurfaceProps {
  moduleId: string
  identity?
  blindness
  absenceProof?
  valueAfterActivation?
  primaryCTA
  trust
  postActivation?
  onAction?
}
```

This is **visual + semantic**, not logic.

---

## 6. The Two Critical Translators (LOCKED SEAMS)

### 6.1 `deriveActivationSurfaceState`

**Location**

```
modules/shared/src/activation/deriveActivationSurfaceState.ts
```

**Role**

* Converts verdict + FT0 phase → semantic surface state
* Pure
* No UI knowledge

This function is **domain-locked**.

---

### 6.2 `buildActivationSurfaceProps`

**Location**

```
modules/shared/src/ui/activation/buildActivationSurfaceProps.ts
```

**Role**

* Converts semantic surface state + module config → UI props
* Owns:

  * Which copy appears
  * Which CTA is shown
  * What blindness means visually

This function is **UI-locked**.

> Any new activation state **must** be handled here.

---

## 7. ModuleActivationBoundary (Single Gate)

**Location**

```
modules/shared/src/ui/ModuleActivationBoundary.tsx
```

**Guarantees**

* Children **never render** unless ACTIVE
* BLOCKED state is visually enforced
* No module bypass is possible

This is the **only allowed gate**.

---

## 8. Versioning & Audit Guarantees

### 8.1 Derivation Version

```ts
ACTIVATION_DERIVATION_VERSION = 'v1.0.0'
```

Source of truth: modules/shared/src/activation

Rules:
The derivation version is defined and owned by shared
Backend controllers must not inject or override it
Audit builders must enforce version consistency
Any semantic change requires:

Version bump:
Migration-safe audit compatibility
Documentation update
Derivation versioning is non-negotiable for replay safety.

Must be bumped if:

* Verdict rules change
* FT0 phase logic changes
* Meaning of any activation state changes

### 8.2 Audit Guarantees

Audit events are:

* Append-only
* Deterministic
* Replayable
* Explainable

They are **not telemetry**.
They are **historical truth**.

### 8.3 Activation Audit Event Schema (Authoritative)

Activation audit events are **structural records**, not logs.

The table `activation_audit_events` is the **single historical source of truth**
for why activation decisions were made.

#### Canonical Columns

| Column               | Nullable | Notes |
|---------------------|----------|-------|
| `id`                | ❌       | Primary key |
| `occurred_at`       | ❌       | Evaluation timestamp |
| `user_id`           | ✅       | Nullable for pre-auth flows |
| `shop_id`           | ✅       | Nullable until ownership resolved |
| `entry_channel`     | ❌       | `SHOPIFY_APP` \| `WEB` |
| `verdict`           | ❌       | Final activation verdict |
| `reason`            | ✅       | Only for BLOCKED / PENDING |
| `derivation_version`| ❌       | Must match shared derivation |
| `payload`           | ❌       | Full evaluation snapshot |
| `payload_hash`      | ❌       | SHA-256 hash of payload |

#### Guarantees

* Audit rows are **append-only**
* Columns may be **added**, never removed
* Existing columns must **never change meaning**
* Backfills are allowed only via corrective migrations

Audit correctness is a **hard invariant** of FT-1 and FT0.

The `activation_audit_events` table schema is **finalized at creation time**.

All required audit columns — including but not limited to:

* `derivation_version`
* `entry_channel`
* `payload_hash`
* `payload`
* `verdict`
* `reason`

**must be defined in the initial CREATE TABLE migration**.

Any later migration that historically referenced these columns:

* MUST NOT add, alter, or re-declare them
* MUST be converted to a no-op once schema is stabilized
* EXISTS solely to preserve migration timeline integrity

#### Rationale

This guarantees:

* Clean bootstrap from an empty database
* Deterministic audit replay
* Zero conditional migrations
* CI / prod parity

#### Hard Rule

> If a column is moved earlier in migration history,  
> every later migration touching that column **must be neutralized**.

Violating this rule breaks FT-1/FT0 reproducibility.

---

## 9. Explicit Non-Goals (DO NOT DO THESE)

* ❌ No UI logic in backend
* ❌ No verdict branching in frontend
* ❌ No module-specific hacks
* ❌ No temporary adapters
* ❌ No “just this once” shortcuts
* ❌ No deep imports into `src/`

Violating any of the above **breaks the system contract**.

---

## 10. Change Protocol (Mandatory)

Any future change must:

1. Identify **which layer**
2. Justify **why FT-1 is insufficient**
3. Update:

   * This document
   * Tests
   * Derivation version (if applicable)

No exceptions.

1. Comply with database migration rules defined in:
   `docs/engineering/database-migrations.md`

Activation logic is not complete unless its schema is stable.

---

## 11. Status Declaration

As of this document:

* ✅ Activation surface is **architecturally complete**
* ✅ FT-1 and FT0 are unified
* ✅ UI is contract-driven
* ✅ Backend owns truth
* ✅ No known redundancies exist

This layer is **stable and locked**.

---

Below is a **single-page, executive-level diagram section** you can append directly to
`docs/activation-surface/activationSurface-ftMinus1-locked.md`.

It is intentionally **one page**, readable top-to-bottom, and maps **exactly** to the code you stabilized.

---

## 12. One-Page Activation Surface Architecture Diagram (FT-1 → FT0)

### Canonical Flow (Authoritative)

```
┌─────────────────────────────────────────────────────────────┐
│                         BACKEND                              │
│                                                             │
│  Identity + Integrations + Entitlements                      │
│            │                                                │
│            ▼                                                │
│   deriveActivationVerdict()                                  │
│            │                                                │
│   deriveFT0Phase()                                           │
│            │                                                │
│   deriveActivationSurfaceState()                             │
│            │                                                │
│            ▼                                                │
│   ActivationSurfaceState  (PURE / DOMAIN)                    │
│            │                                                │
│            ├── audit write (append-only)                     │
│            │                                                │
│            ▼                                                │
│   API Response                                               │
│   { activationSurface, ft0, meta }                           │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ JSON (no UI logic)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   SHARED UI LAYER                            │
│                                                             │
│  mapActivationSurfaceToUIState()                             │
│            │                                                │
│  buildActivationSurfaceProps()                               │
│            │                                                │
│            ▼                                                │
│  ActivationSurfaceProps  (UI-safe contract)                  │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ props only
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│                                                             │
│  CommerceActivationGate                                      │
│            │                                                │
│  ModuleActivationBoundary                                    │
│      ├── ACTIVE  → render module                             │
│      └── BLOCKED → render ActivationSurface                  │
│                                                             │
│  ActivationSurfacePage                                       │
│  (visual semantics only)                                     │
└─────────────────────────────────────────────────────────────┘
```

---

### Layer Responsibilities (At a Glance)

| Layer                      | Owns                    | Must NOT           |
| -------------------------- | ----------------------- | ------------------ |
| **Backend**                | Truth, readiness, audit | UI language, copy  |
| **Shared / activation**    | Domain semantics        | React, props       |
| **Shared / ui/activation** | Mapping & contracts     | Business logic     |
| **Frontend**               | Rendering & actions     | Verdict inspection |

---

### Hard Guarantees (Diagram-Enforced)

* **No sideways arrows**
  → No layer reaches around another
* **No upward dependencies**
  → UI never influences truth
* **Single choke point**
  → `ModuleActivationBoundary` is the only gate
* **Replayable history**
  → Audit events mirror derivation inputs exactly

---

### Why This Diagram Matters

If someone later asks:

> “Why can’t we just check `verdict.reason` in the UI?”

This diagram is the answer.

If someone says:

> “Let’s add a temporary activation bypass”

This diagram proves why that breaks the system.

---

### Lock Status

This diagram is **structural**, not illustrative.

* Any arrow change = architectural change
* Any box change = ownership change
* Any new path = contract violation

🔒 **FT-1 Activation Surface is now diagram-locked.**

---

## 13. State → Surface → CTA Mapping Table (FT-1 Locked)

This table defines the **only allowed transitions** from backend activation state
→ rendered surface
→ primary user action.

Any deviation is a **contract violation**.

---

### A. Backend → Activation Surface State

| Backend Verdict | Reason                | FT0 Phase         | `ActivationSurfaceState.state` |
| --------------- | --------------------- | ----------------- | ------------------------------ |
| `BLOCKED`       | `NOT_AUTHENTICATED`   | any               | `BLOCKED_AUTH`                 |
| `BLOCKED`       | `NO_SHOP`             | any               | `BLOCKED_SHOP`                 |
| `BLOCKED`       | `NO_INTEGRATION`      | `PRE_INTEGRATION` | `CONNECT_INTEGRATION`          |
| `PENDING`       | `FT0_SYNCING`         | `SYNCING`         | `SYNC_IN_PROGRESS`             |
| `PENDING`       | `ENTITLEMENT_PENDING` | `READY`           | `READY_PENDING_MODULES`        |
| `ACTIVE`        | —                     | `READY`           | `ACTIVE`                       |

---

### B. Activation Surface State → UI Surface Shape

| Surface State           | Surface Shown     | Blocking? |
| ----------------------- | ----------------- | --------- |
| `BLOCKED_AUTH`          | ActivationSurface | ✅         |
| `BLOCKED_SHOP`          | ActivationSurface | ✅         |
| `CONNECT_INTEGRATION`   | ActivationSurface | ✅         |
| `SYNC_IN_PROGRESS`      | ActivationSurface | ✅         |
| `READY_PENDING_MODULES` | ActivationSurface | ✅         |
| `ACTIVE`                | *No surface*      | ❌         |

> **Invariant**
> If state ≠ `ACTIVE`, the module **must not render**.

---

### C. Surface State → Primary CTA

| Surface State           | Primary CTA Label   | `actionId`            | Intent             |
| ----------------------- | ------------------- | --------------------- | ------------------ |
| `BLOCKED_AUTH`          | Log in              | `login`               | Establish identity |
| `BLOCKED_SHOP`          | Connect store       | `connect-store`       | Resolve ownership  |
| `CONNECT_INTEGRATION`   | Connect integration | `connect-integration` | Enable data flow   |
| `SYNC_IN_PROGRESS`      | Syncing…            | *none*                | Inform only        |
| `READY_PENDING_MODULES` | Continue setup      | `review-modules`      | Finalize access    |
| `ACTIVE`                | —                   | —                     | Module unlocked    |

---

### D. CTA → Frontend Responsibility

| `actionId`            | Frontend Responsibility            |
| --------------------- | ---------------------------------- |
| `login`               | Redirect to auth flow              |
| `connect-store`       | Trigger Shopify / platform connect |
| `connect-integration` | Navigate to integration setup      |
| `review-modules`      | Navigate to entitlements / pricing |
| *none*                | Disable CTA, show progress         |

> **Rule**
> Frontend **executes**, never decides.
> If an action feels “wrong”, the backend state is wrong.

---

### E. Non-Negotiable Invariants

* ❌ UI must **never** branch on `ActivationVerdict`
* ❌ UI must **never** infer readiness
* ❌ CTA labels must **not** encode logic
* ✅ One surface = one primary action
* ✅ One state = one CTA meaning

---

### F. Failure Modes (Explicit)

| Violation                  | Result                     |
| -------------------------- | -------------------------- |
| UI inspects verdict        | Logic drift                |
| Multiple CTAs              | Decision paralysis         |
| CTA without backend state  | Irreversible inconsistency |
| Active module with surface | Trust collapse             |

---

### Lock Declaration

This table is **locked for FT-1 and FT0**.

Any change requires:

1. Backend derivation update
2. Audit version bump
3. Docs + diagram update
4. Explicit architectural review

No shortcuts.

---

**End of Document** 🔒
