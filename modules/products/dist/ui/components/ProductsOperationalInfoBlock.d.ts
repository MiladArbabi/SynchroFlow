type ProductsOperationalInfoBlockProps = {
    inventory: 'ok' | 'gaps' | 'unknown' | null;
    fulfillment: 'visible' | 'missing' | 'unknown' | null;
    stability: 'stable' | 'fragile' | 'unknown' | null;
};
export declare function ProductsOperationalInfoBlock({ inventory, fulfillment, stability, }: ProductsOperationalInfoBlockProps): import("react/jsx-runtime").JSX.Element;
export {};
