import * as React from 'react';
/**
 * PriorityStackItem
 * -----------------
 * One ranked order.
 * Must not alter backend ordering.
 */
export declare const PriorityStackItem: React.FC<{
    index: number;
    orderId: string;
    score: number;
    children?: React.ReactNode;
}>;
