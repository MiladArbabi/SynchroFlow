// apps/frontend/src/pages/orders/ShippingAddressResolver.tsx
//
// REUSABLE ADDRESS CORRECTION TREATMENT (OPS-RESOLVE-01, Slice B)
// ---------------------------------------------------------------
// Extracted verbatim from the private ShippingAddressDialog that used to live
// inside OrderDetailModalBody.tsx. This is the ONE implementation of the
// customer/incomplete_address treatment: field seeding, required-field
// validation, address-assist prefill, correctionSource provenance and the
// useUpdateShippingAddress write path all live here and nowhere else.
//
// Two consumers, one body:
//   ShippingAddressDialog          -> Order Detail (unchanged UX)
//   AddressResolutionSessionModal  -> renders this inline, in the session
//                                     workspace, with no nested dialog
//
// It stays in apps/frontend on purpose: it depends on useUpdateShippingAddress
// (react-query + axiosInstance), and modules/shared/src/ui is deliberately free
// of app hooks. Moving it there would drag app infrastructure into the shared
// module.
//
// PATCH success is NOT resolution. onSaved fires on a successful write only;
// every consumer must still wait for canonical constraint truth before claiming
// the blocker cleared. See useShippingAddress.ts and BL-16-UX-02.

import { useEffect, useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';

import { useUpdateShippingAddress } from './useShippingAddress';
import type { OrderAddressAssist, OrderShipping } from './useOrderDetail';

export interface ShippingAddressResolverProps {
  orderId: string;
  currentShipping: OrderShipping | undefined;
  addressAssist: OrderAddressAssist | null | undefined;
  /** Fired after a successful PATCH. Never implies the constraint cleared. */
  onSaved: () => void;
  /** Dismiss without saving — closes the dialog, or collapses the session row. */
  onCancel: () => void;
  /**
   * Lifecycle flag. Provenance must never leak across openings, so `false`
   * clears assistApplied — the same reset the dialog previously keyed off its
   * own `open` prop.
   */
  active?: boolean;
}

export function ShippingAddressResolver({
  orderId,
  currentShipping,
  addressAssist,
  onSaved,
  onCancel,
  active = true,
}: ShippingAddressResolverProps) {
  const [name, setName] = useState(currentShipping?.name ?? '');
  const [address1, setAddress1] = useState(currentShipping?.address1 ?? '');
  const [address2, setAddress2] = useState(currentShipping?.address2 ?? '');
  const [city, setCity] = useState(currentShipping?.city ?? '');
  const [zip, setZip] = useState(currentShipping?.zip ?? '');
  const [province, setProvince] = useState(currentShipping?.province ?? '');
  const [countryCode, setCountryCode] = useState(currentShipping?.countryCode ?? '');
  const [phone, setPhone] = useState(currentShipping?.phone ?? '');

  /**
   * CORRECTION PROVENANCE (OUTCOME-ATTR-01)
   * ---------------------------------------
   * EXPLICIT state: true only after the operator actually clicked "Use this
   * address". Provenance is never inferred by comparing typed values against
   * the candidate — an operator who happens to type the same address did not
   * use the assist, and recording that they did would be a fabricated fact.
   *
   * Any subsequent edit to a field the candidate filled drops back to manual:
   * what gets saved is no longer the historical address, so it must not be
   * attributed to the assist.
   *
   * Applying a candidate still writes NOTHING. Save remains the sole write.
   */
  const [assistApplied, setAssistApplied] = useState(false);

  // Lifecycle reset — provenance must never leak across openings.
  useEffect(() => {
    if (!active) setAssistApplied(false);
  }, [active]);

  const updateAddress = useUpdateShippingAddress();

  const canSave = Boolean(
    address1.trim() &&
    city.trim() &&
    zip.trim() &&
    countryCode.trim()
  );

  const handleCancel = () => {
    if (!updateAddress.isPending) {
      onCancel();
    }
  };

  const handleSave = () => {
    updateAddress.mutate(
      {
        orderId,
        name: name.trim() || undefined,
        address1: address1.trim(),
        address2: address2.trim() || undefined,
        city: city.trim(),
        zip: zip.trim(),
        province: province.trim() || undefined,
        countryCode: countryCode.trim(),
        phone: phone.trim() || undefined,
        correctionSource: assistApplied ? 'historical_address_assist' : 'manual',
      },
      {
        // BL-16-UX-02: PATCH success confirms the address write, not constraint
        // resolution.
        onSuccess: onSaved,
      }
    );
  };

  const fieldSx = { mb: 1.25 };

  return (
    <>
      <Box sx={{ p: '24px', bgcolor: 'var(--surface)' }}>
        <Typography
          sx={{
            fontSize: 12.5,
            fontWeight: 300,
            color: 'var(--ink-3)',
            mb: 2,
          }}
        >
          Complete the required shipping fields so this order can be re-checked automatically.
        </Typography>

        {addressAssist && (
          <Box sx={{ mb: 2, p: 2, bgcolor: 'var(--bg-3)', border: '1px solid var(--rule)', borderRadius: '6px' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', mb: 0.75 }}>
              Previously used address
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'pre-line' }}>
              {[
                addressAssist.candidate.address1,
                addressAssist.candidate.address2,
                `${addressAssist.candidate.city} ${addressAssist.candidate.zip}`,
                addressAssist.candidate.province,
                addressAssist.candidate.countryCode,
              ].filter(Boolean).join('\n')}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: 1 }}>
              Used on {addressAssist.usageCount} fulfilled {addressAssist.usageCount === 1 ? 'order' : 'orders'} · Last used{' '}
              {new Date(addressAssist.lastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              disabled={updateAddress.isPending}
              sx={{
                mt: 1,
                px: 1.25,
                py: 0.5,
                minWidth: 0,
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'none',
                color: 'var(--accent-text)',
                bgcolor: 'transparent',
                border: '0.5px solid var(--accent)',
                borderRadius: '6px',
                '&:hover': {
                  bgcolor: 'transparent',
                  border: '0.5px solid var(--accent)',
                  opacity: 0.75,
                },
              }}
              onClick={() => {
                const { candidate } = addressAssist;
                setAssistApplied(true);
                setAddress1(candidate.address1);
                setAddress2(candidate.address2 ?? '');
                setCity(candidate.city);
                setZip(candidate.zip);
                setProvince(candidate.province ?? '');
                setCountryCode(candidate.countryCode);
              }}
            >
              Use this address
            </Button>
          </Box>
        )}

        {updateAddress.isError && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {updateAddress.error?.message ?? 'Could not save the address. Please try again.'}
          </Alert>
        )}

        <TextField
          size="small"
          fullWidth
          label="Recipient name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={fieldSx}
        />

        <TextField
          size="small"
          fullWidth
          required
          label="Address line 1"
          value={address1}
          onChange={(e) => { setAssistApplied(false); setAddress1(e.target.value); }}
          sx={fieldSx}
        />

        <TextField
          size="small"
          fullWidth
          label="Address line 2 (optional)"
          value={address2}
          onChange={(e) => { setAssistApplied(false); setAddress2(e.target.value); }}
          sx={fieldSx}
        />

        <Box sx={{ display: 'flex', gap: 1.25, mb: 1.25 }}>
          <TextField
            size="small"
            fullWidth
            required
            label="City"
            value={city}
            onChange={(e) => { setAssistApplied(false); setCity(e.target.value); }}
          />
          <TextField
            size="small"
            fullWidth
            label="State / Province"
            value={province}
            onChange={(e) => { setAssistApplied(false); setProvince(e.target.value); }}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 1.25, mb: 1.25 }}>
          <TextField
            size="small"
            fullWidth
            required
            label="ZIP / Postal code"
            value={zip}
            onChange={(e) => { setAssistApplied(false); setZip(e.target.value); }}
          />
          <TextField
            size="small"
            fullWidth
            required
            label="Country code"
            placeholder="US"
            value={countryCode}
            onChange={(e) => { setAssistApplied(false); setCountryCode(e.target.value.toUpperCase()); }}
          />
        </Box>

        <TextField
          size="small"
          fullWidth
          label="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Box>

      {/* Same chrome the dialog footer used, so Order Detail looks unchanged. */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          px: 3,
          py: 2,
          gap: 1,
          bgcolor: 'var(--bg-3)',
          borderTop: '1px solid var(--rule)',
        }}
      >
        <Button
          onClick={handleCancel}
          disabled={updateAddress.isPending}
          sx={{
            color: 'var(--ink-3)',
            textTransform: 'none',
            borderRadius: '6px',
          }}
        >
          Cancel
        </Button>

        <Button
          variant="contained"
          disabled={!canSave || updateAddress.isPending}
          onClick={handleSave}
          sx={{
            bgcolor: 'var(--accent)',
            color: 'var(--accent-ink)',
            borderRadius: '6px',
            fontWeight: 600,
            textTransform: 'none',
            '&:hover': {
              bgcolor: 'var(--accent)',
              opacity: 0.88,
            },
          }}
        >
          {updateAddress.isPending ? 'Saving…' : 'Save address'}
        </Button>
      </Box>
    </>
  );
}

export default ShippingAddressResolver;
