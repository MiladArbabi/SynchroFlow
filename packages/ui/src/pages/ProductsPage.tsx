/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/pages/ProductsPage.tsx
import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert
} from '@mui/material';
import { Search } from 'lucide-react';
import { useProducts } from '../api/products';

const ProductsPage: React.FC = () => {
  const [searchSku, setSearchSku] = useState('');
  const { products, isLoading, isError } = useProducts();

  const handleSearch = () => {
    // Search functionality to be implemented in future task
    console.log('Search for SKU:', searchSku);
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'success';
      case 'draft':
        return 'warning';
      case 'archived':
        return 'error';
      default:
        return 'default';
    }
  };

  const getInventoryStatus = (inventory: number) => {
    if (inventory === 0) return { color: 'error', label: 'Out of Stock' };
    if (inventory <= 10) return { color: 'warning', label: 'Low Stock' };
    return { color: 'success', label: 'In Stock' };
  };

  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load products. Please try again later.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Products
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Your single source of truth for all product and inventory data.
      </Typography>
      
      {/* Search Bar */}
      <Box sx={{ display: 'flex', gap: 1, mb: 3, maxWidth: 400 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search by SKU or product name..."
          value={searchSku}
          onChange={(e) => setSearchSku(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button
          variant="contained"
          onClick={handleSearch}
          startIcon={<Search size={16} />}
        >
          Search
        </Button>
      </Box>

      {/* Products Table */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : products.length === 0 ? (
        <Alert severity="info">
          No products found. Connect your store to start syncing products.
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 650 }} aria-label="products table">
            <TableHead>
              <TableRow>
                <TableCell>Product</TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Inventory</TableCell>
                <TableCell>Stock Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map((product) => {
                const inventoryStatus = getInventoryStatus(product.total_inventory);
                return (
                  <TableRow
                    key={product.id}
                    sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                  >
                    <TableCell component="th" scope="row">
                      <Typography variant="body2" fontWeight="medium">
                        {product.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ID: {product.platform_product_id}
                      </Typography>
                    </TableCell>
                    <TableCell>{product.vendor || '-'}</TableCell>
                    <TableCell>{product.product_type || '-'}</TableCell>
                    <TableCell>
                      <Chip
                        label={product.status || 'Unknown'}
                        color={getStatusColor(product.status) as any}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {product.total_inventory}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={inventoryStatus.label}
                        color={inventoryStatus.color as any}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

export { ProductsPage };