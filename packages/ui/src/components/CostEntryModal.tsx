/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/components/CostEntryModal.tsx
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
  Alert
} from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import CustomFormControl from 'ui-component/extended/Form/CustomFormControl';
import CloseIcon from '@mui/icons-material/Close';
import { useProductCosts, useUpdateProductCost } from '../api/product-costs';
import { Product } from '../api/products';

interface CostEntryModalProps {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onSave: (costData: any) => void;
}

export const CostEntryModal: React.FC<CostEntryModalProps> = ({
  open,
  product,
  onClose,
  onSave
}) => {
  const [purchasePrice, setPurchasePrice] = useState<number>(0);
  const [landedCost, setLandedCost] = useState<number>(0);
  const [sellingPrice, setSellingPrice] = useState<number>(0);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Calculate margins in real-time
  const grossMargin = sellingPrice > 0 && landedCost > 0 ? 
    ((sellingPrice - landedCost) / sellingPrice) * 100 : 0;
  const profitPerUnit = sellingPrice - landedCost;

  useEffect(() => {
    if (product && open) {
      // Reset form when modal opens with new product
      setPurchasePrice(0);
      setLandedCost(0);
      setSellingPrice(45); // Placeholder - TODO: Get actual price
      setErrors({});
    }
  }, [product, open]);

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (purchasePrice < 0) {
      newErrors.purchasePrice = 'Purchase price cannot be negative';
    }

    if (landedCost < 0) {
      newErrors.landedCost = 'Landed cost cannot be negative';
    }

    if (purchasePrice > landedCost && landedCost > 0) {
      newErrors.landedCost = 'Landed cost should include purchase price plus additional costs';
    }

    if (profitPerUnit < 0) {
      newErrors.margin = 'Selling below cost - will lose money';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validateForm()) {
      return;
    }

    const costData = {
      platform_product_id: product?.platform_product_id,
      purchase_price: purchasePrice,
      landed_cost_per_unit: landedCost,
      currency: 'USD'
    };

    onSave(costData);
    onClose();
  };

  const handlePurchasePriceChange = (value: number) => {
    setPurchasePrice(value);
    // Auto-calculate landed cost if it's currently 0 or equal to purchase price
    if (landedCost === 0 || landedCost === purchasePrice) {
      setLandedCost(value * 1.2); // 20% markup for shipping, etc.
    }
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
          width: { xs: '90%', sm: 500, md: 600 },
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
        >
          <CardContent>
            {/* Basic Cost Inputs */}
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <CustomFormControl fullWidth>
                  <TextField
                    label="Purchase Price"
                    type="number"
                    value={purchasePrice || ''}
                    onChange={(e) => handlePurchasePriceChange(parseFloat(e.target.value) || 0)}
                    onBlur={() => validateForm()}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    placeholder="0.00"
                    error={!!errors.purchasePrice}
                    helperText={errors.purchasePrice}
                    inputProps={{ 
                      min: 0,
                      step: 0.01
                    }}
                  />
                </CustomFormControl>
              </Grid>
              
              <Grid size={{ xs: 12, md: 6 }}>
                <CustomFormControl fullWidth>
                  <TextField
                    label="Landed Cost"
                    type="number"
                    value={landedCost || ''}
                    onChange={(e) => setLandedCost(parseFloat(e.target.value) || 0)}
                    onBlur={() => validateForm()}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    placeholder="0.00"
                    error={!!errors.landedCost}
                    helperText={errors.landedCost || "Total cost including shipping, duties, etc."}
                    inputProps={{ 
                      min: 0,
                      step: 0.01
                    }}
                  />
                </CustomFormControl>
              </Grid>

              <Grid size={{ xs: 12 }}>
                <CustomFormControl fullWidth>
                  <TextField
                    label="Selling Price"
                    type="number"
                    value={sellingPrice || ''}
                    onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
                    onBlur={() => validateForm()}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    placeholder="0.00"
                    inputProps={{ 
                      min: 0,
                      step: 0.01
                    }}
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
              disabled={purchasePrice <= 0 || landedCost <= 0}
            >
              Save Costs
            </Button>
          </CardActions>
        </MainCard>
      </Box>
    </Modal>
  );
};