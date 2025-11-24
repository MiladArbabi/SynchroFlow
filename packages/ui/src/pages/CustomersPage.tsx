// packages/ui/src/pages/CustomersPage.tsx
import React from 'react';
import { Box, Typography, Button, Card, CardContent, Grid, Paper, Alert } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
   ConnectWithoutContact,
   Analytics,
   Group,
   TrendingUp,
   LockOpen
 } from '@mui/icons-material';
import MasterPanel from 'ui-component/MasterPanel/index.tsx';

/**
 * CustomersPage: Identity Resolution Teaser - Shows the vision for multi-platform customer intelligence
 * and guides users to connect platforms for unified customer insights.
*/

const CustomersPage: React.FC = () => {
  
  return (
    <MasterPanel title="Customer Intelligence">
       <Box sx={{ p: 3, maxWidth: 1200, margin: '0 auto' }}>
         {/* Header Section */}
         <Box sx={{ textAlign: 'center', mb: 6 }}>
           <ConnectWithoutContact sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
           <Typography variant="h3" component="h1" gutterBottom>
             Unified Customer Intelligence
           </Typography>
           <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
             See your customers across all platforms in one place
           </Typography>
           
           <Alert severity="info" sx={{ mb: 3, textAlign: 'left' }}>
             <strong>Coming Soon:</strong> We're building advanced customer intelligence that connects data from all your platforms.
           </Alert>
         </Box>

         {/* Value Proposition Cards */}
         <Grid container spacing={4} sx={{ mb: 6 }}>
           <Grid >
             <Card sx={{ height: '100%', textAlign: 'center' }}>
               <CardContent>
                 <Group sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                 <Typography variant="h6" gutterBottom>
                   Cross-Platform Customer Matching
                 </Typography>
                 <Typography variant="body2" color="text.secondary">
                   Unify customer data from Shopify, email platforms, and support systems to see complete customer journeys.
                 </Typography>
               </CardContent>
             </Card>
           </Grid>
           
           <Grid >
             <Card sx={{ height: '100%', textAlign: 'center' }}>
               <CardContent>
                 <Analytics sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                 <Typography variant="h6" gutterBottom>
                   Lifetime Value Analysis
                 </Typography>
                 <Typography variant="body2" color="text.secondary">
                   Calculate true customer lifetime value including support costs, marketing spend, and repeat purchase behavior.
                 </Typography>
               </CardContent>
             </Card>
           </Grid>
           
           <Grid >
             <Card sx={{ height: '100%', textAlign: 'center' }}>
               <CardContent>
                 <TrendingUp sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                 <Typography variant="h6" gutterBottom>
                   Predictive Insights
                 </Typography>
                 <Typography variant="body2" color="text.secondary">
                   Get churn predictions, next purchase dates, and personalized marketing recommendations.
                 </Typography>
               </CardContent>
             </Card>
           </Grid>
         </Grid>

         {/* Current Capabilities vs Future State */}
         <Paper sx={{ p: 4, mb: 4, background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' }}>
           <Typography variant="h5" gutterBottom sx={{ textAlign: 'center' }}>
             What You See Now vs. What's Coming
           </Typography>
           <Grid container spacing={3} sx={{ mt: 2 }}>
             <Grid >
               <Box sx={{ p: 2 }}>
                 <Typography variant="h6" color="text.secondary" gutterBottom>
                   Current (Basic)
                 </Typography>
                 <ul style={{ color: 'text.secondary', paddingLeft: '20px' }}>
                   <li>Shopify customer data only</li>
                   <li>Basic order history</li>
                   <li>Limited customer insights</li>
                 </ul>
               </Box>
             </Grid>
             <Grid >
               <Box sx={{ p: 2 }}>
                 <Typography variant="h6" color="primary.main" gutterBottom>
                   Future (Intelligent)
                 </Typography>
                 <ul style={{ color: 'primary.main', paddingLeft: '20px' }}>
                   <li>Multi-platform customer profiles</li>
                   <li>True lifetime value calculations</li>
                   <li>Predictive behavior analytics</li>
                   <li>Personalized marketing triggers</li>
                 </ul>
               </Box>
             </Grid>
           </Grid>
         </Paper>

         {/* Call to Action */}
         <Box sx={{ textAlign: 'center', mt: 4 }}>
           <Typography variant="h6" gutterBottom>
             Ready to unlock advanced customer intelligence?
           </Typography>
           <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
             Connect your platforms to get started with unified customer insights
           </Typography>
           <Button
             variant="contained"
             size="large"
             startIcon={<LockOpen />}
             component={RouterLink}
             to="/integrations"
             sx={{ mr: 2 }}
           >
             Connect Platforms
           </Button>
           <Button
             variant="outlined"
             size="large"
             component={RouterLink}
             to="/dashboard"
           >
             Back to Dashboard
           </Button>
         </Box>
       </Box>
    </MasterPanel>
  );
};

export default CustomersPage;