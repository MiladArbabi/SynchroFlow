export type FT2DistributionProps = {
    buckets: Array<{
        key: string;
        value: number | null;
    }> | null;
};
export declare function FT2Distribution({ buckets }: FT2DistributionProps): import("react/jsx-runtime").JSX.Element;
