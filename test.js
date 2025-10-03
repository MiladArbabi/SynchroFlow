const addon = require('./packages/cpp-core/build/Release/sf_core.node');

console.log("--- Testing Compliance Logic in C++ Core ---");

// Test Case 1: Item found, shipping to Germany (DE)
console.log("\nRequesting SKU 'SYN-TS-M-BLUE' for DE...");
const itemDE = addon.getInventoryItem("SYN-TS-M-BLUE", "DE");
console.log("Result for DE:", itemDE);
console.log(`Price with 19% VAT: ${itemDE.priceWithVat.toFixed(2)}`);


// Test Case 2: Item found, shipping to Sweden (SE)
console.log("\nRequesting SKU 'SYN-TS-M-BLUE' for SE...");
const itemSE = addon.getInventoryItem("SYN-TS-M-BLUE", "SE");
console.log("Result for SE:", itemSE);
console.log(`Price with 25% VAT: ${itemSE.priceWithVat.toFixed(2)}`);


// Test Case 3: Item not found
console.log("\nRequesting SKU 'NOT-A-SKU' for US...");
const itemNotFound = addon.getInventoryItem("NOT-A-SKU", "US");
console.log("Result for Not Found:", itemNotFound);