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
  Alert,
  MenuItem,
  FormControl,
  Select,
  Pagination
} from '@mui/material';
import { Search } from 'lucide-react';
import { useProducts, Product } from '../api/products';
import { useNavigate } from 'react-router-dom';
import { CostEntryModal } from '../components/CostEntryModal';
import { CostStatusIndicator } from '../components/CostStatusIndicator';
import { useUpdateProductCost } from '../api/product-costs';

const ProductsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const { products, pagination, isLoading, isError } = useProducts(page, limit, searchQuery);

  // Cost modal state
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  const updateCostMutation = useUpdateProductCost();

  const handleSearch = () => {
    setSearchQuery(searchQuery);
    setPage(1);
  };

  const handleRowClick = (product: Product) => {
    navigate(`/products/${product.id}`);
  };

  const handleCostClick = (product: Product) => {
    setSelectedProduct(product);
    setCostModalOpen(true);
  };

  const handleCostSave = async (costData: any) => {
    try {
      await updateCostMutation.updateProductCost(costData);
      console.log('Cost data saved successfully:', costData);
    } catch (error) {
      console.error('Failed to save cost data:', error);
    }
  };

  const handlePageChange = (event: React.ChangeEvent<unknown>, newPage: number) => {
    setPage(newPage);
  };

  const handleLimitChange = (event: any) => {
    setLimit(parseInt(event.target.value, 10));
    setPage(1);
  };

  const getInventoryStatus = (inventory: number) => {
    if (inventory === 0) return { label: 'Out of Stock', color: 'error' };
    if (inventory < 10) return { label: 'Low Stock', color: 'warning' };
    return { label: 'In Stock', color: 'success' };
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active': return 'success';
      case 'draft': return 'warning';
      case 'archived': return 'error';
      default: return 'default';
    }
  };

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
          placeholder="Search products..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Alert severity="error">
          Failed to load products. Please try again.
        </Alert>
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
                <TableCell>Cost Status</TableCell>
                <TableCell>Margin</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
               {products.map((product) => {
                const inventoryStatus = getInventoryStatus(product.total_inventory);
                return (
                  <TableRow
                    key={product.id}
                    sx={{ 
                      '&:last-child td, &:last-child th': { border: 0 },
                      cursor: 'pointer',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      }
                    }}
                    onClick={() => handleRowClick(product)}
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <CostStatusIndicator 
                        product={product}
                        onClick={() => handleCostClick(product)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {product.total_inventory > 0 ? 'Add costs' : '-'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Pagination */}
      {products.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2, p: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, pagination.total)} of {pagination.total} products
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControl size="small" sx={{ minWidth: 80 }}>
              <Select
                value={limit.toString()}
                onChange={handleLimitChange}
              >
                <MenuItem value={10}>10</MenuItem>
                <MenuItem value={20}>20</MenuItem>
                <MenuItem value={50}>50</MenuItem>
                <MenuItem value={100}>100</MenuItem>
              </Select>
            </FormControl>
            <Pagination
              count={pagination.totalPages}
              page={page}
              onChange={handlePageChange}
              color="primary"
            />
          </Box>
        </Box>
      )}

      {/* Cost Entry Modal */}
      <CostEntryModal
        open={costModalOpen}
        product={selectedProduct}
        onClose={() => setCostModalOpen(false)}
        onSave={handleCostSave}
      />
    </Box>
  );
};

export default ProductsPage;