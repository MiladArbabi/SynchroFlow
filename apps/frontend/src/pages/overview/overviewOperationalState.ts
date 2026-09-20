// apps/frontend/src/pages/overview/overviewOperationalState.ts
//
// OVERVIEW-LIVE-MAP-01 Slice A — pure Overview-owned operational-state model.
//
// Resolves the merchant-facing operational state for a single live-map object
// from one or more independently observed candidate signals. Contains no
// navigation, React, network, alert creation, timer/SLA inference, or Ops
// Console logic — those concerns belong to later Overview wiring slices.

export type OverviewOperationalState =
  | 'neutral'
  | 'active'
  | 'healthy'
  | 'stale'
  | 'warning'
  | 'critical';

// Highest-priority state wins. Index position is priority rank (higher = wins).
const STATE_PRECEDENCE: readonly OverviewOperationalState[] = [
  'neutral',
  'healthy',
  'active',
  'stale',
  'warning',
  'critical',
];

function statePriority(state: OverviewOperationalState): number {
  return STATE_PRECEDENCE.indexOf(state);
}

export interface OverviewOperationalSignal {
  /** Merchant-facing operational state this signal contributes, if triggered. */
  readonly state: OverviewOperationalState;
}

/**
 * Combines candidate operational signals for one map object and deterministically
 * returns the highest-priority resulting state. No signals resolves to 'neutral'.
 */
export function resolveOverviewOperationalState(
  signals: readonly OverviewOperationalSignal[]
): OverviewOperationalState {
  let resolved: OverviewOperationalState = 'neutral';

  for (const signal of signals) {
    if (statePriority(signal.state) > statePriority(resolved)) {
      resolved = signal.state;
    }
  }

  return resolved;
}

/** A pending stow task alone resolves to 'active', never a higher-severity state. */
export function pendingStowSignal(): OverviewOperationalSignal {
  return { state: 'active' };
}

/** A receive-at-dock task alone resolves to 'active', never a higher-severity state. */
export function receiveAtDockSignal(): OverviewOperationalSignal {
  return { state: 'active' };
}

/** Stale operator activity alone resolves to 'stale', never 'critical'. */
export function staleOperatorActivitySignal(): OverviewOperationalSignal {
  return { state: 'stale' };
}

/** A canonical location-bound exception alone can resolve to 'critical'. */
export function locationBoundExceptionSignal(): OverviewOperationalSignal {
  return { state: 'critical' };
}

/** Live operator work alone resolves to 'active', never a higher-severity state. */
export function activeWorkSignal(): OverviewOperationalSignal {
  return { state: 'active' };
}

/** A completed pipeline stage (e.g. shipped) alone resolves to 'healthy'. */
export function healthyCompletionSignal(): OverviewOperationalSignal {
  return { state: 'healthy' };
}

// ─── OVERVIEW-LIVE-MAP-01 Slice B — projection helpers ─────────────────────
//
// PROJECTION ONLY. These derive the operational state Overview already owns
// from already-wired data; they do not decide rendering, thresholds, or
// alerting. All multi-signal resolution goes through
// resolveOverviewOperationalState() above — no precedence logic is
// duplicated here or in the page.

export interface LocationOperationalInputs {
  readonly hasOpenProblem: boolean;
  readonly hasLiveOperatorActivity: boolean;
  readonly hasStaleOperatorActivity: boolean;
  readonly hasPendingStow: boolean;
  readonly hasReceiveAtDock: boolean;
}

/** Derives a single physical location's operational state from independently observed signals. */
export function deriveLocationOperationalState(
  inputs: LocationOperationalInputs
): OverviewOperationalState {
  const signals: OverviewOperationalSignal[] = [];

  if (inputs.hasOpenProblem) signals.push(locationBoundExceptionSignal());
  if (inputs.hasStaleOperatorActivity) signals.push(staleOperatorActivitySignal());
  if (inputs.hasLiveOperatorActivity) signals.push(activeWorkSignal());
  if (inputs.hasPendingStow) signals.push(pendingStowSignal());
  if (inputs.hasReceiveAtDock) signals.push(receiveAtDockSignal());

  return resolveOverviewOperationalState(signals);
}

export type OverviewSyntheticStationId = 'blocked' | 'pool' | 'staged' | 'shipped';

