export type FT2ScatterPoint = {
    x: number | null;
    y: number | null;
};
export type FT2ScatterProps = {
    points: FT2ScatterPoint[] | null;
    xLabel?: string;
    yLabel?: string;
};
export declare function FT2Scatter({ points, xLabel, yLabel, }: FT2ScatterProps): import("react/jsx-runtime").JSX.Element;
