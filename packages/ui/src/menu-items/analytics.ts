// packages/ui/src/menu-items/analytics.ts
import { TrendingUp } from 'lucide-react'; 
import { NavItemType } from './types';

const icons = {
    TrendingUp
};

const analytics: NavItemType = {
    id: 'analytics',
    title: 'Analytics',
    type: 'item',
    url: '/analytics',
    icon: icons.TrendingUp,
    breadcrumbs: false
};

export default analytics;