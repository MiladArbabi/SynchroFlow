export interface OrderHealthInfoBlockProps {
    orders_at_sla_risk: number;
    aging_24h: number;
    aging_48h: number;
    aging_72h_plus: number;
    pending_fulfillment: number;
    pending_payment: number;
    exception_orders: number;
}
export declare function OrderHealthInfoBlock(props: OrderHealthInfoBlockProps): import("react/jsx-runtime").JSX.Element;
