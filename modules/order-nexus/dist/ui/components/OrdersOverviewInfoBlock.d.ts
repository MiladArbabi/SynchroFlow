type OrdersOverviewInfoBlockProps = {
    span?: number;
    orders: {
        total: number | null;
        fulfilled: number | null;
        unfulfilled: number | null;
        constrained: number | null;
    };
};
export declare function OrdersOverviewInfoBlock({ span, orders, }: OrdersOverviewInfoBlockProps): import("react/jsx-runtime").JSX.Element;
export {};
