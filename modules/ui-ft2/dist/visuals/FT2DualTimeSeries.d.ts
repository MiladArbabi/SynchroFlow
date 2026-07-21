export type FT2DualTimeSeriesProps = {
    left: Array<{
        date: string;
        value: number | null;
    }> | null;
    right: Array<{
        date: string;
        value: number | null;
    }> | null;
};
export declare function FT2DualTimeSeries({ left, right, }: FT2DualTimeSeriesProps): import("react/jsx-runtime").JSX.Element;
