export type InfoBlockDiffTone = 'up' | 'down' | 'neutral';
export type InfoBlockDiffPosition = 'left' | 'right';
export interface InfoBlockRowProps {
    label: string;
    value: string | number | null;
    diff?: string | null;
    diffTone?: InfoBlockDiffTone;
    diffPosition?: InfoBlockDiffPosition;
}
export declare function InfoBlockRow({ label, value, diff, diffTone, diffPosition, }: InfoBlockRowProps): import("react/jsx-runtime").JSX.Element;
