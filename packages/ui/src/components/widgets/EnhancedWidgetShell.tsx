/* eslint-disable @typescript-eslint/no-unused-vars */
//packages/ui/src/components/widgets/EnhancedWidgetShell.tsx
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { EnhancedWidgetShellProps } from './types';
import { 
  Box, 
  Typography, 
  Button, 
  Stack, 
  useTheme, 
  Skeleton, 
  Alert, 
  Chip, 
  IconButton,
  Link 
} from '@mui/material';
import { IconDots } from '@tabler/icons-react';
import { Link as RouterLink } from 'react-router-dom';

export const EnhancedWidgetShell: React.FC<EnhancedWidgetShellProps> = (props) => {
  const { 
    title, 
    children,
    subtitle,
    businessContext,
    metricConfig,
    headerLink,
    error,
    isLoading,
    isEmpty,
    isStale,
    intelligenceLevel,
    insightText,
    insightSeverity,
    primaryAction,
    secondaryActions,
    configMenu
  } = props;

  const theme = useTheme();
  const menuContainerRef = useRef<HTMLDivElement>(null);

  // --- [NEW] Helper function for Emotional Status ---
  const emotionalStatus = useMemo(() => {
    // This is a simple implementation. We will make this smarter.
    // For now, it just maps the 'survival' stage to 'urgent'.
    if (businessContext.stage === 'survival' || businessContext.burningPriority === 'cash-flow') {
      return 'urgent';
    }
    // TODO: Add logic for 'concerned', 'celebratory'
    return 'neutral';
  }, [businessContext]);

  const getEmotionalBorder = () => {
    return emotionalStatus === 'urgent' ? `4px solid ${theme.palette.error.main}` : 'none';
  };

  // --- [NEW] State for config menu ---
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // --- [NEW] Focus management for config menu ---
  useEffect(() => {
    if (isMenuOpen && menuContainerRef.current) {
      // Find the first focusable element in the menu
      const firstFocusable = menuContainerRef.current.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) as HTMLElement;
      
      if (firstFocusable) {
        // Small timeout to ensure the menu is fully rendered
        setTimeout(() => firstFocusable.focus(), 0);
      }
    }
  }, [isMenuOpen]);

  // --- RENDER BODY (State Machine) ---
  const renderBody = () => {
    // 1. Error state (highest priority)
    if (error) {
      return (
        <Alert severity="error" data-testid="error-state">
          {error}
        </Alert>
      );
    }

    // 2. Loading state
    if (isLoading) {
      return (
        <Box 
          data-testid="loading-skeleton" 
          role="status" 
          aria-label="Loading widget content"
        >
          <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 1 }} />
        </Box>
      );
    }

    // 3. Empty state
    if (isEmpty) {
      return (
        <Box data-testid="empty-state" sx={{ textAlign: 'center', p: 3 }}>
          <Typography variant="body2" color="textSecondary">No data to display.</Typography>
        </Box>
      );
    }

    // 4. Default: render children
    return children;
  };

  // --- Helper function to get severity color ---
  const getSeverityColor = () => {
    switch (insightSeverity) {
      case 'critical':
        return theme.palette.error.main;
      case 'warning':
        return theme.palette.warning.main;
      case 'positive':
        return theme.palette.success.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  // --- RENDER FOOTER (Intelligence Levels) ---
  const renderFooter = () => {
    // L1: No footer
    if (intelligenceLevel === 'L1') {
      return null;
    }

    // L2: Insight only
    if (intelligenceLevel === 'L2') {
      return (
        <Typography 
          variant="body2" 
          color={getSeverityColor()}
          data-testid="insight-text"
        >
          {insightText}
        </Typography>
      );
    }

    // L3 & L4: Actions
    return (
      <Stack spacing={1.5}>
        {insightText && (
          <Typography 
            variant="body2" 
            color={getSeverityColor()}
            data-testid="insight-text"
          >
            {insightText}
          </Typography>
        )}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          {intelligenceLevel === 'L4' && secondaryActions?.map(action => (
            <Button key={action.label} variant="outlined" onClick={action.onClick} size="small">
              {action.label}
            </Button>
          ))}
          {primaryAction && (
            <Button variant="contained" onClick={primaryAction.onClick} size="small" data-testid="primary-action">
              {primaryAction.label}
            </Button>
          )}
        </Stack>
      </Stack>
    );
  };

  return (
    <Box 
      data-stage={businessContext.stage}
      data-revenue-band={businessContext.revenueBand}
      sx={{
        borderLeft: getEmotionalBorder(),
        padding: 2,
        backgroundColor: theme.palette.background.paper,
        borderRadius: 1
      }}
    >
      {/* --- HEADER --- */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          {headerLink ? (
            <Link 
              component={RouterLink} 
              to={headerLink} 
              underline="hover"
              color="inherit"
              sx={{ textDecorationColor: theme.palette.text.primary, lineHeight: 1.2 }}
            >
              <Typography variant="h5" component="h3">{title}</Typography>
            </Link>
          ) : (
            <Typography variant="h5" component="h3">{title}</Typography>
          )}
          
          {configMenu && (
            <IconButton 
              size="small"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              data-testid="config-button"
            >
              <IconDots size={16} />
            </IconButton>
          )}
        </Stack>

        {/* --- [NEW] Wrap config menu with ref for focus management --- */}
        {isMenuOpen && (
          <div ref={menuContainerRef}>
            {configMenu}
          </div>
        )}

        <Stack direction="row" spacing={1} alignItems="center">
          {subtitle && (
            <Typography variant="body2" color="textSecondary">{subtitle}</Typography>
          )}
          {isStale && (
            <Chip
              label="Stale"
              size="small"
              variant="outlined"
              color="warning"
              data-testid="stale-indicator"
            />
          )}
        </Stack>
      
      {/* --- Render the state-managed body --- */}
      <Box sx={{ mt: 2 }}>
        {renderBody()}
     </Box>

      {/* --- FOOTER --- */}
      {intelligenceLevel !== 'L1' && (
      <Box 
        sx={{ 
          mt: 2, 
          pt: 2, 
          borderTop: `1px solid ${theme.palette.divider}`
        }}
        data-testid="widget-footer"
      >
        {renderFooter()}
      </Box>
      )}
      </Stack>
    </Box>
  );
};