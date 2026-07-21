export type EpistemicVisualTone = 'neutral' | 'warning' | 'uncertain' | 'error';
export type EpistemicVisualSignal = {
    display: string | null;
    tooltip?: string;
    tone?: EpistemicVisualTone;
    icon?: 'info' | 'warning' | 'alert' | 'lock';
};
