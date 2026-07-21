import { jsx as _jsx } from "react/jsx-runtime";
// modules/products/src/ui/pages/ProductsPage.tsx
import { useProductsFt1Scenario } from '../hooks/useProductsFt1Scenario.js';
import { ProductsDiagnosticCard } from '../components/ProductsDiagnosticCard.js';
export default function ProductsModule(props) {
    const scenario = useProductsFt1Scenario({
        productCount: props.productCount,
        productHealthEvents: props.productHealthEvents,
        excludedProductCount: props.excludedProductCount,
    });
    const emitStartOnboarding = (taskId) => {
        props.onIntent?.({
            type: 'START_ONBOARDING',
            taskId,
        });
    };
    switch (scenario) {
        case 'NO_PRODUCTS':
            return (_jsx(ProductsDiagnosticCard, { testId: "products-ft1-no-products", title: "No products available", message: "Products analyzes product health and risk. To begin, you need products in your catalog.", ctaLabel: props.onIntent ? 'Add products' : undefined, onCtaClick: props.onIntent
                    ? () => emitStartOnboarding('add-products')
                    : undefined }));
        case 'PRODUCT_DATA_INCOMPLETE':
            return (_jsx(ProductsDiagnosticCard, { testId: "products-ft1-incomplete", title: "Product data incomplete", message: "Your products are detected, but required data is missing. Until this is completed, product health and risk signals can\u2019t be trusted.", ctaLabel: props.onIntent ? 'Complete product data' : undefined, onCtaClick: props.onIntent
                    ? () => emitStartOnboarding('complete-product-data')
                    : undefined }));
        case 'PARTIALLY_READY':
            return (_jsx(ProductsDiagnosticCard, { testId: "products-ft1-partial", title: "Product health partially available", message: "Products can analyze some products, but others are excluded due to missing or unreliable data. Completing setup improves coverage.", ctaLabel: props.onIntent ? 'Review excluded products' : undefined, onCtaClick: props.onIntent
                    ? () => emitStartOnboarding('review-product-readiness')
                    : undefined }));
        case 'HEALTHY':
            return (_jsx(ProductsDiagnosticCard, { testId: "products-ft1-healthy", title: "Products are ready", message: "Your product catalog is ready for health and risk analysis. SKU-level intelligence is now available." }));
    }
}
//# sourceMappingURL=ProductsPage.js.map