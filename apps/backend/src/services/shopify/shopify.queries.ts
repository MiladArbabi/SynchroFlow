 /**
 * SHOPIFY GRAPHQL QUERIES
 * -----------------------
 * Centralized query definitions.
 *
 * Guarantees:
 * - reuse across services
 * - easier testing and debugging
 * - prevents query drift
 */

export const GET_PRODUCTS_QUERY = `
query {
  products(first: 50) {
    edges {
      node {
        id
        title
        vendor
        productType
        status
        totalInventory
        variants(first: 100) {
          edges {
            node {
              id
              sku
              barcode
              title
              price
              compareAtPrice
              createdAt
              updatedAt
              inventoryItem {
                id
                unitCost {
                  amount
                }
              }
            }
          }
        }
      }
    }
  }
  shop {
    id
    name
    email
    currencyCode
    timezoneOffset
  }
}
`;

export const GET_ORDERS_QUERY = `
query getOrders($cursor: String) {
  orders(
    first: 50
    after: $cursor
    sortKey: CREATED_AT
    reverse: false
  ) {
    edges {
      node {
        id
        name
        createdAt
        updatedAt
        processedAt
        subtotalPriceSet { shopMoney { amount } }
        totalTaxSet { shopMoney { amount } }
        totalPriceSet {
          shopMoney { amount currencyCode }
        }
        currencyCode
        sourceName
        displayFulfillmentStatus
        displayFinancialStatus
        customer {
          id
        }
        lineItems(first: 20) {
          edges {
            node {
              id
              quantity
              sku
              product { id }
              variant { id sku }
              originalUnitPriceSet { shopMoney { amount } }
              discountedUnitPriceSet { shopMoney { amount } }
              originalTotalSet { shopMoney { amount } }
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;