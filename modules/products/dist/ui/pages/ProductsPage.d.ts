export interface ProductsModuleProps {
    productCount: number | null;
    productHealthEvents: number | null;
    excludedProductCount: number | null;
    onIntent?: (intent: ProductsUiIntent) => void;
}
export type ProductsUiIntent = {
    type: 'START_ONBOARDING';
    taskId?: 'add-products' | 'complete-product-data' | 'review-product-readiness';
};
export default function ProductsModule(props: ProductsModuleProps): import("react/jsx-runtime").JSX.Element;
