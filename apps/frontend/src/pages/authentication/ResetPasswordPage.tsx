// apps/frontend/src/pages/authentication/ResetPasswordPage.tsx
//
// Password reset — user lands here from email link: /reset-password?token=<hex>
// Calls POST /api/v1/auth/reset-password, then redirects to /login on success.
//
import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import * as Yup from 'yup';
import { Formik } from 'formik';
import AuthWrapper1 from './AuthWrapper1';
import AnimateButton from 'ui-component/extended/AnimateButton';
import { SystemStatusPill, SocialProofTicker } from './AuthPageChrome';
import { AuthLogo } from './AuthLogo';

type SubmitState = 'idle' | 'success' | 'error';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  if (!token) {
    return (
      <AuthWrapper1>
        <Stack sx={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
          <Typography sx={{ color: 'var(--ink-3)' }}>Invalid reset link.</Typography>
          <Box component={Link} to="/forgot-password" sx={{ color: 'var(--accent)', mt: 1 }}>
            Request a new one
          </Box>
        </Stack>
      </AuthWrapper1>
    );
  }

  return (
    <AuthWrapper1>
      <Stack sx={{ justifyContent: 'center', minHeight: '100vh', overflowY: 'auto', pt: '80px', pb: '100px' }}>

        {/* Nav bar */}
        <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 }}>
          <Link to="/" aria-label="LaSyncro home">
            <AuthLogo />
          </Link>
          <SystemStatusPill />
        </Box>

        <Stack sx={{ justifyContent: 'center', alignItems: 'center' }}>
          <Box sx={{ width: '100%', maxWidth: 480, mx: 'auto', px: { xs: 2, sm: 3 } }}>
            <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: 3, p: { xs: 3, sm: 4 }, borderColor: 'var(--rule) !important' }}>

              <Typography sx={{ color: 'var(--accent)', fontWeight: 600, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1 }}>
                Reset password
              </Typography>

              <Typography variant="h2" sx={{ color: 'var(--ink)', fontWeight: 700, mb: 0.5 }}>
                Choose a new password.
              </Typography>
              <Typography variant="body2" sx={{ color: 'var(--ink-3)', mb: 3 }}>
                Must be less than 25 characters.
              </Typography>

              {submitState === 'success' ? (
                <Stack spacing={2}>
                  <Box sx={{ bgcolor: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 2, p: 2 }}>
                    <Typography variant="body2" sx={{ color: '#4ADE80', fontWeight: 600 }}>
                      ✓ Password reset successfully.
                    </Typography>
                  </Box>
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={() => navigate('/login')}
                    sx={{ bgcolor: 'var(--accent)', color: '#fff', fontWeight: 700, '&:hover': { bgcolor: 'var(--accent-hover)' } }}
                  >
                    Sign in →
                  </Button>
                </Stack>
              ) : (
                <Formik
                  initialValues={{ password: '', confirmPassword: '' }}
                  validationSchema={Yup.object().shape({
                    password: Yup.string()
                      .required('Password is required')
                      .max(25, 'Password must be less than 25 characters')
                      .test('no-spaces', 'Password cannot start or end with spaces', (v) => v === v?.trim()),
                    confirmPassword: Yup.string()
                      .required('Please confirm your password')
                      .oneOf([Yup.ref('password')], 'Passwords do not match'),
                  })}
                  onSubmit={async (values, { setSubmitting }) => {
                    setSubmitError(null);
                    try {
                      await axiosInstance.post('/api/v1/auth/reset-password', {
                        token,
                        password: values.password,
                      });
                      setSubmitState('success');
                      } catch (err) {
                      const error = err as { response?: { data?: { error?: string } } };
                      setSubmitError(error.response?.data?.error ?? 'Reset failed. Please try again.');
                      setSubmitState('error');
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  {({ errors, handleBlur, handleChange, handleSubmit, isSubmitting, touched, values }) => (
                    <form noValidate onSubmit={handleSubmit}>
                      <FormControl fullWidth error={Boolean(touched.password && errors.password)} sx={{ mb: 1.5 }}>
                        <OutlinedInput
                          type={showPassword ? 'text' : 'password'}
                          value={values.password}
                          name="password"
                          onBlur={handleBlur}
                          onChange={handleChange}
                          placeholder="New password"
                          startAdornment={
                            <InputAdornment position="start">
                              <LockOutlinedIcon sx={{ color: 'var(--ink-4)', fontSize: 18 }} />
                            </InputAdornment>
                          }
                          endAdornment={
                            <InputAdornment position="end">
                              <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="large">
                                {showPassword ? <Visibility /> : <VisibilityOff />}
                              </IconButton>
                            </InputAdornment>
                          }
                        />
                        {touched.password && errors.password && (
                          <FormHelperText error>{errors.password}</FormHelperText>
                        )}
                      </FormControl>

                      <FormControl fullWidth error={Boolean(touched.confirmPassword && errors.confirmPassword)} sx={{ mb: 2 }}>
                        <OutlinedInput
                          type={showPassword ? 'text' : 'password'}
                          value={values.confirmPassword}
                          name="confirmPassword"
                          onBlur={handleBlur}
                          onChange={handleChange}
                          placeholder="Confirm new password"
                          startAdornment={
                            <InputAdornment position="start">
                              <LockOutlinedIcon sx={{ color: 'var(--ink-4)', fontSize: 18 }} />
                            </InputAdornment>
                          }
                        />
                        {touched.confirmPassword && errors.confirmPassword && (
                          <FormHelperText error>{errors.confirmPassword}</FormHelperText>
                        )}
                      </FormControl>

                      {submitError && (
                        <Box sx={{ mb: 2 }}>
                          <FormHelperText error>{submitError}</FormHelperText>
                        </Box>
                      )}

                      <AnimateButton>
                        <Button
                          fullWidth size="large" type="submit" variant="contained"
                          disabled={isSubmitting}
                          sx={{ bgcolor: 'var(--accent)', color: '#fff', fontWeight: 700, '&:hover': { bgcolor: 'var(--accent-hover)' }, '&:disabled': { opacity: 0.6 } }}
                        >
                          Set new password →
                        </Button>
                      </AnimateButton>

                      <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                        <Typography component={Link} to="/login" variant="caption"
                          sx={{ color: 'var(--ink-3)', textDecoration: 'none', '&:hover': { color: 'var(--ink)' } }}>
                          ← Back to sign in
                        </Typography>
                        <Typography component={Link} to="/forgot-password" variant="caption"
                          sx={{ color: 'var(--ink-3)', textDecoration: 'none', '&:hover': { color: 'var(--ink)' } }}>
                          Request new link
                        </Typography>
                      </Stack>
                    </form>
                  )}
                </Formik>
              )}
            </Box>
          </Box>
        </Stack>

        <SocialProofTicker />
      </Stack>
    </AuthWrapper1>
  );
}