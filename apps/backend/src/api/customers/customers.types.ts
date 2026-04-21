// apps/backend/src/api/customers/customers.types.ts

export interface CustomerOrder {
  id: string;
  orderDate: string;
  status: string;
  fulfillmentStatus: string;
  total: number;
  currency: string;
  paymentState: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  date: string;
  status: 'Pending' | 'Resolved' | 'Closed';
}