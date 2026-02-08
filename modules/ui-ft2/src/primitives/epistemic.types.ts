export type EpistemicTone =
  | 'neutral'    // KNOWN
  | 'warning'    // INCOMPLETE
  | 'error'      // UNKNOWN
  | 'info';      // meta / explanatory

export type EpistemicIcon =
  | 'check'
  | 'warning'
  | 'alert'
  | 'info';

export interface EpistemicVisualSignal {
  display: string;
  tooltip?: string;
  tone: EpistemicTone;
  icon?: EpistemicIcon;
}