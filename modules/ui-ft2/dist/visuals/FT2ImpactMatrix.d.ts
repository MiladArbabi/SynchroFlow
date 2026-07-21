export type FT2ImpactCell = {
    x: string;
    y: string;
    value: number | null;
};
export type FT2ImpactMatrixProps = {
    xLabels: string[] | null;
    yLabels: string[] | null;
    cells: FT2ImpactCell[] | null;
};
export declare function FT2ImpactMatrix({ xLabels, yLabels, cells, }: FT2ImpactMatrixProps): import("react/jsx-runtime").JSX.Element;
