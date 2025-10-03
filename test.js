// The path must point to the compiled .node file
const addon = require('./packages/cpp-core/build/Release/sf_core.node');

console.log("Testing our native addon...");
const result = addon.hello(); // Call the C++ function

console.log("Result from C++:", result);