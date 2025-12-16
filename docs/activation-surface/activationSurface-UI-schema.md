# ActivationSurface UI Schema

**(Slots + Props · Canonical · Locked)**

> **Purpose:**
> Provide a standardized, conversion-optimized surface that makes *inaction unacceptable* and *activation inevitable* — without exaggeration or manipulation.

---

## 1️⃣ Top-Level Component

```ts
interface ActivationSurfaceProps {
  moduleId: string;

  /** Core identity & decision framing */
  identity: IdentitySlot;

  /** Visualization of operational blindness */
  blindness: BlindnessSlot;

  /** Absence-based proof (locked data / unavailable insight) */
  absenceProof: AbsenceProofSlot;

  /** Deterministic value after activation */
  valueAfterActivation: ValueAfterActivationSlot;

  /** Primary activation CTA */
  primaryCTA: PrimaryCTASlot;

  /** Trust & reassurance (must render directly under CTA) */
  trust: TrustSlot;

  /** Optional commitment gradient (modal / stepper) */
  commitmentGradient?: CommitmentGradientSlot;

  /** Optional integration momentum (machine-verified only) */
  momentum?: MomentumSlot;

  /** Optional post-activation expectations */
  postActivation?: PostActivationSlot;
}
```

---

## 2️⃣ Identity Slot

**(One Dominant Pain · No Benefits)**

```ts
interface IdentitySlot {
  headline: string;        // ONE sentence, present tense
  subtext?: string;        // Optional clarification (≤ 1 line)
}
```

### Rules

* Must describe **blindness**, not features
* Must be binary (know vs don’t know)
* No aspirational language

### Example (MarginCore)

```ts
identity: {
  headline: "You don’t know if your cost assumptions are wrong.",
  subtext: "Every margin decision today is based on unverifiable inputs."
}
```

---

## 3️⃣ Blindness Slot

**(Visualize the Unknown)**

```ts
interface BlindnessSlot {
  title?: string;
  rows: Array<{
    label: string;
    state: 'unknown' | 'locked';
    hint?: string;
  }>;
}
```

### Rules

* Never show numbers
* Unknown is the product
* Rows must map to real system inputs

### Example

```ts
blindness: {
  rows: [
    { label: "Shipping cost model", state: "unknown" },
    { label: "Payment fees", state: "unknown" },
    { label: "Overhead allocation", state: "unknown" }
  ]
}
```

---

## 4️⃣ Absence Proof Slot

**(Epistemic Anxiety Engine)**

```ts
interface AbsenceProofSlot {
  title: string;
  artifact: {
    label: string;
    missingItems: string[];
  };
  caption: string;
}
```

### Rules

* Must show **something that exists but is inaccessible**
* Must not show fake or estimated data
* “Locked”, “Unavailable”, “Unknown” are valid states

### Example

```ts
absenceProof: {
  title: "Unavailable until activated",
  artifact: {
    label: "Order margin calculation",
    missingItems: [
      "Shipping model",
      "Payment fees",
      "Overhead allocation"
    ]
  },
  caption: "The number exists. Its correctness does not."
}
```

---

## 5️⃣ Value After Activation Slot

**(One Deterministic Outcome)**

```ts
interface ValueAfterActivationSlot {
  statement: string;   // One sentence, guaranteed outcome
}
```

### Rules

* Exactly ONE outcome
* Must be technically inevitable
* No optimization promises

### Example

```ts
valueAfterActivation: {
  statement: "MarginCore becomes the single source of truth for cost assumptions."
}
```

---

## 6️⃣ Primary CTA Slot

**(Single Forward Path)**

```ts
interface PrimaryCTASlot {
  label: string;
  onActivate: () => void;
  disabledReason?: string;
}
```

### Rules

* One CTA only
* Verb must be deterministic (“Activate”, “Connect”, “Authorize”)
* Disabled state must explain why

### Example

```ts
primaryCTA: {
  label: "Activate MarginCore",
  onActivate: openActivationFlow
}
```

---

## 7️⃣ Trust Slot

**(Anxiety Intercept · Mandatory)**

```ts
interface TrustSlot {
  bullets: string[];
}
```

### Rules

* Must render **immediately below CTA**
* Must be factual and contract-backed
* No marketing claims

### Example

```ts
trust: {
  bullets: [
    "No order recalculation without approval",
    "Versioned cost models only",
    "Full audit trail",
    "Rollback safe"
  ]
}
```

---

## 8️⃣ Commitment Gradient Slot (Optional)

```ts
interface CommitmentGradientSlot {
  steps: Array<{
    title: string;
    description: string;
  }>;
}
```

### Rules

* Each step must reduce uncertainty
* No evaluative language (“review”, “explore”)
* Steps must match real system behavior

### Example

```ts
commitmentGradient: {
  steps: [
    {
      title: "Confirm scope",
      description: "MarginCore defines cost models only. Order profit remains owned by OrderNexus."
    },
    {
      title: "Confirm recomputation control",
      description: "You choose when and how recalculation happens."
    }
  ]
}
```

---

## 9️⃣ Momentum Slot (Optional · Strictly Verified)

```ts
interface MomentumSlot {
  message: string;
}
```

### Rules

* Must be backed by runtime truth
* Must reference already-connected modules
* No speculative phrasing

### Example

```ts
momentum: {
  message: "Orders are already connected. MarginCore will immediately govern their cost assumptions."
}
```

---

## 🔟 Post-Activation Slot (Optional)

```ts
interface PostActivationSlot {
  steps: string[];
}
```

### Rules

* Must describe observable system behavior
* No time promises unless guaranteed
* No benefit claims

### Example

```ts
postActivation: {
  steps: [
    "A single active cost model is established",
    "Future margin calculations reference this model",
    "All changes are versioned and auditable"
  ]
}
```

---

## 🚨 Hard Constraints (Non-Negotiable)

❌ No feature lists
❌ No social proof
❌ No comparative claims
❌ No vague benefits
❌ No “improve”, “optimize”, “boost” language
❌ No scrolling required for core understanding

---

## ActivationSurface Success Test

If a merchant can answer **all three** without scrolling:

1. *What don’t I know right now?*
2. *Why is that dangerous?*
3. *What single action fixes it?*

→ The surface is correct.

If not → redesign.

---

## Canonical Rule (Lock This)

> **ActivationSurface is not onboarding.
> It is risk exposure.**

This schema ensures:

* Consistency across modules
* Conversion through certainty
* Zero doctrine drift

---