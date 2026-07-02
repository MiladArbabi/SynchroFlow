// modules/shared/src/ui/EntityDetailModal.tsx
//
// ENTITY DETAIL MODAL (shared shell)
// -----------------------------------
// Centered, large overlay for viewing/acting on a single entity (order,
// member, product) without navigating away from the current module.
//
// This is intentionally a SHELL ONLY — header chrome, sizing, loading/error
// states. Each consumer (Orders, Members, Products) supplies its own body
// content as children. No entity-specific logic belongs here.
//
// Precedent check (2026-06-28): no existing large centered-dialog pattern
// exists in this codebase — every prior <Dialog> usage found (ProblemCenter,
// MembersPage) was a small action-form dialog (maxWidth sm/xs). This is the
// first content-rich detail surface. Uses app surface/rule tokens rather
// than MUI's default Paper styling, to match the FT2 card shell convention
// (modules-ux-playbook.md) rather than inventing a second visual language.
//
// RULES (per modules-ux-playbook.md):
// - CSS variable tokens only, never hardcoded hex
// - borderRadius '14px' (FT2 card shell standard), not Dialog's MUI default
// - fontWeight max 500 for body/title text per playbook convention

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  Box,
  Typography,
  CircularProgress,
  IconButton,
} from '@mui/material';
import { X } from 'lucide-react';

export interface EntityDetailModalProps {
  /** Drives both open state and remount-on-change — pass the entity id. */
  entityId: string | number | null;
  onClose: () => void;
  /** Primary header text, e.g. "Order #1048" */
  title: ReactNode;
  /** Optional header sub-line, e.g. status phrase or member role */
  subtitle?: ReactNode;
  /** Optional header-right content (status badges, etc.) — renders before the close button */
  headerActions?: ReactNode;
  /** True while any underlying query is loading */
  isLoading?: boolean;
  /** Non-null renders an error state instead of children */
  errorMessage?: string | null;
  /** Body content — each module supplies its own */
  children?: ReactNode;
  /**
   * FOOTER ACTIONS (2026-07-02)
   * ---------------------------
   * Optional fixed footer region, visually --bg-2 (matches header) to
   * frame the --surface-toned body per target design. Consumer supplies
   * its own CTA row — shell has zero entity-specific button logic, same
   * separation as the rest of this file. Omit for entities with no
   * footer actions; the region simply doesn't render.
   */
  footerActions?: ReactNode;
  /** Default 'lg' — override only with a specific reason */
  maxWidth?: 'md' | 'lg' | 'xl';
}

export function EntityDetailModal({
  entityId,
  onClose,
  title,
  subtitle,
  headerActions,
  isLoading,
  errorMessage,
  children,
  footerActions,
  maxWidth = 'lg',
}: EntityDetailModalProps) {
  const open = entityId !== null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={maxWidth}
      PaperProps={{
        sx: {
          bgcolor: 'var(--surface)',
          border: '1px solid var(--rule)',
          borderRadius: '14px',
          backgroundImage: 'none',
        },
      }}
    >
      {/*
        HEADER — bg-2 per target design (2026-07-02): header/footer read
        as a slightly different tone framing the surface-toned body,
        matching the target mockup. Was uniformly --surface throughout.
      */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          px: 3,
          pt: 2.5,
          pb: 2,
          bgcolor: 'var(--bg-2)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)', mt: 0.375 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, ml: 2 }}>
          {headerActions}
          <IconButton onClick={onClose} size="small" sx={{ color: 'var(--ink-4)' }}>
            <X size={18} />
          </IconButton>
        </Box>
      </Box>

      {/* BODY */}
      <DialogContent sx={{ p: 3 }}>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} sx={{ color: 'var(--accent)' }} />
          </Box>
        )}

        {!isLoading && errorMessage && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1.25,
              bgcolor: 'var(--accent-ghost)',
              border: '1px solid var(--accent-border)',
              borderRadius: '10px',
            }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 300, color: 'var(--ink-2)' }}>
              {errorMessage}
            </Typography>
          </Box>
        )}

        {!isLoading && !errorMessage && children}
      </DialogContent>
      {/*
        FOOTER — bg-2, matching header, per target design (2026-07-02).
        Only renders when a consumer supplies footerActions — entities
        with no footer CTA (e.g. Members, if it never needs one) simply
        omit the prop and get no empty bar.
      */}
      {footerActions && (
        <Box
          sx={{
            px: 3,
            py: 2,
            bgcolor: 'var(--bg-2)',
            borderTop: '1px solid var(--rule)',
          }}
        >
          {footerActions}
        </Box>
      )}
    </Dialog>
  );
}