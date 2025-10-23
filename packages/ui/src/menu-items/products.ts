// packages/ui/src/menu-items/products.ts
import { Package } from 'lucide-react'; // Use Package icon

const icons = {
    Package
};

const products = {
    id: 'products',
    title: 'Products',
    type: 'item',
    url: '/products',
    icon: icons.Package,
    breadcrumbs: false
};

export default products;