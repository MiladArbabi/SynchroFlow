// apps/frontend/src/menu-items/dashboard.ts
import { LayoutDashboard } from 'lucide-react'; 
import { NavItemType } from './types';

// Define icon map
const icons = {
    LayoutDashboard
};

// Define menu item
const dashboard: NavItemType = {
    id: 'dashboard', // Matches routes.tsx key
    title: 'Dashboard', // Matches routes.tsx name
    type: 'item', // Changed from 'collapse' to 'item' as it's a direct link
    url: '/dashboard', // Matches routes.tsx route
    icon: icons.LayoutDashboard, // Use lucide icon
    breadcrumbs: false // Default breadcrumbs setting
};

export default dashboard;