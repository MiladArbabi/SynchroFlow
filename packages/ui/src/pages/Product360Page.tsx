/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/pages/Product360Page.tsx
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Chip,
  Button,
  Card,
  CardContent,
  Divider,
  CircularProgress,
  Alert
} from '@mui/material';
import { ArrowLeft, Package, TrendingUp, AlertTriangle } from 'lucide-react';
import { useProduct } from '../api/products';

const Product360Page: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
const { product, isLoading, isError } = useProduct(id!);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError || !product) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Product not found or failed to load.
        </Alert>
        <Button 
          startIcon={<ArrowLeft size={16} />} 
          onClick={() => navigate('/products')}
          sx={{ mt: 2 }}
        >
          Back to Products
        </Button>
      </Box>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active': return 'success';
      case 'draft': return 'warning';
      case 'archived': return 'error';
      default: return 'default';
    }
  };

  const getInventoryStatus = (inventory: number) => {
    if (inventory === 0) return { color: 'error', label: 'Out of Stock', icon: <AlertTriangle size={16} /> };
    if (inventory <= 10) return { color: 'warning', label: 'Low Stock', icon: <AlertTriangle size={16} /> };
    return { color: 'success', label: 'In Stock', icon: <Package size={16} /> };
  };

  const inventoryStatus = getInventoryStatus(product.total_inventory);

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 2 }}>
        <Button
          startIcon={<ArrowLeft size={16} />}
          onClick={() => navigate('/products')}
          variant="outlined"
        >
          Back to Products
        </Button>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" component="h1">
            {product.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Product Details & Analytics
          </Typography>
        </Box>
        <Chip
          label={product.status || 'Unknown'}
          color={getStatusColor(product.status) as any}
          size="small"
        />
      </Box>

      <Grid container spacing={3}>
        {/* Basic Information */}
        <Grid >
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Product Information
              </Typography>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid >
                  <Typography variant="body2" color="text.secondary">
                    Vendor
                  </Typography>
                  <Typography variant="body1">
                    {product.vendor || 'Not specified'}
                  </Typography>
                </Grid>
                <Grid >
                  <Typography variant="body2" color="text.secondary">
                    Product Type
                  </Typography>
                  <Typography variant="body1">
                    {product.product_type || 'Not specified'}
                  </Typography>
                </Grid>
                <Grid >
                  <Typography variant="body2" color="text.secondary">
                    Shopify ID
                  </Typography>
                  <Typography variant="body1" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    {product.platform_product_id}
                  </Typography>
                </Grid>
                <Grid >
                  <Typography variant="body2" color="text.secondary">
                    Internal ID
                  </Typography>
                  <Typography variant="body1">
                    #{product.id}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Inventory Analytics Card */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Inventory Analytics
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Box sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1,
                  color: `${inventoryStatus.color}.main`
                }}>
                  {inventoryStatus.icon}
                  <Typography variant="h5">
                    {product.total_inventory}
                  </Typography>
                </Box>
                <Chip
                  label={inventoryStatus.label}
                  color={inventoryStatus.color as any}
                  variant="outlined"
                />
              </Box>
              
              {product.total_inventory === 0 && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  This product is out of stock. Consider restocking to avoid lost sales.
                </Alert>
              )}
              {product.total_inventory > 0 && product.total_inventory <= 10 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Low inventory alert. Consider reordering soon.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Status & Actions */}
        <Grid >
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Quick Actions
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Button 
                  variant="outlined" 
                  fullWidth
                  startIcon={<TrendingUp size={16} />}
                >
                  View Sales Performance
                </Button>
                <Button 
                  variant="outlined" 
                  fullWidth
                  disabled
                >
                  Edit Product (Coming Soon)
                </Button>
                <Button 
                  variant="outlined" 
                  fullWidth
                  disabled
                >
                  Update Inventory (Coming Soon)
                </Button>
              </Box>
            </CardContent>
          </Card>

          {/* Timeline Card */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Product Timeline
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Created
                  </Typography>
                  <Typography variant="body2">
                    {new Date(product.created_at).toLocaleDateString()}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Last Updated
                  </Typography>
                  <Typography variant="body2">
                    {new Date(product.updated_at).toLocaleDateString()}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Coming Soon Sections */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Advanced Analytics (Coming Soon)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sales performance, customer reviews, profit margins, and supplier information will be available here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export { Product360Page };
