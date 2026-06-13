// apps/frontend/src/pages/authentication/jwt/AuthLogin.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import { clearToken } from 'utils/authStore';

// -- ANALYTICS
import { useUiEvents } from '../../../analytics/useUiEvents';
import { identifyUser, groupByShop } from '../../../analytics/adapter';

// material-ui
import Button from '@mui/material/Button';
import FormHelperText from '@mui/material/FormHelperText';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useAuth } from '../../../contexts/AuthContext';

// third party
import * as Yup from 'yup';
import { Formik } from 'formik';

// project imports
import AnimateButton from 'ui-component/extended/AnimateButton';
import FormControl from '@mui/material/FormControl';

// assets
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import OAuthButtons from '../OAuthButtons';

import MailOutlineIcon from '@mui/icons-material/MailOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

// ===============================|| ERROR HANDLER ||=============================== //

/**
 * Translates an API error (or network error) into a user-friendly string.
 * @param error The error object caught from the try/catch block.
 * @returns A user-friendly error message string.
 */
function getErrorMessage(error: any): string {
  // Check if it's an API response error (e.g., 401, 404, 500)
  if (error.response) {
    const status = error.response.status;
    const serverMessage = error.response.data?.error; // e.g., { "error": "Invalid password" }

    switch (status) {
      case 400:
        return serverMessage || 'Invalid request. Please check your input.';
      case 401:
        return serverMessage || 'Invalid email or password. Please try again.';
      case 403:
        return serverMessage || 'Account temporarily locked or disabled. Please contact support.';
      case 404:
        return serverMessage || 'Authentication service unavailable. Please try again later.';
      case 422:
        return serverMessage || 'Validation failed. Please check your input.';
      case 429:
        return 'Too many login attempts. Please wait a few minutes before trying again.';
      case 500:
      case 502:
      case 503:
        return 'Service temporarily unavailable. Please try again in a few moments.';
      default:
        return serverMessage || `Authentication failed (${status}). Please try again.`;
    }
  } 
  // Check if it's a network error (server is down, no internet)
  else if (error.request) {
    return 'Unable to connect to the server. Please check your internet connection and try again.';
  }
  // Check if it's a standard JavaScript error (e.g., our "Invalid login response" throw)
  else if (error.message) {
    return error.message;
  }
  // Fallback for unknown errors
  return 'An unexpected error occurred. Please try again.';
}

// ===============================|| JWT - LOGIN ||=============================== //

interface AuthLoginProps {
  [key: string]: any;
}

interface LoginFormValues {
  email: string;
  password: string;
}

