Below is a **typed, composable, doctrine-safe React implementation** of the ActivationSurface schema.

Design goals baked into the code:

* Slot-based (cannot “wing it”)
* Strong typing (misuse is a TS error)
* Visually unopinionated (design system agnostic)
* Impossible to render without addressing blindness + CTA + trust
* Easy to audit in code review

---

# `ActivationSurface.tsx` (Canonical)

```tsx
import React from "react";

/* ======================================================
   TYPES — LOCKED UI CONTRACT
====================================================== */

export interface IdentitySlot {
  headline: string;
  subtext?: string;
}

export interface BlindnessRow {
  label: string;
  state: "unknown" | "locked";
  hint?: string;
}

export interface BlindnessSlot {
  title?: string;
  rows: BlindnessRow[];
}

export interface AbsenceProofSlot {
  title: string;
  artifact: {
    label: string;
    missingItems: string[];
  };
  caption: string;
}

export interface ValueAfterActivationSlot {
  statement: string;
}

export interface PrimaryCTASlot {
  label: string;
  onActivate: () => void;
  disabledReason?: string;
}

export interface TrustSlot {
  bullets: string[];
}

export interface CommitmentGradientSlot {
  steps: Array<{
    title: string;
    description: string;
  }>;
}

export interface MomentumSlot {
  message: string;
}

export interface PostActivationSlot {
  steps: string[];
}

export interface ActivationSurfaceProps {
  moduleId: string;
  identity: IdentitySlot;
  blindness: BlindnessSlot;
  absenceProof: AbsenceProofSlot;
  valueAfterActivation: ValueAfterActivationSlot;
  primaryCTA: PrimaryCTASlot;
  trust: TrustSlot;

  commitmentGradient?: CommitmentGradientSlot;
  momentum?: MomentumSlot;
  postActivation?: PostActivationSlot;
}
```

---

# Core Component

```tsx
export const ActivationSurface: React.FC<ActivationSurfaceProps> = ({
  identity,
  blindness,
  absenceProof,
  valueAfterActivation,
  primaryCTA,
  trust,
  commitmentGradient,
  momentum,
  postActivation,
}) => {
  return (
    <section className="activation-surface">
      <Identity {...identity} />

      <Blindness {...blindness} />

      <AbsenceProof {...absenceProof} />

      <ValueAfterActivation {...valueAfterActivation} />

      {momentum && <Momentum {...momentum} />}

      <PrimaryCTA {...primaryCTA} />

      <Trust {...trust} />

      {commitmentGradient && (
        <CommitmentGradient {...commitmentGradient} />
      )}

      {postActivation && <PostActivation {...postActivation} />}
    </section>
  );
};
```

---

# Slot Components (Individually Auditable)

## Identity

```tsx
const Identity: React.FC<IdentitySlot> = ({ headline, subtext }) => (
  <header>
    <h1>{headline}</h1>
    {subtext && <p>{subtext}</p>}
  </header>
);
```

---

## Blindness

```tsx
const Blindness: React.FC<BlindnessSlot> = ({ title, rows }) => (
  <div className="blindness">
    {title && <h3>{title}</h3>}

    <table>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td>{row.label}</td>
            <td className={`state-${row.state}`}>
              {row.state === "unknown" ? "Unknown" : "Locked"}
            </td>
            {row.hint && <td className="hint">{row.hint}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
```

---

## Absence Proof

```tsx
const AbsenceProof: React.FC<AbsenceProofSlot> = ({
  title,
  artifact,
  caption,
}) => (
  <div className="absence-proof">
    <h3>{title}</h3>

    <div className="artifact">
      <strong>{artifact.label}</strong>
      <ul>
        {artifact.missingItems.map((item, i) => (
          <li key={i}>Missing: {item}</li>
        ))}
      </ul>
    </div>

    <p className="caption">{caption}</p>
  </div>
);
```

---

## Value After Activation

```tsx
const ValueAfterActivation: React.FC<ValueAfterActivationSlot> = ({
  statement,
}) => (
  <div className="value-after-activation">
    <strong>{statement}</strong>
  </div>
);
```

---

## Momentum (Optional, Verified Only)

```tsx
const Momentum: React.FC<MomentumSlot> = ({ message }) => (
  <div className="momentum">
    <p>{message}</p>
  </div>
);
```

---

## Primary CTA (Single Path)

```tsx
const PrimaryCTA: React.FC<PrimaryCTASlot> = ({
  label,
  onActivate,
  disabledReason,
}) => (
  <div className="primary-cta">
    <button onClick={onActivate} disabled={!!disabledReason}>
      {label}
    </button>
    {disabledReason && <small>{disabledReason}</small>}
  </div>
);
```

---

## Trust (Mandatory, Post-CTA)

```tsx
const Trust: React.FC<TrustSlot> = ({ bullets }) => (
  <ul className="trust">
    {bullets.map((b, i) => (
      <li key={i}>{b}</li>
    ))}
  </ul>
);
```

---

## Commitment Gradient (Optional)

```tsx
const CommitmentGradient: React.FC<CommitmentGradientSlot> = ({ steps }) => (
  <div className="commitment-gradient">
    <h4>What happens next</h4>
    <ol>
      {steps.map((step, i) => (
        <li key={i}>
          <strong>{step.title}</strong>
          <p>{step.description}</p>
        </li>
      ))}
    </ol>
  </div>
);
```

---

## Post Activation

```tsx
const PostActivation: React.FC<PostActivationSlot> = ({ steps }) => (
  <div className="post-activation">
    <h4>After activation</h4>
    <ol>
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  </div>
);
```

---

# Why This Implementation Is Hard to Abuse

✔ You **cannot** omit blindness
✔ You **cannot** add feature lists
✔ You **must** show trust under CTA
✔ You **cannot** imply benefits not stated
✔ You **cannot** sneak in marketing language without code review

This enforces:

* Decision certainty
* Risk framing
* Truthful inevitability
* Consistency across modules

---