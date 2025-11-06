// packages/ui/src/pages/authentication/jwt/AuthLogin.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { axiosInstance as axios } from 'api/axiosConfig';

// -- ANALYTICS
import { PostHog } from 'posthog-js/react';

// material-ui
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useAuth } from 'contexts/AuthContext';

// third party
import * as Yup from 'yup';
import { Formik } from 'formik';

// project imports
import AnimateButton from 'ui-component/extended/AnimateButton';
import CustomFormControl from 'ui-component/extended/Form/CustomFormControl';

// assets
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

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
  posthog: PostHog;
  [key: string]: any;
}

interface LoginFormValues {
  email: string;
  password: string;
}

export default function JWTLogin({ posthog, ...others }: AuthLoginProps) {
  const auth = useAuth();
  const navigate = useNavigate();

  // --- NATIVE ERROR CATCHER ---
  // A React state to hold and display submission errors
  const [submitError, setSubmitError] = useState<string | null>(null);
  // --- END NATIVE ERROR CATCHER ---

  const [checked, setChecked] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [searchParams] = useSearchParams();
  const authParam = searchParams.get('auth');
  const isLoggedIn = false; // Placeholder

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
        // Clear any previous errors on a new submission
        setSubmitError(null);
        // DEBUG: Log when submission starts.
        // console.log('[DEBUG] onSubmit START. isSubmitting should be true.');

        try {
          // --- Call the backend API ---
          const response = await axios.post('/api/v1/auth/login', {
            email: values.email.trim(),
            password: values.password,
          });

          console.log('--- [LOGIN DEBUG 2] ---');

          // --- Call AuthContext to store token and user data ---
          if (response.data.accessToken && response.data.user) {
            console.log('--- [LOGIN DEBUG 3] ---');
            auth.login(response.data.user, response.data.accessToken);

            // --- [START POSTHOG ANALYTICS] ---
            const user = response.data.user;
            posthog.identify(user.id, {
              email: user.email,
              name: user.name,
            });
            posthog.capture('user_login_success');
            // --- [END POSTHOG] ---

            navigate('/dashboard');
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
        <form noValidate onSubmit={handleSubmit} {...others}>
          {/* Email Input */}
          <CustomFormControl fullWidth error={Boolean(touched.email && errors.email)}>
            <InputLabel htmlFor="outlined-adornment-email-login">Email Address / Username</InputLabel>
            <OutlinedInput
              id="outlined-adornment-email-login"
              type="email"
              value={values.email}
              name="email"
              onBlur={handleBlur}
              onChange={handleChange}
            />
            {touched.email && errors.email && (
              <FormHelperText error id="standard-weight-helper-text-email-login">
                {errors.email}
              </FormHelperText>
            )}
          </CustomFormControl>

          {/* Password Input */}
          <CustomFormControl fullWidth error={Boolean(touched.password && errors.password)}>
            <InputLabel htmlFor="outlined-adornment-password-login">Password</InputLabel>
            <OutlinedInput
              id="outlined-adornment-password-login"
              type={showPassword ? 'text' : 'password'}
              value={values.password}
              name="password"
              onBlur={handleBlur}
              onChange={handleChange}
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
              label="Password"
            />
            {touched.password && errors.password && (
              <FormHelperText error id="standard-weight-helper-text-password-login">
                {errors.password}
              </FormHelperText>
            )}
          </CustomFormControl>

          {/* Remember Me & Forgot Password */}
          <Grid container sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Grid>
              <FormControlLabel
                control={<Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)} name="checked" color="primary" />}
                label="Keep me logged in"
              />
            </Grid>
            <Grid>
              <Typography
                variant="subtitle1"
                component={Link}
                to={isLoggedIn ? '/pages/forgot-password/forgot-password3' : authParam ? `/forgot-password?auth=${authParam}` : '/forgot-password'}
                sx={{ textDecoration: 'none', color: 'secondary.main' }}
              >
                Forgot Password?
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
              <Button color="secondary" disabled={isSubmitting} fullWidth size="large" type="submit" variant="contained">
                Sign In
              </Button>
            </AnimateButton>
          </Box>
        </form>
      )}
    </Formik>
  );
}