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

const PAGE_INFO_FIELDS = `
pageInfo {
  hasNextPage
  endCursor
}
`;

const CATALOG_VARIANT_FIELDS = `
id
sku
barcode
image {
  url
}
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
`;

const OPENING_INVENTORY_VARIANT_FIELDS = `
id
inventoryQuantity
`;

/**
 * Catalog queries paginate products ($cursor) and nested variants. A product
 * whose first variants page has hasNextPage=true is continued by product
 * identity with the matching *_VARIANTS_QUERY (GH-1262 A2.1).
 */
export const GET_PRODUCTS_QUERY = `
query getProducts($cursor: String) {
  products(first: 50, after: $cursor) {
    edges {
      node {
        id
        title
        vendor
        productType
        status
        featuredImage {
          url
        }
        totalInventory
        variants(first: 100) {
          edges {
            node {
              ${CATALOG_VARIANT_FIELDS}
            }
          }
          ${PAGE_INFO_FIELDS}
        }
      }
    }
    ${PAGE_INFO_FIELDS}
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

export const GET_PRODUCT_VARIANTS_QUERY = `
query getProductVariants($id: ID!, $cursor: String) {
  product(id: $id) {
    id
    variants(first: 100, after: $cursor) {
      edges {
        node {
          ${CATALOG_VARIANT_FIELDS}
        }
      }
      ${PAGE_INFO_FIELDS}
    }
  }
}
`;

export const GET_OPENING_INVENTORY_PRODUCTS_QUERY = `
query getOpeningInventoryProducts($cursor: String) {
  products(first: 50, after: $cursor) {
    edges {
      node {
        id
        variants(first: 100) {
          edges {
            node {
              ${OPENING_INVENTORY_VARIANT_FIELDS}
            }
          }
          ${PAGE_INFO_FIELDS}
        }
      }
    }
    ${PAGE_INFO_FIELDS}
  }
}
`;

export const GET_OPENING_INVENTORY_VARIANTS_QUERY = `
query getOpeningInventoryVariants($id: ID!, $cursor: String) {
  product(id: $id) {
    id
    variants(first: 100, after: $cursor) {
      edges {
        node {
          ${OPENING_INVENTORY_VARIANT_FIELDS}
        }
      }
      ${PAGE_INFO_FIELDS}
    }
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
        shippingAddress {
          name
          address1
          address2
          city
          zip
          phone
          provinceCode
          countryCode
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