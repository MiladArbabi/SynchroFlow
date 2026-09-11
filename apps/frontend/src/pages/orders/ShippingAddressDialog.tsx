// apps/frontend/src/pages/orders/ShippingAddressDialog.tsx
//
// Thin Dialog wrapper around ShippingAddressResolver (OPS-RESOLVE-01, Slice B).
//
// BL-16-UX-01: customer/incomplete_address resolution stays on the existing
// shipping-address mutation, in a focused child dialog so the Order Detail
// surface stays concise and the parent modal stays open.
//
// This file owns NO business logic. Field seeding, validation, address-assist
// prefill, correctionSource provenance and the write path all live in
// ShippingAddressResolver, which the Address Resolution Session renders inline
// instead of nesting a second dialog.

import { Dialog, DialogContent, DialogTitle } from '@mui/material';

import { ShippingAddressResolver } from './ShippingAddressResolver';
import type { OrderAddressAssist, OrderShipping } from './useOrderDetail';

export function ShippingAddressDialog({
  open,
  onClose,
  onSaved,
  orderId,
  currentShipping,
  addressAssist,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  orderId: string;
  currentShipping: OrderShipping | undefined;
  addressAssist: OrderAddressAssist | null | undefined;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="shipping-address-dialog-title"
      PaperProps={{
        sx: {
          bgcolor: 'var(--surface)',
          border: '1px solid var(--rule)',
          borderRadius: '14px',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle
        id="shipping-address-dialog-title"
        sx={{
          px: 3,
          py: 2,
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--ink)',
          bgcolor: 'var(--bg-3)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        Correct shipping address
      </DialogTitle>

      {/* p:0 — the resolver supplies its own body padding and footer chrome. */}
      <DialogContent sx={{ p: '0 !important', bgcolor: 'var(--surface)' }}>
        <ShippingAddressResolver
          orderId={orderId}
          currentShipping={currentShipping}
          addressAssist={addressAssist}
          onSaved={onSaved}
          onCancel={onClose}
          active={open}
        />
      </DialogContent>
    </Dialog>
  );
}

export default ShippingAddressDialog;
