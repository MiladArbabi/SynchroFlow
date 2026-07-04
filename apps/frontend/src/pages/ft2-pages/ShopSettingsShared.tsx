// apps/frontend/src/pages/ft2-pages/ShopSettingsShared.tsx
//
// Shared primitives for all ShopSettings sub-pages.
// SettingsCard · SectionLabel · SaveButton

import { Box, Typography, Button } from '@mui/material';
import { useAppTheme } from '../../hooks/useAppTheme';

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{
      fontSize: 11, fontWeight: 600, color: 'var(--ink-3)',
      textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.75,
    }}>
      {children}
    </Typography>
  );
}

export function SettingsCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const pal = useAppTheme();
  return (
    <Box sx={{
      background: pal.surface,
      border: `0.5px solid ${pal.rule}`,
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <Box sx={{
        px: 2.5, py: 1.75,
        borderBottom: `0.5px solid ${pal.rule}`,
        display: 'flex', alignItems: 'center', gap: 1.25,
      }}>
        <Box sx={{ color: 'var(--ink-3)', flexShrink: 0 }}>{icon}</Box>
        <Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>
            {title}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)', mt: '1px' }}>
            {description}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ px: 2.5, py: 2 }}>
        {children}
      </Box>
    </Box>
  );
}

export function SaveButton({
  dirty,
  saving,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  if (!dirty) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
      <Button
        size="small" variant="contained" onClick={onSave} disabled={saving}
        sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 }, fontSize: 12 }}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Box>
  );
}

export function SettingsPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: 2.5 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 640 }}>
        {children}
      </Box>
    </Box>
  );
}

export function PlaceholderTab({ title, description }: { title: string; description: string }) {
  return (
    <Box sx={{ bgcolor: 'var(--bg)', minHeight: '100%', p: 2.5 }}>
      <Box sx={{ maxWidth: 640 }}>
        <Box sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', py: 8, gap: 1,
          border: '0.5px dashed var(--rule)', borderRadius: '8px',
        }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
            {title}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {description}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

// Inline confirm — replaces window.confirm() across Settings pages.
// Renders inline below the trigger, not a modal — matches the
// Collapse-based confirm pattern used for bulk backfill (Outbound).
function InlineConfirm({
  open,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  destructive = false,
}: {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  if (!open) return null;
  return (
    <Box sx={{ p: 1.25, bgcolor: 'var(--bg-2)', border: '0.5px solid var(--rule)', borderRadius: '6px', mt: 1 }}>
      <Typography sx={{ fontSize: 12, color: 'var(--ink)', mb: 1 }}>{message}</Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Box
          onClick={onConfirm}
          sx={{
            px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, border: 'none', borderRadius: '6px', cursor: 'pointer',
            bgcolor: destructive ? 'error.main' : 'var(--accent)',
            color: destructive ? 'white' : 'var(--accent-ink)',
          }}
        >
          {confirmLabel}
        </Box>
        <Box onClick={onCancel} sx={{ px: 1.25, py: 0.5, fontSize: 11, color: 'var(--ink-3)', border: '0.5px solid var(--rule)', borderRadius: '6px', cursor: 'pointer' }}>
          Cancel
        </Box>
      </Box>
    </Box>
  );
}

export { InlineConfirm };
