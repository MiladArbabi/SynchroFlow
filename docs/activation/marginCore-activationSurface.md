# MarginCore (Finances) ActivationSurface

**Reference Implementation (LOCKED)**

---

## 1️⃣ Identity + Core Blind Spot

**(Doctrine: One Dominant Pain · Decision Certainty)**

> **“You don’t know if your cost assumptions are wrong.”**

Not:

* “You don’t have a cost model”
* “You haven’t configured finances”
* “Margins might be inaccurate”

**Why this is the correct framing**

* Merchants *always* have a cost model — it’s just implicit, outdated, or guessed
* The real danger is **believing margins are correct when they aren’t**

This targets **false confidence**, not missing setup.

---

## 2️⃣ Operational Blindness Visualization

**(Doctrine: Visualize the Unknown, Not the Feature)**

```
Current margin decisions
────────────────────────────────────
Shipping cost assumption: ⚫ Unknown
Payment fee assumption: ⚫ Unknown
Overhead allocation: ⚫ Unknown
Tax handling: ⚫ Unknown
────────────────────────────────────
Margin accuracy: ⚫ Unverifiable
```

**Key rule**
Do NOT show percentages or numbers.
Unknown is the product.

---

## 3️⃣ Absence Pattern

**(Doctrine: Show What Is Missing Right Now)**

> **“Every margin number today is based on assumptions you can’t audit.”**

This is devastating in a good way:

* It doesn’t accuse
* It exposes unverifiability
* It reframes “setup” as “risk control”

---

## 4️⃣ Cost of Inaction (Unacceptable State)

**(Doctrine: Make Inaction Operationally Dangerous)**

> **“Without a verified cost model, profitable and unprofitable orders are indistinguishable.”**

This aligns perfectly with MarginCore’s boundary:

* It does NOT compute order profit
* It determines whether profit computation can be trusted

---

## 5️⃣ Value After Activation (Single Deterministic Outcome)

**(Doctrine: One Outcome Only)**

> **“Once activated, MarginCore becomes the single source of truth for your cost assumptions.”**

Not:

* “Accurate margins everywhere”
* “Improved profitability”
* “Financial insights”

This is **governance**, not optimization.

---

## 6️⃣ Proof Loop (Absence-Driven)

**(Doctrine: Epistemic Anxiety, Not Feature Listing)**

> **“Example of unavailable verification until activated:”**

```
Order margin calculation
────────────────────────
Revenue: Known
Costs applied: [LOCKED]
────────────────────────
• Shipping model: Unknown
• Payment fees: Unknown
• Overhead allocation: Unknown

Margin confidence: Unknown
```

**Caption**

> “The number exists. Its correctness does not.”

This is MarginCore’s killer line.

---

## 7️⃣ Primary CTA

**(Doctrine: One Forward Path)**

**Button**

> **Activate MarginCore**

Not:

* “Configure costs”
* “Set up finances”
* “Manage pricing”

Activation = assumption control.

---

## 8️⃣ Trust & Guardrails (Directly Under CTA)

> No order recalculation
> No retroactive changes without approval
> Versioned cost models only
> Explicit recomputation control
> Full audit trail • Rollback safe

This directly maps to:

* `CostModelVersioning`
* RecomputationGuard
* Outbox guarantees

---

## 9️⃣ Commitment Gradient (If Modal / Stepper Exists)

### Step 1 — Confirm Scope

> **“MarginCore will only define cost models.
> Order profit remains owned by OrderNexus.”**

This removes fear of hidden recomputation.

---

### Step 2 — Confirm Control

> **“You choose when and how recomputation happens.”**

Explicitly mention:

* none
* new orders only
* all orders since (guarded)

---

### Step 3 — Begin Activation

> **Begin activation**

No soft language.

---

## 🔟 Post-Activation Expectation (System-Bound)

> **After activation:**
>
> 1. A single active cost model governs assumptions
> 2. All future margin calculations reference this model
> 3. Any changes are versioned and auditable

No promises about profit improvement.
Only correctness and control.

---

## No-Scroll Validation

**(Doctrine: Cognitive Ease Test)**

Above the fold must answer:

* “Are my margins trustworthy?” → No
* “Why?” → Assumptions are unverifiable
* “What fixes this?” → MarginCore
* “Is it safe?” → Guardrails + versioning

If any require scrolling → redesign.

---

## Doctrine Compliance Checklist

| Requirement               | MarginCore             |
| ------------------------- | ---------------------- |
| One blocked decision      | ✅ Can I trust margins? |
| Blindness visualized      | ✅                      |
| Absence shown             | ✅                      |
| Cost of inaction explicit | ✅                      |
| One deterministic outcome | ✅                      |
| Guardrails emphasized     | ✅                      |
| No optimization hype      | ✅                      |
| Single CTA                | ✅                      |
| No-scroll clarity         | ✅                      |

---

## Why This Converts (Specifically for Finance)

MarginCore doesn’t sell:

* Higher profit
* Better pricing
* Optimization

It sells:

> **Margin legitimacy**

The merchant realizes:

> *“I might be approving decisions based on numbers I can’t verify.”*

At that point:

* Activation becomes **risk containment**
* Not activating becomes **financial negligence**

---

## Canonical MarginCore Principle

> **Profitability without verified assumptions is illusion.
> MarginCore removes illusion.**

Every finance-related UI must reinforce this.

---

## Final Sanity Test

Ask the merchant:

> **“If an order looks profitable today, can you explain why?”**

If the answer is “not exactly,”
MarginCore activation becomes inevitable.

---