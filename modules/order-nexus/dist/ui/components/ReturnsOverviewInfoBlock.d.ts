import type { EpistemicValue } from '@lasyncro/epistemic';
type ReturnsOverviewInfoBlockProps = {
    returnedRevenue: EpistemicValue<number>;
    returnedUnits: number | null;
    affectedOrders: number | null;
};
export declare function ReturnsOverviewInfoBlock({ returnedRevenue, returnedUnits, affectedOrders, }: ReturnsOverviewInfoBlockProps): import("react").JSX.Element;
export {};
