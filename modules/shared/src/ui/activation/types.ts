//modules/shared/src/ui/activation/types.ts

export type SemanticStatus =
  | 'unknown'
  | 'unverified'
  | 'not-visible'
  | 'insufficient-data';

export interface IdentityCopy {
  title: string;
  subtitle: string;
}

export interface BlindnessCopy {
  subject: string;
  dimension: string;
  status: SemanticStatus;
}

export interface AbsenceProofCopy {
  riskStatement: string;
}

export interface ValueAfterActivationCopy {
  outcome: string;
}

export interface PrimaryCTACopy {
  label: string;
  actionId: 'connect-store';
}

export interface TrustCopy {
  bullets: string[];
}

export interface PostActivationCopy {
  reflection: string;
}

export interface ActivationSurfaceProps {
  moduleId: string;

  identity?: IdentityCopy;

  blindness: BlindnessCopy;

  absenceProof?: AbsenceProofCopy;

  valueAfterActivation?: ValueAfterActivationCopy;

  primaryCTA: PrimaryCTACopy;

  trust: TrustCopy;

  postActivation?: PostActivationCopy;

  /** injected action handler */
  onAction?: (actionId: string) => void;
}
