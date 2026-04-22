/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/pages/authentication/jwt/AuthRegister.tsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';

// -- ANALYTICS 
import { useAuth } from 'contexts/AuthContext';
import { useUiEvents } from 'analytics/useUiEvents';

// material-ui
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

// third party
import * as Yup from 'yup';
import { Formik, FormikHelpers } from 'formik';

// project imports
import AnimateButton from 'ui-component/extended/AnimateButton';
import CustomFormControl from 'ui-component/extended/Form/CustomFormControl';
import { strengthColor, strengthIndicator } from 'utils/password-strength'; // Assuming this util exists

// assets
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

// ===========================|| JWT - REGISTER ||=========================== //

// Define props interface
interface JWTRegisterProps { [key: string]: any; } // Use 'any' for extra props

// Define Formik values interface
interface RegisterFormValues {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
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
  const [checked, setChecked] = useState(true);
  const { emit } = useUiEvents();

  const [strength, setStrength] = useState(0);
  const [level, setLevel] = useState<StringColorProps>();

  const handleClickShowPassword = () => {
    setShowPassword(!showPassword);
  };

  const handleMouseDownPassword = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  const changePassword = (value: string) => {
    const temp = strengthIndicator(value);
    setStrength(temp);
    //setLevel(strengthColor(temp));
  };

  // Placeholder functions (replace or remove)
  /* const strengthIndicator = (value: string): number => value.length; // Simple length check
  const strengthColor = (level: number): StrengthLevel => // Simple color logic
    level < 5 ? { color: 'error.main', label: 'Weak' } : { color: 'success.main', label: 'Strong' }; */

  useEffect(() => {
    changePassword('');
  }, []);

  return (
    <>
      <Stack sx={{ mb: 2, alignItems: 'center' }}>
        <Typography variant="subtitle1">Sign up with Email address </Typography>
      </Stack>

      <Formik
        initialValues={{
          email: '',
          password: '',
          firstName: '',
          lastName: '',
          submit: null
        }}
        validationSchema={Yup.object().shape({
          firstName: Yup.string()
            .trim()
            .required('First name is required')
            .min(2, 'First name must be at least 2 characters')
            .max(50, 'First name must not exceed 50 characters')
            .matches(/^[A-Za-z\s]+$/, 'First name can only contain letters and spaces'),
          lastName: Yup.string()
            .trim()
            .required('Last name is required')
            .min(2, 'Last name must be at least 2 characters')
            .max(50, 'Last name must not exceed 50 characters')
            .matches(/^[A-Za-z\s]+$/, 'Last name can only contain letters and spaces'),
          email: Yup.string().email('Must be a valid email').max(255).required('Email is required'),
          password: Yup.string()
            .required('Password is required')
            .test('no-leading-trailing-whitespace', 'Password can not start or end with spaces', (value) => value === value.trim())
            .max(25, 'Password must be less than 25 characters')
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
            if (response.data.id) {
              const newUserId = response.data.id.toString();

              emit('auth.signup.success', {
                user_id: newUserId
              });
            }
 
           // --- SUCCESS: Registration completed ---
            // Registration does NOT authenticate the user.
            // Force clean transition to login.
            setStatus({ success: true });
            setSubmitting(false);

            // Full reload ensures no app bootstrap runs without auth
            window.location.href = '/login';

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
                <CustomFormControl fullWidth error={Boolean(touched.firstName && errors.firstName)}>
                  <InputLabel htmlFor="outlined-adornment-first-register">First Name</InputLabel>
                  <OutlinedInput
                    id="outlined-adornment-first-register"
                    type="text"
                    name="firstName"
                    value={values.firstName}
                    onBlur={handleBlur}
                    onChange={handleChange}
                  />
                  {touched.firstName && errors.firstName && (
                    <FormHelperText error id="standard-weight-helper-text--register">
                      {errors.firstName}
                    </FormHelperText>
                  )}
                </CustomFormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <CustomFormControl fullWidth error={Boolean(touched.lastName && errors.lastName)}>
                  <InputLabel htmlFor="outlined-adornment-last-register">Last Name</InputLabel>
                  <OutlinedInput
                    id="outlined-adornment-last-register"
                    type="text"
                    name="lastName"
                    value={values.lastName}
                    onBlur={handleBlur}
                    onChange={handleChange}
                  />
                  {touched.lastName && errors.lastName && (
                    <FormHelperText error id="standard-weight-helper-text--register">
                      {errors.lastName}
                    </FormHelperText>
                  )}
                </CustomFormControl>
              </Grid>
            </Grid>
            <CustomFormControl fullWidth error={Boolean(touched.email && errors.email)}>
              <InputLabel htmlFor="outlined-adornment-email-register">Email Address / Username</InputLabel>
              <OutlinedInput
                id="outlined-adornment-email-register"
                type="email"
                value={values.email}
                name="email"
                onBlur={handleBlur}
                onChange={handleChange}
              />
              {touched.email && errors.email && (
                <FormHelperText error id="standard-weight-helper-text--register">
                  {errors.email}
                </FormHelperText>
              )}
            </CustomFormControl>

            <CustomFormControl fullWidth error={Boolean(touched.password && errors.password)}>
              <InputLabel htmlFor="outlined-adornment-password-register">Password</InputLabel>
              <OutlinedInput
                id="outlined-adornment-password-register"
                type={showPassword ? 'text' : 'password'}
                value={values.password}
                name="password"
                label="Password"
                onBlur={handleBlur}
                onChange={(e) => {
                  handleChange(e);
                  changePassword(e.target.value);
                }}
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
                <FormHelperText error id="standard-weight-helper-text-password-register">
                  {errors.password}
                </FormHelperText>
              )}
            </CustomFormControl>

            {strength !== 0 && (
              <FormControl fullWidth>
                <Box sx={{ mb: 2 }}>
                  <Stack direction="row" sx={{ gap: 2, alignItems: 'center' }}>
                    <Box sx={{ width: 85, height: 8, borderRadius: '7px', bgcolor: level?.color }} />
                    <Typography variant="subtitle1" sx={{ fontSize: '0.75rem' }}>
                      {level?.label}
                    </Typography>
                  </Stack>
                </Box>
              </FormControl>
            )}

            <FormControlLabel
              control={<Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)} name="checked" color="primary" />}
              label={
                <Typography variant="subtitle1">
                  Agree with &nbsp;
                  <Typography variant="subtitle1" component={Link} to="#">
                    Terms & Condition.
                  </Typography>
                </Typography>
              }
            />
            {errors.submit && (
              <Box sx={{ mt: 3 }}>
                <FormHelperText error>{errors.submit}</FormHelperText>
              </Box>
            )}

            <Box sx={{ mt: 2 }}>
              <AnimateButton>
                <Button disableElevation disabled={isSubmitting} fullWidth size="large" type="submit" variant="contained" color="secondary">
                  Sign up
                </Button>
              </AnimateButton>
            </Box>
          </form>
        )}
      </Formik>
    </>
  );
}