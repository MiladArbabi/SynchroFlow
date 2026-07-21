export type FT2TextProps = {
    children: React.ReactNode;
    align?: 'left' | 'center' | 'right';
};
/**
 * FT2Text
 * -------
 * Non-KPI prose inside FT2 surfaces.
 *
 * Rules:
 * - Observational only
 * - No emphasis, no decoration
 * - Must not compete with KPI values
 * - Typography is locked to FT2 tokens
 */
export declare function FT2Text({ children, align, }: FT2TextProps): import("react/jsx-runtime").JSX.Element;