export default function JWTLogin({ ...others }: AuthLoginProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { emit } = useUiEvents();

  // --- NATIVE ERROR CATCHER ---
  // A React state to hold and display submission errors
  const [submitError, setSubmitError] = useState<string | null>(null);
  // --- END NATIVE ERROR CATCHER ---
  const [showPassword, setShowPassword] = useState(false);
  const [searchParams] = useSearchParams();
  const authParam = searchParams.get('auth');

  const handleClickShowPassword = () => {
    setShowPassword(!showPassword);
  };
  const handleMouseDownPassword = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <Formik
      initialValues={{
        email: '',
        password: '',
      }}
      validationSchema={Yup.object().shape({
        email: Yup.string().email('Must be a valid email').max(255).required('Email is required'),
        password: Yup.string()
          .required('Password is required')
          .test('no-leading-trailing-whitespace', 'Password cannot start or end with spaces', (value) => value === value.trim())
          .max(25, 'Password must be less than 25 characters'),
      })}
      onSubmit={async (values, { setSubmitting }) => {
        setSubmitError(null);
        clearToken();
        try {
          console.info('[AUTH][LOGIN_ATTEMPT]', {
            email: values.email.trim(),
          });
          // --- Call the backend API ---
          const response = await axiosInstance.post('/api/v1/auth/login', {
            email: values.email.trim(),
            password: values.password,
          });

          // --- Call AuthContext to store token and user data ---
          if (response.data.accessToken && response.data.user) {
            auth.login(response.data.user, response.data.accessToken);

            // --- [START POSTHOG ANALYTICS] ---
            const user = response.data.user;

            // --- ANALYTICS: login success (NO PII) ---
            emit('auth.login.success', {
              user_id: user.id,
              shop_id: user.shop_id ?? null,
              tier: user.plan ?? null,
            });

            /**
             * POSTHOG IDENTITY (PH-01)
             * ─────────────────────────
             * Link the anonymous www session to this authenticated user.
             * groupByShop() must follow — shop is the unit of revenue.
             * Called here (not in adapter) so it fires after auth state is set.
             */
            identifyUser(user.id, user.shop_id, {
              plan: user.plan,
              trial_ends_at: user.trial_ends_at,
              created_at: user.created_at,
            });
            if (user.shop_id) groupByShop(user.shop_id);

            console.info('[AUTH][LOGIN_SUCCESS]', {
              userId: response.data.user.id,
            });

            const savedPath = sessionStorage.getItem('returnTo');
            sessionStorage.removeItem('returnTo');
            const landingPath = response.data.user?.role === 'operator'
              ? '/wms'
              : (savedPath && savedPath !== '/login' ? savedPath : '/overview');
            navigate(landingPath);
          } else {
            console.error('--- [LOGIN DEBUG 4] ---');
            throw new Error('Invalid login response from server.');
          }
        } catch (err: any) {
          console.error('--- [LOGIN DEBUG 5] ---');
          
          // --- ROBUST ERROR HANDLER ---
          // Call our new helper function to get a user-friendly message
          const errorMessage = getErrorMessage(err);
          console.error('User-facing error:', errorMessage);

          // --- ANALYTICS SAFE ERROR NORMALIZATION ---
          const errorCode =
            errorMessage.includes('Invalid credentials') ? 'invalid_credentials' :
            errorMessage.includes('User not found') ? 'user_not_found' :
            'unknown_error';

          // --- ANALYTICS: login failure ---
          emit('auth.login.failed', {
            error_code: errorCode
          });
          
          // Propagate the error to our native state hook
          setSubmitError(errorMessage);
          // --- END ROBUST ERROR HANDLER ---
        } finally {
          // --- RELIABLE BUTTON RE-ENABLE ---
          // This block runs every time, on success or failure.
          // DEBUG: Log right before we re-enable the button.
          // console.log('[DEBUG] onSubmit FINALLY block. Calling setSubmitting(false).');
          setSubmitting(false);
          // --- END RELIABLE BUTTON RE-ENABLE ---
        }
      }}
    >
      {({
        errors,
        handleBlur,
        handleChange,
        handleSubmit,
        isSubmitting, // This will be true, then false, every time
        touched,
        values,
      }: {
        errors: any;
        handleBlur: any;
        handleChange: any;
        handleSubmit: any;
        isSubmitting: boolean;
        touched: any;
        values: LoginFormValues;
      }) => (
        <>
          <OAuthButtons mode="login" />
          <form noValidate onSubmit={handleSubmit} {...others}>
          {/* Email Input */}
          <FormControl fullWidth error={Boolean(touched.email && errors.email)} sx={{ mt: 1, mb: 1 }}>
            <OutlinedInput
              id="outlined-adornment-email-login"
              type="email"
              value={values.email}
              name="email"
              onBlur={handleBlur}
              onChange={handleChange}
              placeholder="Email address"
              startAdornment={
                <InputAdornment position="start">
                  <MailOutlineIcon sx={{ color: 'var(--ink-4)', fontSize: 18 }} />
                </InputAdornment>
              }
            />
            {touched.email && errors.email && (
              <FormHelperText error id="standard-weight-helper-text-email-login">
                {errors.email}
              </FormHelperText>
            )}
          </FormControl>

          {/* Password Input */}
          <FormControl fullWidth error={Boolean(touched.password && errors.password)} sx={{ mt: 1, mb: 1 }}>
            <OutlinedInput
              id="outlined-adornment-password-login"
              type={showPassword ? 'text' : 'password'}
              value={values.password}
              name="password"
              onBlur={handleBlur}
              onChange={handleChange}
              placeholder="Password"
              startAdornment={
                <InputAdornment position="start">
                  <LockOutlinedIcon sx={{ color: 'var(--ink-4)', fontSize: 18 }} />
                </InputAdornment>
              }
              endAdornment={
                <InputAdornment position="end">
                  <IconButton
                    aria-label="toggle password visibility"
                    onClick={handleClickShowPassword}
                    onMouseDown={handleMouseDownPassword}
                    edge="end"
                    size="large"
                  >
                    {showPassword ? <Visibility /> : <VisibilityOff />}
                  </IconButton>
                </InputAdornment>
              }
            />
            {touched.password && errors.password && (
              <FormHelperText error id="standard-weight-helper-text-password-login">
                {errors.password}
              </FormHelperText>
            )}
          </FormControl>

          <Grid container sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Grid>
                {/* Keep me logged in removed — B2B default is persistent sessions (7-day refresh token) */}
              </Grid>
              <Grid>
              <Typography
                variant="subtitle1"
                component={Link}
                to={authParam ? `/forgot-password?auth=${authParam}` : '/forgot-password'}
                sx={{ textDecoration: 'none', color: 'var(--accent)' }}
              >
                Forgot password?
              </Typography>
            </Grid>
          </Grid>

          {/* --- NATIVE ERROR DISPLAY --- */}
          {/* This block reads from our native 'submitError' state */}
          {submitError && (
            <Box sx={{ mt: 3 }}>
              <FormHelperText error>{submitError}</FormHelperText>
            </Box>
          )}
          {/* --- END NATIVE ERROR DISPLAY --- */}

          {/* Submit Button */}
          <Box sx={{ mt: 2 }}>
            <AnimateButton>
              {/* This button is now safe to use! */}
              {/* THEME-001: LaSyncro accent CTA — never color="secondary" (MUI amber) */}
              <Button disabled={isSubmitting} fullWidth size="large" type="submit" variant="contained"
                sx={{ bgcolor: 'var(--accent)', color: '#fff', fontWeight: 700, '&:hover': { bgcolor: 'var(--accent-hover)' }, '&:disabled': { opacity: 0.6 } }}>
                Sign in →
              </Button>
            </AnimateButton>
          </Box>
        </form>
        </>
      )}
    </Formik>
  );
}