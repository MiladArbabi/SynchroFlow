export type FT2TimeSeriesPoint = {
    x: string;
    y: number | null;
};
export type FT2TimeSeriesProps = {
    points: FT2TimeSeriesPoint[] | null;
};
export declare function FT2TimeSeries({ points }: FT2TimeSeriesProps): import("react/jsx-runtime").JSX.Element;
