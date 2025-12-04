// apps/frontend/src/menu-items/finances.ts
import { DollarSign } from 'lucide-react'; 
import { NavItemType } from './types';

const finances: NavItemType = {
    id: 'finances',
    title: 'Finances',
    type: 'item',
    url: '/finances',
    icon: DollarSign,
    breadcrumbs: false
};

export default finances;