export interface StationOperationalInputs {
  readonly id: string;
  readonly count: number;
}

/**
 * Derives a synthetic station's operational state from its current count.
 * Existing station `tone` (visual) is a separate, unrelated concern and is
 * never read here — see OVERVIEW-LIVE-MAP-01 Slice B "staged" note.
 */
export function deriveStationOperationalState(
  inputs: StationOperationalInputs
): OverviewOperationalState {
  if (inputs.count <= 0) return 'neutral';

  switch (inputs.id as OverviewSyntheticStationId) {
    case 'blocked':
      return resolveOverviewOperationalState([locationBoundExceptionSignal()]);
    case 'pool':
      return resolveOverviewOperationalState([activeWorkSignal()]);
    case 'staged':
      return resolveOverviewOperationalState([activeWorkSignal()]);
    case 'shipped':
      return resolveOverviewOperationalState([healthyCompletionSignal()]);
    default:
      return 'neutral';
  }
}

// ─── OVERVIEW-LIVE-MAP-01 Slice D — explainability presentation ────────────
//
// PRESENTATION ONLY, still pure and deterministic. Answers "what is
// happening here, and why is this area this colour?" for one map object.
// Reuses deriveLocationOperationalState / deriveStationOperationalState
// above for state — never re-derives precedence — and adds merchant-worded
// badge/reason/work/impact/recency on top of the same canonical inputs.
// Kept clock-free: any "N min ago" formatting is the caller's existing
// hover-recency formatter, passed in here already formatted, so this stays
// testable without mocking time.

/** The single merchant-facing badge a map object may show. At most one — never a list. */
export interface OverviewOperationalBadge {
  readonly label: string;
  readonly count?: number;
}

/** Explains one already-resolved operational state: why it is what it is, and what a merchant would ask next. */
export interface OverviewOperationalPresentation {
  readonly state: OverviewOperationalState;
  readonly primaryBadge: OverviewOperationalBadge | null;
  readonly reason: string;
  readonly workLines: readonly string[];
  readonly impactLines: readonly string[];
  readonly recencyLine?: string;
  /**
   * OVERVIEW-LIVE-MAP-01 Slice D.1 — whether the object's separate identity
   * label should also render. Locations have no identity label today so
   * this is meaningful for stations only; undefined lets the renderer keep
   * its pre-Slice-D.1 default (identity always shown).
   */
  readonly showIdentityLabel?: boolean;
}

export interface LocationPresentationInputs {
  readonly problemCount: number;
  readonly operatorCount: number;
  readonly staleOperatorCount: number;
  /** Units, not tasks — see deriveLocationOperationalState's hasPendingStow note. */
  readonly stowUnits: number;
  /** Units physically at the dock. */
  readonly dockUnits: number;
  /**
   * Pre-formatted by the caller's existing recency formatter (e.g. "4m ago").
   * Kept as a string, not a timestamp, so this function needs no clock.
   */
  readonly recencyText?: string;
}

/**
 * Derives one physical location's full explainability presentation.
 * Badge/reason precedence matches deriveLocationOperationalState's signal
 * priority exactly (critical > stale > active > healthy > neutral), and
 * picks the single most actionable reason within a tied state: an open
 * problem outranks everything, stale activity outranks live activity
 * (a merchant needs to know work stalled before being told work is
 * happening), and among active-only signals, a live operator is more
 * actionable than a queued unit count.
 */
