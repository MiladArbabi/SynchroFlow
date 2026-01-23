export interface InventoryItem {
    id: number;
    shop_id: number;
    sku: string;
    description: string | null;
    quantity_available: number;
    price: string;
    warehouse_location: string | null;
    created_at: string;
    updated_at: string;
}
export interface User {
    id: number;
    email: string;
    password_hash: string;
    first_name?: string;
    last_name?: string;
    shop_id?: number;
    created_at: string;
    updated_at: string;
    preferred_mode?: 'survival' | 'growth' | 'architect';
    detected_mode?: 'survival' | 'growth' | 'architect';
    shopify_connected?: boolean;
    stripe_connected?: boolean;
    first_insight_delivered?: boolean;
}
export interface UserMilestone {
    id: number;
    user_id: number;
    milestone: string;
    achieved_at: string;
}
export type PublicUser = Omit<User, 'password_hash'>;
