import { FT2RangeInput } from '../utils/ft2Period.js';
export type OrdersFt2Distribution = {
    totalOrders: number;
    minOrderValue: number | null;
    medianOrderValue: number | null;
    maxOrderValue: number | null;
    histogram: {
        bucketStart: number;
        bucketEnd: number;
        count: number;
    }[];
};
export declare function getOrderNexusFt2Distribution({ shopId, range, }: {
    shopId: number;
    range: FT2RangeInput;
}): Promise<OrdersFt2Distribution>;
