/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/pages/authentication/jwt/AuthRegister.tsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';

// -- ANALYTICS 
import { useUiEvents } from '../../../analytics/useUiEvents';
import { identifyUser, groupByShop } from '../../../analytics/adapter';

// -- AUTH

// material-ui
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';

// third party
import * as Yup from 'yup';
import { Formik, FormikHelpers } from 'formik';

// project imports
import AnimateButton from 'ui-component/extended/AnimateButton';
import FormControl from '@mui/material/FormControl';
import { strengthColor, strengthIndicator } from 'utils/password-strength'; // Assuming this util exists

// assets
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

// auth
import { useAuth } from '../../../contexts/AuthContext';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

// ===========================|| JWT - REGISTER ||=========================== //

// Define props interface
interface JWTRegisterProps { [key: string]: any; } // Use 'any' for extra props

// Define Formik values interface
interface RegisterFormValues {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  agreed: boolean;
  submit: string | null;
}

export interface StringColorProps {
    id?: string;
    label?: string;
    color?: string;
    primary?: string;
    secondary?: string;
}

export default function JWTRegister({ ...others }: JWTRegisterProps) {
  const theme = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const { emit } = useUiEvents();

  // Terms agreement — controlled by Formik, not local state

  const [strength, setStrength] = useState(0);
  const [level, setLevel] = useState<StringColorProps>();

  const navigate = useNavigate();
  const auth = useAuth();

  const handleClickShowPassword = () => {
    setShowPassword(!showPassword);
  };

  const handleMouseDownPassword = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  const changePassword = (value: string) => {
    const temp = strengthIndicator(value);
    setStrength(temp);
    // AUTH-010: wire strength label/color — strengthColor reads from _themes-vars.module.scss
    setLevel(strengthColor(temp));
  };

  // Placeholder functions (replace or remove)
  /* const strengthIndicator = (value: string): number => value.length; // Simple length check
    level < 5 ? { color: 'error.main', label: 'Weak' } : { color: 'success.main', label: 'Strong' }; */

  useEffect(() => {
    changePassword('');
  }, []);

  return (
    <>

      <Formik
        initialValues={{
          email: '',
          password: '',
          firstName: '',
          lastName: '',
          agreed: false,
          submit: null
        }}
        validationSchema={Yup.object().shape({
          firstName: Yup.string()
            .trim()
            .required('First name is required')
            .min(2, 'First name must be at least 2 characters')
            .max(50, 'First name must not exceed 50 characters')
            // Names must support international users: Åsa, O'Connor, Anne-Marie.
            .matches(/^[\p{L}\p{M}]+(?:[\p{L}\p{M}\s'’-]*[\p{L}\p{M}])?$/u, 'First name can only contain letters, spaces, apostrophes, or hyphens'),
          lastName: Yup.string()
            .trim()
            .required('Last name is required')
            .min(2, 'Last name must be at least 2 characters')
            .max(50, 'Last name must not exceed 50 characters')
            // Names must support international users: Åsa, O'Connor, Anne-Marie.
            .matches(/^[\p{L}\p{M}]+(?:[\p{L}\p{M}\s'’-]*[\p{L}\p{M}])?$/u, 'Last name can only contain letters, spaces, apostrophes, or hyphens'),
          email: Yup.string().email('Must be a valid email').max(255).required('Email is required'),
          password: Yup.string()
            .required('Password is required')
            .test('no-leading-trailing-whitespace', 'Password can not start or end with spaces', (value) => value === value.trim())
            // Creation policy: strong enough for merchants, still password-manager friendly.
            .min(8, 'Password must be at least 8 characters')
            .max(72, 'Password must be 72 characters or fewer'),
          agreed: Yup.boolean()
            .oneOf([true], 'You must agree to the Terms and Privacy policy.')
            .required(),
        })}
        onSubmit={async (values, { setErrors, setStatus, setSubmitting }: FormikHelpers<RegisterFormValues>) => {
          try {
            // --- Call the backend API ---
            const trimmedFirstName = values.firstName.trim();
            const trimmedLastName = values.lastName.trim();
            const trimmedEmail = values.email.trim();
            // await register?.(trimmedEmail, values.password, trimmedFirstName, trimmedLastName);

            const response = await axiosInstance.post('/api/v1/auth/register', {
              firstName: trimmedFirstName,
              lastName: trimmedLastName,
              email: trimmedEmail,
              password: values.password // Send password as is
            });

            // --- ANALYTICS: signup success (NO PII) ---
            // AUTH-019: backend returns { user: publicUser } — not flat { id }
            if (response.data.user?.id) {
              const newUser = response.data.user;
              emit('auth.signup.success', {
                user_id: newUser.id,
                shop_id: newUser.shop_id ?? null,
              });

              /**
               * POSTHOG IDENTITY (PH-01)
               * ─────────────────────────
               * New user — link anonymous www session to freshly created account.
               * This is the most critical identity call in the funnel:
               * it connects the marketing attribution (utm_source, CTA clicked)
               * to the signup conversion event.
               * groupByShop() must follow — shop is the unit of revenue.
               */
              identifyUser(newUser.id, newUser.shop_id, {
                plan: newUser.plan,
                trial_ends_at: newUser.trial_ends_at,
                created_at: newUser.created_at,
              });
              if (newUser.shop_id) groupByShop(newUser.shop_id);
            }
 
           // AUTH-006: auto-login after registration — backend now returns accessToken.
            // Navigate to connect-store step without requiring a second login.
            if (response.data.accessToken && response.data.user) {
              auth.login(response.data.user, response.data.accessToken);
              localStorage.setItem('user', JSON.stringify(response.data.user));
            }

            setStatus({ success: true });
            setSubmitting(false);

            // AUTH-007: go to inbox check first — verify email before connect-store
            navigate('/check-inbox');

          } catch (err: any) { // <-- Add Type
            console.error("Register error:", err); // <-- Temporary log
            setStatus({ success: false });
            setErrors({ submit: err.message || 'Registration failed' }); // Generic message
            // if (scriptedRef.current)

            // Extract error message from API response if available
            const rawError = err.response?.data?.error;

            // --- ANALYTICS SAFE ERROR NORMALIZATION ---
            const errorCode =
              rawError === 'User already exists' ? 'user_exists' :
              rawError === 'Invalid email' ? 'invalid_email' :
              rawError === 'Weak password' ? 'weak_password' :
              'unknown_error';

            const apiError = rawError || 'Registration failed. Please try again.';

            setErrors({ submit: apiError });

            // --- ANALYTICS: signup failure ---
            emit('auth.signup.failed', {
              error_code: errorCode
            });

            setSubmitting(false);
          }
        }}
      >
        {({ errors, handleBlur, handleChange, handleSubmit, isSubmitting, touched, values }: any) => (
          <form noValidate onSubmit={handleSubmit} {...others}>
            <Grid container spacing={{ xs: 0, sm: 2 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth error={Boolean(touched.firstName && errors.firstName)} sx={{ mt: 1, mb: 1 }}>
                  <OutlinedInput
                    id="outlined-adornment-first-register"
                    type="text"
                    name="firstName"
                    value={values.firstName}
                    onBlur={handleBlur}
                    onChange={handleChange}
                    placeholder="First Name"
                  />
                  {touched.firstName && errors.firstName && (
                    <FormHelperText error id="standard-weight-helper-text--register">
                      {errors.firstName}
                    </FormHelperText>
                  )}
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth error={Boolean(touched.lastName && errors.lastName)} sx={{ mt: 1, mb: 1 }}>
                  <OutlinedInput
                    id="outlined-adornment-last-register"
                    type="text"
                    name="lastName"
                    value={values.lastName}
                    onBlur={handleBlur}
                    onChange={handleChange}
                    placeholder="Last Name"
                  />
                  {touched.lastName && errors.lastName && (
                    <FormHelperText error id="standard-weight-helper-text--register">
                      {errors.lastName}
                    </FormHelperText>
                  )}
                </FormControl>
              </Grid>
            </Grid>

            <FormControl fullWidth error={Boolean(touched.email && errors.email)} sx={{ mt: 1, mb: 1 }}>
              <OutlinedInput
                id="outlined-adornment-email-register"
                type="email"
                value={values.email}
                name="email"
                onBlur={handleBlur}
                onChange={handleChange}
                placeholder="Work email"
                startAdornment={
                  <InputAdornment position="start">
                    <MailOutlineIcon sx={{ color: 'var(--ink-4)', fontSize: 18 }} />
                  </InputAdornment>
                }
              />
              {touched.email && errors.email && (
                <FormHelperText error id="standard-weight-helper-text--register">
                  {errors.email}
                </FormHelperText>
              )}
            </FormControl>

            <FormControl fullWidth error={Boolean(touched.password && errors.password)} sx={{ mt: 1, mb: 1 }}>
              <OutlinedInput
                id="outlined-adornment-password-register"
                type={showPassword ? 'text' : 'password'}
                value={values.password}
                name="password"
                placeholder="Password"
                onBlur={handleBlur}
                onChange={(e) => { handleChange(e); changePassword(e.target.value); }}
                startAdornment={
                  <InputAdornment position="start">
                    <LockOutlinedIcon sx={{ color: 'var(--ink-4)', fontSize: 18 }} />
                  </InputAdornment>
                }
                endAdornment={
                  <InputAdornment position="end">
                    <IconButton aria-label="toggle password visibility" onClick={handleClickShowPassword} onMouseDown={handleMouseDownPassword} edge="end" size="large">
                      {showPassword ? <Visibility /> : <VisibilityOff />}
                    </IconButton>
                  </InputAdornment>
                }
              />
              {touched.password && errors.password && (
                <FormHelperText error id="standard-weight-helper-text-password-register">
                  {errors.password}
                </FormHelperText>
              )}
            </FormControl>

            {strength !== 0 && (
              <FormControl fullWidth>
                <Box sx={{ mb: 2 }}>
                  {/* AUTH-010: 4-segment strength bar matching target A2 */}
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                    {[1, 2, 3, 4].map((seg) => (
                      <Box
                        key={seg}
                        sx={{
                          flex: 1,
                          height: 6,
                          borderRadius: '3px',
                          bgcolor: strength >= seg
                            ? strength <= 1 ? '#EF4444'
                            : strength <= 2 ? '#F59E0B'
                            : strength <= 3 ? '#3B82F6'
                            : '#22C55E'
                            : 'var(--rule-2)',
                          transition: 'background-color 0.2s',
                        }}
                      />
                    ))}
                    <Typography variant="caption" sx={{ color: 'var(--ink-3)', minWidth: 52, textAlign: 'right' }}>
                      {level?.label}
                    </Typography>
                  </Stack>
                </Box>
              </FormControl>
            )}

            <FormControlLabel
              control={<Checkbox checked={values.agreed} onChange={handleChange} name="agreed" color="primary" />}
              label={
                <Typography variant="subtitle1">
                  {/* AUTH-011: split links matching target A2 */}
                  I agree to the{' '}
                  <Typography variant="subtitle1" component="a" href="https://www.lasyncro.com/terms" target="_blank" rel="noopener noreferrer" sx={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    Terms
                  </Typography>
                  {' '}and{' '}
                  <Typography variant="subtitle1" component="a" href="https://www.lasyncro.com/privacy" target="_blank" rel="noopener noreferrer" sx={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    Privacy policy.
                  </Typography>
                </Typography>
              }
            />
            {touched.agreed && errors.agreed && (
              <FormHelperText error>{errors.agreed}</FormHelperText>
            )}
            {errors.submit && (
              <Box sx={{ mt: 3 }}>
                <FormHelperText error>{errors.submit}</FormHelperText>
              </Box>
            )}

            <Box sx={{ mt: 2 }}>
              <AnimateButton>
                {/* THEME-001: LaSyncro accent CTA — never color="secondary" (MUI amber) */}
                <Button disableElevation disabled={isSubmitting} fullWidth size="large" type="submit" variant="contained"
                  sx={{ bgcolor: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, '&:hover': { bgcolor: 'var(--accent-hover)' }, '&:disabled': { opacity: 0.6 } }}>
                  Continue →
                </Button>
              </AnimateButton>
            </Box>
          </form>
        )}
      </Formik>
    </>
  );
}