/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/pages/ProductsPage.tsx
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
import { useUserProductCosts, useUpdateUserProductCosts } from '../api/user-state';
import { useQueryClient } from '@tanstack/react-query';

const ProductsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const { products: initialProducts, pagination, isLoading, isError } = useProducts(page, limit, searchQuery);
  const [products, setProducts] = useState<Product[]>(initialProducts || []);
  
  // Cost modal state
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  const updateCostMutation = useUpdateProductCost();
  const { data: userProductCosts, isLoading: isLoadingUserCosts } = useUserProductCosts();
  const updateUserProductCostsMutation = useUpdateUserProductCosts();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (initialProducts) {
      setProducts(initialProducts);
    }
  }, [initialProducts]);

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

  // Load cost data from user-state with localStorage fallback
 React.useEffect(() => {
   const loadCostData = () => {
     try {
       console.log('🔄 Loading cost data for products:', initialProducts.length);
       
       // Phase 1: Try user-state first, fallback to localStorage
       let costData: any = {};
       
       if (userProductCosts && Object.keys(userProductCosts).length > 0) {
         console.log('📊 Using user-state cost data:', Object.keys(userProductCosts));
         costData = userProductCosts;
       } else {
         // Fallback to localStorage during migration
         const savedData = localStorage.getItem('synchroflow_product_costs');
         if (savedData) {
           console.log('📊 Using localStorage cost data (fallback):', Object.keys(JSON.parse(savedData)));
           costData = JSON.parse(savedData);
         }
       }
       
       const updatedProducts = initialProducts.map(p => {
         const productCostData = costData[p.platform_product_id]; 
         console.log(`🔍 Checking product ${p.platform_product_id}:`, productCostData);
         return productCostData ? { ...p, ...productCostData } : p;
       });
       
       setProducts(updatedProducts);
     } catch (error) {
       console.error('❌ Error loading cost data:', error);
     }
   };
 
   if (initialProducts && initialProducts.length > 0 && !isLoadingUserCosts) {
     loadCostData();
   }
 }, [initialProducts, userProductCosts, isLoadingUserCosts]);

  const handleCostSave = async (costData: any) => {
     try {
       const result = await updateCostMutation.updateProductCost(costData);
       
       // Calculate margin
       const landedCost = parseFloat(result.data.landed_cost_per_unit);
       const sellingPrice = costData.selling_price;
       const margin = sellingPrice && landedCost ? 
         ((sellingPrice - landedCost) / sellingPrice) * 100 : 0;
 
       // Phase 1: Dual-write to both localStorage AND user-state
       const costEntry = {
         purchase_price: parseFloat(result.data.purchase_price),
         landed_cost_per_unit: landedCost,
         selling_price: sellingPrice,
         margin: margin,
         last_cost_update: result.data.updated_at
       };
 
       // 1. Update localStorage (existing behavior)
       const savedData = localStorage.getItem('synchroflow_product_costs') || '{}';
       const costDataMap = JSON.parse(savedData);
       costDataMap[costData.original_platform_product_id] = costEntry;
       localStorage.setItem('synchroflow_product_costs', JSON.stringify(costDataMap));
 
       // 2. Update user-state (new multi-device sync)
       const updatedUserCosts = {
         ...userProductCosts,
         [costData.original_platform_product_id]: {
           ...costData,
           ...costEntry
         }
       };
       await updateUserProductCostsMutation.mutateAsync(updatedUserCosts);
       
       setProducts(prev => prev.map(p => 
         p.id === costData.productId 
           ? { 
               ...p, 
               ...costEntry
             } 
           : p
       ));
       
       queryClient.invalidateQueries({ queryKey: ['products'] });
       setCostModalOpen(false);
       
     } catch (error) {
       console.error('Error saving cost data:', error);
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
                    data-testid="product-card"
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
                      <div data-testid="cost-status-indicator">
                      <CostStatusIndicator 
                        product={product}
                        onClick={() => handleCostClick(product)}
                      />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div data-testid="margin-display">
                      {product.margin ? (
                        <Typography 
                          variant="body2" 
                          color={
                            product.margin > 30 ? 'success.main' : 
                            product.margin > 15 ? 'warning.main' : 'error.main'
                          }
                          fontWeight="medium"
                        >
                          {Math.round(product.margin)}%
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {product.total_inventory > 0 ? 'Add costs' : '-'}
                        </Typography>
                      )}
                      </div>
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