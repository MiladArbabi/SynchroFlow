# ActivationSurface — **UI Contract v1.0 (LOCKED)**

This contract defines **structure, hierarchy, and responsibilities**.
It is **not styling**, **not copy**, **not animation**.

If something is not here, it **does not exist**.

---

## 1. High-Level Mental Model

**ActivationSurface = One-page operational decision screen**

* One column
* One decision
* No distractions
* Above-the-fold truth
* Below-the-fold certainty

---

## 2. Canonical React Component Tree

```tsx
<ActivationSurface>
  <ActivationFrame>

    <ActivationHeader>
      <ModuleIdentity />
    </ActivationHeader>

    <ActivationBody>

      <BlindnessBlock />              // REQUIRED
      <IgnoranceVisualization />     // REQUIRED
      <AbsenceProof />               // REQUIRED
      <IrreversibleTruth />          // REQUIRED

      <ValueAfterActivation />       // REQUIRED

      <PrimaryAction />              // REQUIRED
      <TrustStrip />                 // REQUIRED

      <CommitmentGradient />         // OPTIONAL
      <PostActivationExpectation />  // OPTIONAL

    </ActivationBody>

  </ActivationFrame>
</ActivationSurface>
```

This tree is **final**.

---

## 3. Component Responsibilities (Non-Negotiable)

### `<ActivationSurface />`

* Root semantic wrapper
* Handles **no logic**
* Handles **no routing**
* Theme-aware only (light/dark background tokens)

---

### `<ActivationFrame />`

* Centers content
* Max width (e.g. 720–840px)
* Vertical rhythm container
* No grid, no sidebars

Purpose:

> Prevents dashboard-thinking. This is not an app screen.

---

### `<ActivationHeader />`

Contains:

```tsx
<ModuleIdentity />
```

#### `<ModuleIdentity />`

* Module name
* Optional icon
* No slogans
* No benefits
* No verbs

Example (Orders):

```
Orders
```

That’s it.

---

## 4. Core Decision Stack (MANDATORY)

These must appear **in this exact order**.

### `<BlindnessBlock />`

* One sentence
* Operational truth
* No “you”
* No future promises

This is the **emotional anchor**.

---

### `<IgnoranceVisualization />`

* Static
* Read-only
* Preformatted
* Looks like data but isn’t interactive

Purpose:

> Makes ignorance visible without explanation.

---

### `<AbsenceProof />`

* One sentence
* Counterfactual absence
* Never framed as gain

Purpose:

> Forces awareness of what is *missing*, not what is possible.

---

### `<IrreversibleTruth />`

* Time-based inevitability
* Neutral tone
* No urgency tricks

Purpose:

> Makes inaction an active choice.

---

### `<ValueAfterActivation />`

* Exactly one outcome
* Deterministic
* Verifiable by system

Purpose:

> Removes ambiguity about what changes.

---

## 5. Conversion Zone (LOCKED)

### `<PrimaryAction />`

Contains:

```tsx
<PrimaryCTAButton />
```

Rules:

* One button
* One label
* One action
* No secondary CTAs
* No links

---

### `<TrustStrip />`

* Immediately below CTA
* Smaller typography
* Bullet or dot-separated facts

Rules:

* No persuasion
* No testimonials
* No numbers unless factual
* No adjectives

Purpose:

> Intercept hesitation, not create desire.

---

## 6. Optional Deepening (Strictly Controlled)

These render **only if real UX exists**.

### `<CommitmentGradient />`

* Steps that reduce uncertainty
* No progress bars
* No “Step 1 of 3” framing

Purpose:

> Reduces fear, not increases motivation.

---

### `<PostActivationExpectation />`

* What happens *after click*
* No time promises unless guaranteed
* No marketing language

Purpose:

> Prevents post-click anxiety.

---

## 7. Theme Contract (Light / Dark)

The UI **must not define colors directly**.

It consumes tokens only:

```ts
activation.background
activation.surface
activation.text.primary
activation.text.secondary
activation.border.subtle
activation.accent.primary
activation.trust.muted
```

Rules:

* Dark mode ≠ inverted light mode
* No gradients required
* No illustrations required
* Calm > impressive

---

## 8. What This UI Explicitly Forbids

❌ Sidebars
❌ Tabs
❌ Feature lists
❌ Empty states
❌ Dashboards
❌ Charts
❌ Tooltips
❌ “Learn more”
❌ Gamification
❌ Persuasive animations

If someone asks “can we add…”
The answer is **no by default**.

---

## 9. Why This Contract Works

This structure ensures:

* Every module feels consistent
* Every activation feels inevitable
* No module competes on aesthetics
* Copy does the work, not visuals
* Engineering stays simple
* Product integrity stays intact

This is **not a landing page system**.
This is **operational honesty UI**.

---

## 10. Status

**UI CONTRACT STATUS:** 🔒 **LOCKED**

Next allowed steps:

* Implement shared layout components
* Map OrderNexus content into this tree
* Snapshot test structure (not styles)

Next **not allowed** steps:

* Styling debates
* Animation discussions
* Visual polish
* Copy rewrites

---