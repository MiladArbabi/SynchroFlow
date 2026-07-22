export type PulseTone = 'critical' | 'warning' | 'good' | 'neutral';
export interface PulseCardRowData {
    id: string;
    label: string;
    value: string | number;
    tone?: PulseTone;
    subtext?: string;
    progress?: {
        value: number;
        max: number;
    };
    action?: {
        label: string;
        onClick: () => void;
    };
    onClick?: () => void;
    group?: string;
}
export interface PulseCardHeadline {
    value: string;
    tone: PulseTone;
    subtext?: string;
}
export interface PulseCardProps {
    title: string;
    headline?: PulseCardHeadline;
    rows: PulseCardRowData[];
    footerCta?: {
        label: string;
        onClick: () => void;
    };
    updatedAt?: string;
    onRefresh?: () => void;
}
export declare function PulseCard({ title, headline, rows, footerCta, updatedAt, onRefresh }: PulseCardProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=PulseCard.d.ts.map