export function deriveLocationOperationalPresentation(
  inputs: LocationPresentationInputs
): OverviewOperationalPresentation {
  const state = deriveLocationOperationalState({
    hasOpenProblem: inputs.problemCount > 0,
    hasLiveOperatorActivity: inputs.operatorCount > 0,
    hasStaleOperatorActivity: inputs.staleOperatorCount > 0,
    hasPendingStow: inputs.stowUnits > 0,
    hasReceiveAtDock: inputs.dockUnits > 0,
  });

  const issueWord = inputs.problemCount === 1 ? 'issue' : 'issues';

  let primaryBadge: OverviewOperationalBadge | null = null;
  let reason = 'No active work';
  if (inputs.problemCount > 0) {
    primaryBadge = { label: `${inputs.problemCount} ${issueWord}`, count: inputs.problemCount };
    reason = 'Open warehouse issue';
  } else if (inputs.staleOperatorCount > 0) {
    primaryBadge = { label: `${inputs.staleOperatorCount} stale`, count: inputs.staleOperatorCount };
    reason = 'Operator activity has gone stale';
  } else if (inputs.operatorCount > 0) {
    primaryBadge = { label: `${inputs.operatorCount} active`, count: inputs.operatorCount };
    reason = 'Operators active';
  } else if (inputs.stowUnits > 0) {
    primaryBadge = { label: `${inputs.stowUnits} to stow`, count: inputs.stowUnits };
    reason = 'Awaiting stow';
  } else if (inputs.dockUnits > 0) {
    primaryBadge = { label: `${inputs.dockUnits} at dock`, count: inputs.dockUnits };
    reason = 'At receiving dock';
  }

  const workLines: string[] = [];
  if (inputs.operatorCount > 0) {
    workLines.push(`${inputs.operatorCount} ${inputs.operatorCount === 1 ? 'operator' : 'operators'} active`);
  }
  if (inputs.stowUnits > 0) workLines.push(`${inputs.stowUnits} units awaiting stow`);
  if (inputs.dockUnits > 0) workLines.push(`${inputs.dockUnits} units at receiving dock`);

  const impactLines: string[] = [];
  if (inputs.problemCount > 0) impactLines.push(`${inputs.problemCount} open ${issueWord}`);

  return {
    state,
    primaryBadge,
    reason,
    workLines,
    impactLines,
    recencyLine: inputs.recencyText ? `Last activity ${inputs.recencyText}` : undefined,
  };
}

const STATION_BADGE_LABEL: Record<OverviewSyntheticStationId, (count: number) => string> = {
  // Slice D.1: explicit noun, never the bare "N blocked" the live-browser
  // review flagged as ambiguous next to the identity plate.
  blocked: (n) => `${n} blocked ${n === 1 ? 'order' : 'orders'}`,
  pool: (n) => `${n} ready`,
  staged: (n) => `${n} awaiting pickup`,
  shipped: (n) => `${n} shipped`,
};

const STATION_REASON: Record<OverviewSyntheticStationId, string> = {
  blocked: 'Blocked orders need attention',
  pool: 'Orders ready for release',
  staged: 'Packed orders awaiting pickup',
  shipped: 'Orders shipped today',
};

/**
 * OVERVIEW-LIVE-MAP-01 Slice D.1 — whether a station's separate identity
 * plate adds information beyond its primary badge. 'pool' keeps both: "N
 * ready" answers "how many", "Order Pool" answers "what is this apron" — two
 * different questions. The other three stations' identity wording ("Blocked",
 * "Awaiting pickup", "Shipped from floor") just repeats what the primary
 * badge already says, so their identity plate is redundant and suppressed.
 */
const STATION_SHOW_IDENTITY: Record<OverviewSyntheticStationId, boolean> = {
  blocked: false,
  pool: true,
  staged: false,
  shipped: false,
};

/**
 * Derives one synthetic station's full explainability presentation.
 * Never reads the station's legacy `tone` — matches
 * deriveStationOperationalState exactly, so a hardcoded `tone: 'critical'`
 * (e.g. 'staged') can never leak into the badge or reason here.
 */
export function deriveStationOperationalPresentation(
  inputs: StationOperationalInputs
): OverviewOperationalPresentation {
  const state = deriveStationOperationalState(inputs);

  if (state === 'neutral') {
    // No primary message exists to make identity redundant with.
    return {
      state,
      primaryBadge: null,
      reason: 'No active work',
      workLines: [],
      impactLines: [],
      showIdentityLabel: true,
    };
  }

  const key = inputs.id as OverviewSyntheticStationId;
  const label = (STATION_BADGE_LABEL[key] ?? ((n: number) => `${n}`))(inputs.count);
  const reason = STATION_REASON[key] ?? 'Active work';

  return {
    state,
    primaryBadge: { label, count: inputs.count },
    reason,
    // A critical station's single fact is framed as impact (what it costs
    // the merchant), everything else as work (what is in motion).
    workLines: state === 'critical' ? [] : [label],
    impactLines: state === 'critical' ? [label] : [],
    showIdentityLabel: STATION_SHOW_IDENTITY[key] ?? true,
  };
}
