// apps/frontend/src/pages/authentication/ForgotPasswordPage.tsx
//
// AUTH-018: Forgot password screen (target design A4)
// Matches target: "Forgot it? It happens." + 30-min validity note + support escape hatch
//
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { axiosInstance } from 'api/axiosConfig';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import FormHelperText from '@mui/material/FormHelperText';
import Button from '@mui/material/Button';
import * as Yup from 'yup';
import { Formik } from 'formik';
import AuthWrapper1 from './AuthWrapper1';
import AuthCardWrapper from './AuthCardWrapper';
import AnimateButton from 'ui-component/extended/AnimateButton';
import CustomFormControl from 'ui-component/extended/Form/CustomFormControl';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import InputAdornment from '@mui/material/InputAdornment';
import { SocialProofTicker, SystemStatusPill } from './AuthPageChrome';

type SubmitState = 'idle' | 'success' | 'error';

export default function ForgotPasswordPage() {
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  return (
    <AuthWrapper1>
      <Stack sx={{ justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        {/* AUTH-012: top-left logo nav bar — matches target A4 */}
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            px: 3,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          <Link to="/" aria-label="LaSyncro home">
            <Box
              component="img"
              src="/logo-dark.png"
              alt="LaSyncro"
              sx={{ height: 28, width: 'auto' }}
            />
          </Link>
          {/* AUTH-014: system status pill — top-right */}
          <SystemStatusPill />
        </Box>
        <Box sx={{ m: { xs: 1, sm: 3 } }}>
          <AuthCardWrapper>
            <Stack spacing={2}>

              {/* Label */}
              <Typography
                variant="caption"
                sx={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.7rem' }}
              >
                Reset password
              </Typography>

              {/* Headline — matches A4: "Forgot it? It happens." */}
              <Typography variant="h2" sx={{ color: 'var(--ink)', fontWeight: 700, lineHeight: 1.2 }}>
                Forgot it?{' '}
                <Box component="span" sx={{ color: 'var(--accent)', fontStyle: 'italic', fontWeight: 400 }}>
                  It happens.
                </Box>
              </Typography>

              {/* Subtext — 30-min validity per target design */}
              <Typography variant="body2" sx={{ color: 'var(--ink-3)' }}>
                Enter your account email and we'll send a reset link.
                Valid for 30 minutes.
              </Typography>

              {submitState === 'success' ? (
                // ── Success state ──────────────────────────────
                <Box sx={{ py: 2 }}>
                  <Typography variant="body1" sx={{ color: 'var(--ink-2)' }}>
                    Check your inbox — a reset link is on its way.
                  </Typography>
                </Box>
              ) : (
                // ── Form ──────────────────────────────────────
                <Formik
                  initialValues={{ email: '' }}
                  validationSchema={Yup.object().shape({
                    email: Yup.string().email('Must be a valid email').max(255).required('Email is required'),
                  })}
                  onSubmit={async (values, { setSubmitting }) => {
                    setSubmitError(null);
                    try {
                      await axiosInstance.post('/api/v1/auth/forgot-password', {
                        email: values.email.trim(),
                      });
                      setSubmitState('success');
                    } catch {
                      // Always show success to prevent email enumeration
                      setSubmitState('success');
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  {({ errors, handleBlur, handleChange, handleSubmit, isSubmitting, touched, values }) => (
                    <form noValidate onSubmit={handleSubmit}>
                      <CustomFormControl fullWidth error={Boolean(touched.email && errors.email)}>
                        <InputLabel htmlFor="forgot-password-email">Email address</InputLabel>
                        <OutlinedInput
                          id="forgot-password-email"
                          type="email"
                          value={values.email}
                          name="email"
                          onBlur={handleBlur}
                          onChange={handleChange}
                          startAdornment={
                            <InputAdornment position="start">
                              <MailOutlineIcon sx={{ color: 'var(--ink-4)', fontSize: 18 }} />
                            </InputAdornment>
                          }
                        />
                        {touched.email && errors.email && (
                          <FormHelperText error>{errors.email}</FormHelperText>
                        )}
                      </CustomFormControl>

                      {submitError && (
                        <Box sx={{ mt: 1 }}>
                          <FormHelperText error>{submitError}</FormHelperText>
                        </Box>
                      )}

                      <Box sx={{ mt: 2 }}>
                        <AnimateButton>
                          <Button
                            fullWidth
                            size="large"
                            type="submit"
                            variant="contained"
                            disabled={isSubmitting}
                            sx={{
                              // AUTH: use LaSyncro accent — NOT color="secondary" (MUI amber)
                              bgcolor: 'var(--accent)',
                              color: '#fff',
                              fontWeight: 700,
                              '&:hover': { bgcolor: 'var(--accent-hover)' },
                              '&:disabled': { opacity: 0.6 },
                            }}
                          >
                            Send reset link →
                          </Button>
                        </AnimateButton>
                      </Box>
                    </form>
                  )}
                </Formik>
              )}

              {/* Footer nav — matches A4: "← Back to sign in" + "Contact support" */}
              <Stack direction="row" sx={{ justifyContent: 'space-between', pt: 1 }}>
                <Typography
                  component={Link}
                  to="/login"
                  variant="subtitle2"
                  sx={{ color: 'var(--ink-3)', textDecoration: 'none', '&:hover': { color: 'var(--ink)' } }}
                >
                  ← Back to sign in
                </Typography>
                <Typography
                  component="a"
                  href="mailto:support@lasyncro.com"
                  variant="subtitle2"
                  sx={{ color: 'var(--ink-3)', textDecoration: 'none', '&:hover': { color: 'var(--ink)' } }}
                >
                  Contact support
                </Typography>
              </Stack>
            </Stack>
          </AuthCardWrapper>
        </Box>
      </Stack>
      <SocialProofTicker />
    </AuthWrapper1>
  );
}