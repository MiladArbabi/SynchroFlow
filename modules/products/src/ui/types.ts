// modules/products/src/ui/types.ts

export type ProductsFt1Scenario =
  | 'NO_PRODUCTS'     // zero products
  | 'PRODUCT_DATA_INCOMPLETE'
  | 'PARTIALLY_READY'
  | 'HEALTHY'; // at least one product exists
