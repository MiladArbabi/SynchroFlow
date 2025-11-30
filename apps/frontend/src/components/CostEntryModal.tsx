// apps/frontend/src/components/CostEntryModal.tsx
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import {
  Modal,
  Button,
  Grid,
  TextField,
  InputAdornment,
  CardContent,
  CardActions,
  Divider,
  Typography,
  IconButton,
  Box,
  Alert,
  Chip
} from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import CustomFormControl from 'ui-component/extended/Form/CustomFormControl';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useProductCosts, useUpdateProductCost } from '../api/product-costs';
import { Product } from '../api/products';
import { extractShopifyId } from 'utils/shopifyIdExtractor';

interface CostEntryModalProps {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onSave: (costData: any) => void;
}

interface AdditionalCost {
  id: string;
  name: string;
  amount: number;
}

export const CostEntryModal: React.FC<CostEntryModalProps> = ({
  open,
  product,
  onClose,
  onSave
}) => {
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [shippingCost, setShippingCost] = useState<number>(0);
  const [customsDuties, setCustomsDuties] = useState<number>(0);
  const [packagingCost, setPackagingCost] = useState<number>(0);
  const [additionalCosts, setAdditionalCosts] = useState<AdditionalCost[]>([]);
  const [sellingPrice, setSellingPrice] = useState<number>(0);
  const [newCostName, setNewCostName] = useState<string>('');
  const [newCostAmount, setNewCostAmount] = useState<number>(0);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Calculate total landed cost and margins in real-time
  const totalLandedCost = purchasePrice + shippingCost + customsDuties + packagingCost + 
    additionalCosts.reduce((sum, cost) => sum + cost.amount, 0);
  
  const grossMargin = sellingPrice > 0 && totalLandedCost > 0 ? 
    ((sellingPrice - totalLandedCost) / sellingPrice) * 100 : 0;
  
  const profitPerUnit = sellingPrice - totalLandedCost;

  useEffect(() => {
    if (product && open) {
      // Reset form when modal opens with new product
      setPurchasePrice(0);
      setShippingCost(0);
      setCustomsDuties(0);
      setPackagingCost(0);
      setAdditionalCosts([]);
      setSellingPrice(45); // Placeholder - TODO: Get actual price
      setNewCostName('');
      setNewCostAmount(0);
      setErrors({});
    }
  }, [product, open]);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (purchasePrice < 0) {
      newErrors.purchasePrice = 'Purchase price cannot be negative';
    }

    if (shippingCost < 0) {
      newErrors.shippingCost = 'Shipping cost cannot be negative';
    }

    if (customsDuties < 0) {
      newErrors.customsDuties = 'Customs/duties cannot be negative';
    }

    if (packagingCost < 0) {
      newErrors.packagingCost = 'Packaging cost cannot be negative';
    }

    if (profitPerUnit < 0) {
      newErrors.margin = 'Selling below cost - will lose money';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddAdditionalCost = () => {
    if (newCostName.trim() && newCostAmount >= 0) {
      const newCost: AdditionalCost = {
        id: Math.random().toString(36).substr(2, 9),
        name: newCostName.trim(),
        amount: newCostAmount
      };
      setAdditionalCosts(prev => [...prev, newCost]);
      setNewCostName('');
      setNewCostAmount(0);
    }
  };

  const handleRemoveAdditionalCost = (id: string) => {
    setAdditionalCosts(prev => prev.filter(cost => cost.id !== id));
  };

  const handleSave = () => {
    if (!validateForm()) {
      return;
    }

    const platformProductId = extractShopifyId(product?.platform_product_id || '');
      console.log('🔑 Original GID:', product?.platform_product_id);
      console.log('🔑 Extracted ID:', platformProductId);

    const costData = {
      productId: product?.id,
      platform_product_id: platformProductId, // For backend
      original_platform_product_id: product?.platform_product_id, // For localStorage key
      purchase_price: purchasePrice,
      landed_cost_per_unit: totalLandedCost,
      selling_price: sellingPrice,
      currency: 'USD'
    };

    console.log('CostEntryModal: Saving cost data:', costData);
    onSave(costData);
  };

  const handlePurchasePriceChange = (value: number) => {
    setPurchasePrice(value);
  };

  if (!product) return null;
  
  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: { xs: '90%', sm: 600, md: 700 },
          maxHeight: '90vh',
          overflow: 'auto',
          outline: 'none'
        }}
      >
        <MainCard
          title={`Cost Entry - ${product.title}`}
          content={false}
          secondary={
            <IconButton onClick={onClose} size="large">
              <CloseIcon fontSize="small" />
            </IconButton>
          }
          data-testid="cost-entry-modal"
        >
          <CardContent>
            {/* Cost Breakdown */}
            <Grid container spacing={3}>
              {/* Essential Costs */}
              <Grid size={{ xs: 12, md: 6 }} sx={{ pb: 1 }}>
                <CustomFormControl fullWidth>
                  <TextField
                    label="Purchase Price"
                    variant="standard"
                    type="number"
                    value={purchasePrice || ''}
                    onChange={(e) => handlePurchasePriceChange(parseFloat(e.target.value) || 0)}
                    onBlur={() => validateForm()}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    data-testid="purchase-price-input"
                    placeholder="0.00"
                    error={!!errors.purchasePrice}
                    helperText={errors.purchasePrice}
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        step: 0.01,
                      },
                    }}
                    fullWidth
                  />
                </CustomFormControl>
              </Grid>
              
              <Grid size={{ xs: 12, md: 6 }} sx={{ pb: 1 }}>
                <CustomFormControl fullWidth>
                  <TextField
                    label="Shipping from Supplier"
                    variant="standard"
                    type="number"
                    value={shippingCost || ''}
                    onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                    onBlur={() => validateForm()}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    data-testid="shipping-cost-input"
                    placeholder="0.00"
                    error={!!errors.shippingCost}
                    helperText={errors.shippingCost}
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        step: 0.01,
                      },
                    }}
                    fullWidth
                  />
                </CustomFormControl>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }} sx={{ pb: 1 }}>
                <CustomFormControl fullWidth>
                  <TextField
                    label="Customs/Duties"
                    variant="standard"
                    type="number"
                    value={customsDuties || ''}
                    onChange={(e) => setCustomsDuties(parseFloat(e.target.value) || 0)}
                    onBlur={() => validateForm()}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    data-testid="customs-duties-input"
                    placeholder="0.00"
                    error={!!errors.customsDuties}
                    helperText={errors.customsDuties}
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        step: 0.01,
                      },
                    }}
                    fullWidth
                  />
                </CustomFormControl>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }} sx={{ pb: 1 }}>
                <CustomFormControl fullWidth>
                  <TextField
                    label="Packaging Materials"
                    variant="standard"
                    type="number"
                    value={packagingCost || ''}
                    onChange={(e) => setPackagingCost(parseFloat(e.target.value) || 0)}
                    onBlur={() => validateForm()}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    placeholder="0.00"
                    error={!!errors.packagingCost}
                    helperText={errors.packagingCost}
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        step: 0.01,
                      },
                    }}
                    fullWidth
                  />
                </CustomFormControl>
              </Grid>

              {/* Additional Costs Section */}
              <Grid size={{ xs: 12 }}>
                <Divider sx={{ my: 2 }}>
                  <Typography variant="h6">Additional Costs</Typography>
                </Divider>
                
                {/* Existing Additional Costs */}
                {additionalCosts.map((cost) => (
                  <Grid container spacing={1} key={cost.id} sx={{ mb: 1 }}>
                    <Grid size={{ xs: 6 }}>
                      <Typography variant="body2" fontWeight="medium">
                        {cost.name}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 4 }}>
                      <Typography variant="body2">
                        ${cost.amount.toFixed(2)}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 2 }}>
                      <IconButton 
                        size="small" 
                        onClick={() => handleRemoveAdditionalCost(cost.id)}
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Grid>
                  </Grid>
                ))}

                {/* Add New Cost */}
                <Grid container spacing={1} alignItems="center" sx={{ mt: 1 }}>
                  <Grid size={{ xs: 5 }}>
                    <TextField
                      size="small"
                      variant="standard"
                      placeholder="Cost name"
                      value={newCostName}
                      onChange={(e) => setNewCostName(e.target.value)}
                      slotProps={{
                        htmlInput: {
                          'aria-label': 'Custom cost name',
                        },
                      }}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 4 }}>
                    <TextField
                      size="small"
                      variant="standard"
                      type="number"
                      placeholder="Amount"
                      value={newCostAmount || ''}
                      onChange={(e) => setNewCostAmount(parseFloat(e.target.value) || 0)}
                      InputProps={{
                        startAdornment: <InputAdornment position="start">$</InputAdornment>,
                      }}
                      slotProps={{
                        htmlInput: {
                          min: 0,
                          step: 0.01,
                          'aria-label': 'Custom cost amount',
                        },
                      }}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 3 }}>
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={handleAddAdditionalCost}
                      disabled={!newCostName.trim() || newCostAmount < 0}
                      fullWidth
                    >
                      Add
                    </Button>
                  </Grid>
                </Grid>
              </Grid>

              {/* Total Landed Cost Display */}
              <Grid size={{ xs: 12 }} sx={{ mt: 2 }}>
                <Box sx={{ 
                  p: 2, 
                  bgcolor: 'grey.50', 
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider'
                }}>
                  <Grid container alignItems="center">
                    <Grid size={{ xs: 6 }}>
                      <Typography variant="h6">
                        Total Landed Cost:
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 6 }} sx={{ textAlign: 'right' }}>
                      <Typography 
                        variant="h5" 
                        color="primary.main" 
                        fontWeight="bold"
                        data-testid="total-landed-cost"
                      >
                        ${totalLandedCost.toFixed(2)}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Grid>

              {/* Selling Price */}
              <Grid size={{ xs: 12 }} sx={{ pb: 1, mt: 2 }}>
                <CustomFormControl fullWidth>
                  <TextField
                    label="Selling Price"
                    variant="standard"
                    type="number"
                    value={sellingPrice || ''}
                    onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
                    onBlur={() => validateForm()}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    placeholder="0.00"
                    slotProps={{
                      htmlInput: {
                        min: 0,
                        step: 0.01,
                      },
                    }}
                    fullWidth
                  />
                </CustomFormControl>
              </Grid>
            </Grid>

            {/* Real-time Margin Preview */}
            <Divider sx={{ my: 3 }} />
            
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <Typography variant="h6" gutterBottom>
                  Margin Analysis
                </Typography>
              </Grid>
              
              <Grid size={{ xs: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Gross Margin:
                </Typography>
                <Typography 
                  variant="h6" 
                  color={grossMargin >= 30 ? 'success.main' : grossMargin >= 10 ? 'warning.main' : 'error.main'}
                >
                  {grossMargin.toFixed(1)}%
                </Typography>
              </Grid>
              
              <Grid size={{ xs: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Profit/Unit:
                </Typography>
                <Typography 
                  variant="h6" 
                  color={profitPerUnit > 0 ? 'success.main' : 'error.main'}
                >
                  ${profitPerUnit.toFixed(2)}
                </Typography>
              </Grid>

              {errors.margin && (
                <Grid size={{ xs: 12 }}>
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    {errors.margin}
                  </Alert>
                </Grid>
              )}

              {grossMargin > 0 && grossMargin < 20 && !errors.margin && (
                <Grid size={{ xs: 12 }}>
                  <Alert severity="info" sx={{ mt: 1 }}>
                    Consider optimizing costs or increasing price for better margins
                  </Alert>
                </Grid>
              )}
            </Grid>
          </CardContent>

          <Divider />
          
          <CardActions sx={{ p: 2, justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={onClose} variant="outlined">
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              variant="contained"
              disabled={purchasePrice <= 0 || totalLandedCost <= 0}
              data-testid="save-cost-button"
            >
              Save Costs
            </Button>
          </CardActions>
        </MainCard>
      </Box>
    </Modal>
  );
}