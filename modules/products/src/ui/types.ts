// modules/products/src/ui/types.ts

export type ProductsFt1Scenario =
  | 'LOADING'         // productCount unknown
  | 'NO_PRODUCTS'     // zero products
  | 'HEALTHY'; // at least one product exists
