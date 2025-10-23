// packages/ui/src/menu-items/types.ts
import { LucideProps } from 'lucide-react';
import { ReactNode } from 'react';

// Interface for Chip properties (copied from NavItem)
interface ChipProps {
    color?: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
    variant?: 'filled' | 'outlined';
    size?: 'small' | 'medium';
    label?: string;
    avatar?: ReactNode;
}

// Interface for a single navigation item
export interface NavItemType {
    id: string;
    title: string; // Message ID or direct string
    type: 'item';
    url: string;
    link?: string; // Optional alternative if needed
    icon?: React.FC<LucideProps>; // Lucide icon component
    target?: boolean;
    disabled?: boolean;
    external?: boolean;
    breadcrumbs?: boolean;
    caption?: string; // Message ID or direct string
    chip?: ChipProps;
}

// Interface for a navigation group
export interface NavGroupType {
    id: string;
    title?: string; // Optional: Group title for display
    caption?: string; // Optional: Group caption
    type: 'group';
    icon?: React.FC<LucideProps>; 
    children?: (NavItemType | NavGroupType)[]; // Groups can contain items or nested groups
    // Groups might sometimes link directly in horizontal mode, but less common
    url?: string;
    target?: boolean;
    breadcrumbs?: boolean; // Usually applies to items within
}

// Union type for any menu item
export type MenuItem = NavItemType | NavGroupType;

// Structure for the main menuItems export
export interface MenuItems {
    items: NavGroupType[]; // Top level must be groups for MenuList
}