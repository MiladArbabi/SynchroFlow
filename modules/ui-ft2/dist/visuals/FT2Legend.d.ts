export type FT2LegendItem = {
    label: string;
};
export type FT2LegendProps = {
    items: FT2LegendItem[] | null;
};
/**
 * FT2Legend
 * ---------
 * Categorical context only.
 * Never instructional. Never semantic.
 */
export declare function FT2Legend({ items }: FT2LegendProps): import("react/jsx-runtime").JSX.Element | null;
