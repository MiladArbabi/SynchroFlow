import * as React from 'react';
/**
 * PriorityStack
 * -------------
 * Semantic ordered list.
 * Ordering MUST match backend.
 * No client-side sorting allowed.
 */
export declare const PriorityStack: React.FC<{
    items: {
        order_id: string;
        order_health_score: number;
    }[];
}>;
