import React from 'react';
export type PulseTone = 'critical' | 'warning' | 'good' | 'neutral';
export interface PulseCardRowData {
    id: string;
    label: string;
    value: string | number;
    tone?: PulseTone;
    subtext?: string;
    subtextTone?: PulseTone;
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
    /**
     * Escape hatch for domain-specific colors with no tone equivalent
     * (e.g. pipeline-stage colors — see OrdersModuleFT2.tsx STAGE_COLORS,
     * tracked in B-08). Wins over TONE_COLOR[tone] for dot/bar/value color.
     * `tone` still governs severity-sort placement even when this is set.
     */
    colorOverride?: string;
}
export interface PulseCardHeadline {
    value: string;
    tone: PulseTone;
    subtext?: string;
    colorOverride?: string;
}
export interface PulseCardProps {
    title: string;
    headline?: PulseCardHeadline;
    rows: PulseCardRowData[];
    footerNote?: React.ReactNode;
    footerCta?: {
        label: string;
        onClick: () => void;
    };
    updatedAt?: string;
    onRefresh?: () => void;
    variant?: 'card' | 'embedded';
}
export declare function PulseCard({ title, headline, rows, footerNote, footerCta, updatedAt, onRefresh, variant }: PulseCardProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=PulseCard.d.ts.map