import express from 'express';

// --- ADD THESE LINES ---
// Use 'path' to create a reliable, absolute path to the addon file
import path from 'path';

// Load the C++ addon. The path goes up from /api, then down into /cpp-core.
const addonPath = path.join(__dirname, '../../../packages/cpp-core/build/Release/sf_core.node');
const addon = require(addonPath);
// --------------------

const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('SynchroFlow API is running!');
});

app.get('/v1/inventory/:sku', (req, res) => {
  const { sku } = req.params;
  // Get countryCode from query params, e.g., ?countryCode=DE
  // Default to a null value if not provided
  const countryCode = req.query.countryCode as string || null;

  try {
    // Call the C++ function with the data from the API request
    const inventoryData = addon.getInventoryItem(sku, countryCode);
    res.json(inventoryData);
  } catch (error) {
    // If the C++ addon throws an error, catch it and send a server error response
    if(error instanceof Error){
        res.status(500).json({ error: error.message });
    } else {
        res.status(500).json({ error: 'An unknown error occurred' });
    }
  }
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});