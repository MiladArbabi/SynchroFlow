/* eslint-disable @typescript-eslint/no-explicit-any */
//apps/frontend/src/components/OpsCommandCenter/naturalLanguage/entityExtractor.ts
import { EntityMap } from './types';

// --- Entity Extractor Functions ---
// Each function searches the query for one specific type of entity.

// --- A robust status extractor ---
const extractStatus = (query: string): string | null => {
  const statuses = [
    'pending',
    'fulfilled',
    'unfulfilled',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
  ];

  let firstMatch: string | null = null;
  let firstIndex = Infinity;

  for (const status of statuses) {
    const index = query.indexOf(status);
    // If we found a match AND it appears earlier than any previous match
    if (index !== -1 && index < firstIndex) {
      firstIndex = index;
      firstMatch = status;
    }
  }
  return firstMatch;
};

const extractDate = (query: string): string | null => {
  if (query.includes('yesterday')) return 'yesterday';
  if (query.includes('today')) return 'today';
  if (query.includes('last week')) return 'last_week';
  if (query.includes('last month')) return 'last_month';
  
  // Simple date format like 01/25/2025 (US-centric for now)
  const dateMatch = query.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
  return dateMatch ? dateMatch[1] : null;
};

const extractOrderId = (query: string): string | null => {
  // Use 'i' flag for case-insensitivity on 'order'
  const orderMatch = query.match(/(?:order|#)?\s*([a-z0-9]{3,}-[a-z0-9]{3,})/i);
  // Return original case from match[1] (which we then uppercase)
  return orderMatch ? orderMatch[1].toUpperCase() : null;
};

const extractCustomerName = (query: string): string | null => {
  // Use 'i' flag for case-insensitivity on 'customer'/'user'
  const nameMatch = query.match(/(?:customer|user)\s+([a-zA-Z]+\s+[a-zA-Z]+)/i);
  // Return the original-cased name from match[1]
  return nameMatch ? nameMatch[1] : null;
};

const extractAmount = (query: string): number | null => {
  const amountMatch = query.match(/\$?(\d+(?:\.\d{2})?)/);
  return amountMatch ? parseFloat(amountMatch[1]) : null;
};

// --- Main Extractor Dictionary ---
// This maps an entity type (from trainingData) to its extractor function.
const ENTITY_EXTRACTORS: { [key: string]: (query: string) => any } = {
  status: extractStatus,
  date: extractDate,
  orderId: extractOrderId,
  customerName: extractCustomerName,
  amount: extractAmount,
  // Add other extractors as needed
  // 'product': extractProduct,
  // 'email': extractEmail,
};

// original-cased query, not the lowercased one.
const CASE_SENSITIVE_EXTRACTORS = new Set(['customerName', 'orderId']);

/**
 * Main function to extract all possible entities from a query string.
 * @param query The user's search query (e.g., "show me unfulfilled orders")
 * @param expectedEntities A list of entity types to look for (e.g., ['status', 'date'])
 * @returns An EntityMap of all found entities (e.g., { status: 'unfulfilled' })
 */
export const extractEntities = (
  query: string,
  expectedEntities: string[],
): EntityMap => {
  const entities: EntityMap = {};
  const lowerQuery = query.toLowerCase();

  for (const entityType of expectedEntities) {
    const extractor = ENTITY_EXTRACTORS[entityType];
    
    if (extractor) {
      // Use the original query for case-sensitive extractors
      // Use the lowercased query for all others (like status, date)
      const queryToSearch = CASE_SENSITIVE_EXTRACTORS.has(entityType)
        ? query
        : lowerQuery;
      
      const value = extractor(queryToSearch);
      
      if (value !== null) {
        entities[entityType] = value;
      }
    }
  }
  
  return entities;
};