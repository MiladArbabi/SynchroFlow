// apps/frontend/src/activation/configs/products.tsx
// STATUS: LOCKED — Doctrine-aligned ActivationSurface
// Module: Products (SKU-OS)

import { ActivationSurfaceProps } from '@lasyncro/shared/ui';

export const productsActivationConfig: ActivationSurfaceProps = {
  moduleId: 'products',

  identity: {
    title: 'Products',
    subtitle: 'Replenishment decisions are being made blind.',
  },

  blindness: {
    content: (
      <div style={{ opacity: 0.75 }}>
        <div>
          <strong>P-101 / A-123</strong> — Stockout risk: ⚫ Unknown
        </div>
        <div>
          <strong>Restock first:</strong> ⚫ Unknown
        </div>
      </div>
    ),
  },

  absenceProof: {
    content: (
      <>
        You could be prioritizing the wrong product today — and you wouldn’t know.
      </>
    ),
  },

  valueAfterActivation: {
    content: (
      <>
        Activation determines whether these decisions are informed or blind.
      </>
    ),
  },

  primaryCTA: {
    label: 'Connect Store to Identify Stockout Risk',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'No store changes',
      'Disconnect anytime',
      'No customer PII stored',
      'Encrypted end-to-end',
    ],
  },

    postActivation: {
    content: (
      <>
        Products sync → sales velocity computed → stockout risk appears.
      </>
    ),
  },
};