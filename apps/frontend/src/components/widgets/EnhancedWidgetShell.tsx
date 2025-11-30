/* eslint-disable @typescript-eslint/no-unused-vars */
//apps/frontend/src/components/widgets/EnhancedWidgetShell.tsx
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { EnhancedWidgetShellProps } from './types';
import {
    Box,
    Typography,
    Button,
    Stack,
    useTheme,
    ThemeProvider,
    createTheme,
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

    // --- Helper function for Emotional Status ---
    const emotionalStatus = useMemo(() => {
        if (businessContext.stage === 'survival' || businessContext.burningPriority === 'cash-flow') {
            return 'urgent';
        }
        return 'neutral';
    }, [businessContext]);

    const getEmotionalBorder = () => {
        return emotionalStatus === 'urgent' ? `4px solid ${theme.palette.error.main}` : 'none';
    };

    // --- State for config menu ---
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // ---  Focus management for config menu ---
    useEffect(() => {
        if (isMenuOpen && menuContainerRef.current) {
            const firstFocusable = menuContainerRef.current.querySelector(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            ) as HTMLElement;

            if (firstFocusable) {
                setTimeout(() => firstFocusable.focus(), 0);
            }
        }
    }, [isMenuOpen]);

    // --- [CORRECTED] Create an "inverted" theme for light cards in dark mode ---
    const lightCardTheme = useMemo(() => {
        // If we're in light mode, just use the regular theme. No inversion needed.
        if (theme.palette.mode !== 'dark') {
            return theme;
        }

        // We are in DARK MODE. Create a new theme that forces
        // the LIGHT MODE text, background, and divider colors.
        // These values are from your palette.ts (lightColors) & presetColors.ts
        return createTheme(theme, {
            palette: {
                mode: 'light', // Set the mode to light for this theme
                text: {
                    primary: '#334155',   // colors.grey700
                    secondary: '#64748B', // colors.grey500
                    disabled: '#CBD5E1',  // colors.grey300
                },
                background: {
                    paper: '#ffffff',   // colors.paper
                    default: '#F8FAFC', // colors.grey50
                },
                divider: '#E2E8F0', // colors.grey200
            }
        });
    }, [theme]); // Re-calculate whenever the theme changes

    // --- RENDER BODY (State Machine) ---
    const renderBody = () => {
        if (error) {
            return (
                <Alert severity="error" data-testid="error-state">
                    {error}
                </Alert>
            );
        }

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

        if (isEmpty) {
            return (
                <Box data-testid="empty-state" sx={{ textAlign: 'center', p: 3 }}>
                    <Typography variant="body2" color="textSecondary">No data to display.</Typography>
                </Box>
            );
        }

        return children;
    };

    // --- Helper function to get severity color ---
    const getSeverityColor = () => {
        // This is OK. The lightCardTheme inherits 'error', 'warning', etc.
        // from the base 'theme', so these colors will be consistent.
        switch (insightSeverity) {
            case 'critical':
                return theme.palette.error.main;
            case 'warning':
                return theme.palette.warning.main;
            case 'positive':
                return theme.palette.success.main;
            default:
                // Use the new theme's text.secondary for the default
                return lightCardTheme.palette.text.secondary;
        }
    };

    // --- RENDER FOOTER (Intelligence Levels) ---
    const renderFooter = () => {
        if (intelligenceLevel === 'L1') {
            return null;
        }

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
                backgroundColor: (theme) =>
                    theme.palette.mode === 'dark'
                        ? '#ffffff' // The "light island" background
                        : theme.palette.background.paper, // Normal light mode paper
                borderRadius: 1
            }}
        >
            <ThemeProvider theme={lightCardTheme}>
                {/* --- HEADER --- */}
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                        {headerLink ? (
                            <Link
                                component={RouterLink}
                                to={headerLink}
                                underline="hover"
                                color="inherit"
                                // --- FIX 1: Use a callback to get the lightCardTheme ---
                                sx={{ textDecorationColor: (theme) => theme.palette.text.primary, lineHeight: 1.2 }}
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

                    {/* ---  Wrap config menu with ref for focus management --- */}
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
                            // --- FIX 2: Use a callback to get the lightCardTheme ---
                            borderTop: (theme) => `1px solid ${theme.palette.divider}`
                        }}
                        data-testid="widget-footer"
                    >
                        {renderFooter()}
                    </Box>
                )}
                
                {/* --- FIX 3: Removed extra </Stack> tag --- */}

            </ThemeProvider>
        </Box>
    );
};