/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

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
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

// third party
import * as Yup from 'yup';
import { Formik, FormikHelpers } from 'formik';

// project imports
import AnimateButton from 'ui-component/extended/AnimateButton'; // <-- Verify alias
import CustomFormControl from 'ui-component/extended/Form/CustomFormControl'; // <-- Verify alias
// import useAuth from 'hooks/useAuth'; // <-- COMMENT OUT
// import useScriptRef from 'hooks/useScriptRef';

// assets
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

// ===============================|| JWT - LOGIN ||=============================== //

// Define props interface (accepts any other props Formik might pass)
interface JWTLoginProps { [key: string]: any; }

interface LoginFormValues {
  email: string;
  password: string;
  submit: string | null;
}

export default function JWTLogin({ ...others }: JWTLoginProps) {
  // const { login, isLoggedIn } = useAuth(); // <-- COMMENT OUT
  // const scriptedRef = useScriptRef(); // <-- COMMENT OUT
  const [checked, setChecked] = useState(true);
  const isLoggedIn = false;

  const [showPassword, setShowPassword] = useState(false);
  const handleClickShowPassword = () => {
    setShowPassword(!showPassword);
  };

 const handleMouseDownPassword = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  const [searchParams] = useSearchParams();
  const authParam = searchParams.get('auth');

  return (
    <Formik
      initialValues={{
        email: '',
        password: '',
        submit: null
      }}
      validationSchema={Yup.object().shape({
        email: Yup.string().email('Must be a valid email').max(255).required('Email is required'),
        password: Yup.string()
          .required('Password is required')
          .test('no-leading-trailing-whitespace', 'Password can not start or end with spaces', (value) => value === value.trim())
          .max(10, 'Password must be less than 10 characters')
      })}
      onSubmit={async (values, { setErrors, setStatus, setSubmitting }: FormikHelpers<LoginFormValues>) => { // <-- Add FormikHelpers type
        try {
          console.log('Login attempt:', values.email); // <-- Temporary log
          // TODO (#389): Replace with Axios call to /api/v1/auth/login
          // const trimmedEmail = values.email.trim();
          // await login?.(trimmedEmail, values.password); // <-- Original call

          // Simulate success for now
          setStatus({ success: true });
          setSubmitting(false);
          // if (scriptedRef.current) { ... } // <-- Removed script ref check
        } catch (err) {
          console.error("Login error:", err); // <-- Temporary log
          setStatus({ success: false });
          setErrors({ submit: err.message || 'Login failed' }); // Use generic message
          setSubmitting(false);
          // if (scriptedRef.current) { ... } // <-- Removed script ref check
        }
      }}
    >
      {({ 
        errors, 
        handleBlur, 
        handleChange, 
        handleSubmit, 
        isSubmitting, 
        touched, 
        values }: 
        { errors: any, handleBlur: any, handleChange: any, handleSubmit: any, isSubmitting: boolean, touched: any, values: LoginFormValues }) => (
        <form noValidate onSubmit={handleSubmit} {...others}>
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

          <Grid container sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Grid>
              <FormControlLabel
                control={
                  <Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)} name="checked" color="primary" />
                }
                label="Keep me logged in"
              />
            </Grid>
            <Grid>
              <Typography
                variant="subtitle1"
                component={Link}
                to={
                  isLoggedIn // <-- Use the placeholder variable
                    ? '/pages/forgot-password/forgot-password3'
                    : authParam
                      ? `/forgot-password?auth=${authParam}`
                      : '/forgot-password'
                }
                sx={{ textDecoration: 'none', color: 'secondary.main' }}
              >
                Forgot Password?
              </Typography>
            </Grid>
          </Grid>

          {errors.submit && (
            <Box sx={{ mt: 3 }}>
              <FormHelperText error>{errors.submit}</FormHelperText>
            </Box>
          )}
          <Box sx={{ mt: 2 }}>
            <AnimateButton>
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
