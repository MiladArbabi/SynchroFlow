//packages/api/src/services/koreSearch.ts
import db from '../db';

// Define the shape of a search result
interface SearchResult {
  type: 'customer' | 'order' | 'product';
  id: string | number;
  title: string;
  description: string;
  url: string;
}

/**
 * Searches the database for entities (customers, orders, products)
 * that match the query.
 * @param query The user's search query
 */
export const federatedSearch = async (query: string): Promise<SearchResult[]> => {
  const results: SearchResult[] = [];
  const searchTerm = `%${query.toLowerCase()}%`;

  // --- 1. Search Customers (Users) ---
  // We search by email or name
  const customers = await db('users')
    .select('id', 'email', 'first_name', 'last_name')
    .where(db.raw('lower(email) like ?', [searchTerm]))
    // .orWhere(knex.raw('lower(first_name) like ?', [searchTerm]))
    // .orWhere(knex.raw('lower(last_name) like ?', [searchTerm]))
    .limit(5);

  for (const customer of customers) {
    results.push({
      type: 'customer',
      id: customer.id,
      title: customer.email, // Our test expects the email
      description: `Customer: ${customer.first_name || ''} ${customer.last_name || ''}`,
      url: `/customers/${customer.id}`,
    });
  }

  // --- 2. Search Orders (In the future) ---
  // const orders = await knex('orders')
  //   .select('id', 'order_number')
  //   .where(knex.raw('lower(order_number) like ?', [searchTerm]))
  //   .limit(5);
  // ... map and push order results

  // --- 3. Search Products (In the future) ---
  // ...

  return results;
};