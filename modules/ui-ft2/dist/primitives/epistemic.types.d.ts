export type EpistemicTone = 'neutral' | 'warning' | 'error' | 'info';
export type EpistemicIcon = 'check' | 'warning' | 'alert' | 'info';
export interface EpistemicVisualSignal {
    display: string;
    tooltip?: string;
    tone: EpistemicTone;
    icon?: EpistemicIcon;
}
