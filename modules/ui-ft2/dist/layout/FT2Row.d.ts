import type { ReactNode } from 'react';
export type FT2RowIntent = 'kpi' | 'decision' | 'analysis' | 'support';
export type FT2RowProps = {
    children: ReactNode;
    intent: FT2RowIntent;
};
export declare function FT2Row({ children, intent }: FT2RowProps): import("react/jsx-runtime").JSX.Element;
