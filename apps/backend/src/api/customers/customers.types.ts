// packages/api/src/api/customers/customers.types.ts

// Copied from Customer360Page.tsx
export interface CustomerOrder {
  id: string;
  orderDate: string;
  status: string;
  total: number;
}

export interface SupportTicket {
  id: string;
  subject: string;
  date: string;
  status: 'Pending' | 'Resolved' | 'Closed';
}