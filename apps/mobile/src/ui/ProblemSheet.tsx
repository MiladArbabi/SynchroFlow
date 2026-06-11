// apps/mobile/src/ui/ProblemSheet.tsx
//
// PROBLEM SHEET — §10.7 shared component (MOB-UX-01)
// ------------------------------------------------
// Exception taxonomy UI + Problem Center POST + retry.
// Rendered as a modal bottom sheet from the persistent
// "Report problem" button in ScanDock (§10.5.3).
//
// RESPONSIBILITIES:
//   - Exception type grid (unified across Receive / Stow / Pick)
//   - Qty stepper (glove-sized ±, min 1)
//   - Calls onReport(type, qty) — screen does its workflow-specific POST
//   - Problem Center POST: POST /api/v1/wms/problem-center with retry
//   - Inline error banner on failure; auto-dismiss on success
//
// RESOLVES: MOB-AUD-10, MOB-STW-04, MOB-PCK-11/-12
//
// CONTRACT (§6, §10.7):
//   - ProblemSheet owns: taxonomy UI, qty, Problem Center POST.
//   - Screen owns: its workflow-specific exception endpoint (via onReport).
//   - onReport must throw or return an error string to show inline error.
//   - lasyncroVariantId is required for Problem Center POST; if absent,
//     the Problem Center POST is skipped with a console.warn (dev only).
//
// CHANGE CONTROL: consumed by every Work screen. Test all surfaces after changes.

import { useState, useCallback } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Vibration,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExceptionItem = {
  type: string;
  label: string;
  icon: string; // Ionicons name
};

export type ProblemSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Exception types to show in the grid */
  exceptions: readonly ExceptionItem[];
  /**
   * Screen's workflow-specific exception POST.
   * Return an error string or throw to show inline error.
   * ProblemSheet calls this first, then does the Problem Center POST.
   */
  onReport: (type: string, quantity: number) => Promise<string | void>;
  /** lasyncro_variant_id — required for Problem Center POST */
  lasyncroVariantId?: string;
  /** Problem Center source field (e.g. 'stow', 'pick', 'receive') */
  source: string;
  /** Source exception ID from the workflow endpoint response */
  sourceExceptionId?: string;
  /** Default qty shown in stepper (default: 1) */
  defaultQty?: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const VIBRATION_ERROR   = [0, 100, 80, 100];
const VIBRATION_SUCCESS = [0, 80];
const PROBLEM_CENTER_URL = '/api/v1/wms/problem-center';

// ─── ProblemSheet ─────────────────────────────────────────────────────────────

export function ProblemSheet({
  visible,
  onClose,
  exceptions,
  onReport,
  lasyncroVariantId,
  source,
  sourceExceptionId,
  defaultQty = 1,
}: ProblemSheetProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [qty, setQty] = useState(defaultQty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Reset local state whenever sheet opens
  const handleOpen = useCallback(() => {
    setSelectedType(null);
    setQty(defaultQty);
    setError(null);
    setSubmitted(false);
    setSubmitting(false);
  }, [defaultQty]);

  const handleClose = useCallback(() => {
    if (submitting) return; // Block dismiss during in-flight POST
    onClose();
  }, [submitting, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!selectedType || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      // 1 — Screen's workflow POST (stow / pick / receive endpoint)
      const workflowError = await onReport(selectedType, qty);
      if (workflowError) {
        Vibration.vibrate(VIBRATION_ERROR);
        setError(workflowError);
        setSubmitting(false);
        return;
      }

      // 2 — Problem Center POST (§3 contract — all exceptions go here)
      if (lasyncroVariantId) {
        await apiClient.post(PROBLEM_CENTER_URL, {
          lasyncro_variant_id: lasyncroVariantId,
          quantity: qty,
          exception_type: selectedType,
          source,
          source_exception_id: sourceExceptionId ?? null,
        });
      } else if (__DEV__) {
        console.warn(
          '[ProblemSheet] lasyncroVariantId missing — Problem Center POST skipped.',
        );
      }

      Vibration.vibrate(VIBRATION_SUCCESS);
      setSubmitted(true);
      // Auto-close after brief success flash
      setTimeout(() => onClose(), 900);
    } catch (err: unknown) {
      Vibration.vibrate(VIBRATION_ERROR);
      const msg =
        (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ?? 'Failed to report problem. Tap to retry.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedType, qty, submitting, onReport,
    lasyncroVariantId, source, sourceExceptionId, onClose,
  ]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onShow={handleOpen}
      onRequestClose={handleClose}
    >
      {/* Scrim */}
      <TouchableOpacity
        style={styles.scrim}
        activeOpacity={1}
        onPress={handleClose}
      />

      {/* Sheet */}
      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Report problem</Text>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={submitting}
          >
            <Ionicons name="close" size={22} color={colors.ink3} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={false}
        >
          {/* Exception type grid */}
          <Text style={styles.sectionLabel}>What's wrong?</Text>
          <View style={styles.grid}>
            {exceptions.map(({ type, label, icon }) => {
              const active = selectedType === type;
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.gridItem, active && styles.gridItemActive]}
                  onPress={() => setSelectedType(type)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={icon as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color={active ? colors.accent : colors.ink3}
                  />
                  <Text
                    style={[
                      styles.gridLabel,
                      active && styles.gridLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Qty stepper */}
          <Text style={styles.sectionLabel}>Quantity affected</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepBtn, qty <= 1 && styles.stepBtnDisabled]}
              onPress={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
            >
              <Ionicons name="remove" size={20} color={qty <= 1 ? colors.ink4 : colors.ink2} />
            </TouchableOpacity>
            <Text style={styles.stepValue}>{qty}</Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setQty((q) => q + 1)}
            >
              <Ionicons name="add" size={20} color={colors.ink2} />
            </TouchableOpacity>
          </View>

          {/* Inline error */}
          {error && (
            <TouchableOpacity
              style={styles.errorBanner}
              onPress={handleSubmit}
              activeOpacity={0.8}
            >
              <Ionicons name="alert-circle-outline" size={16} color={colors.bad} />
              <Text style={styles.errorText}>{error} Tap to retry.</Text>
            </TouchableOpacity>
          )}

          {/* Success flash */}
          {submitted && (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle-outline" size={16} color={colors.ok} />
              <Text style={styles.successText}>Reported — Problem Center notified.</Text>
            </View>
          )}

          {/* Submit CTA */}
          <TouchableOpacity
            style={[
              styles.cta,
              (!selectedType || submitting || submitted) && styles.ctaDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedType || submitting || submitted}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.ctaLabel}>Report problem</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.bg2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.rule2,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  title: {
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionLabel: {
    color: colors.ink3,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  gridItem: {
    width: '30%',
    flexGrow: 1,
    minHeight: 72,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.rule2,
    backgroundColor: colors.bg3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  gridItemActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGhost,
  },
  gridLabel: {
    color: colors.ink3,
    fontSize: font.size.xs,
    fontWeight: font.weight.medium,
    textAlign: 'center',
  },
  gridLabelActive: {
    color: colors.accent,
    fontWeight: font.weight.semibold,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.rule2,
    backgroundColor: colors.bg3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  stepValue: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.semibold,
    minWidth: 32,
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.badSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.bad,
  },
  errorText: {
    flex: 1,
    color: colors.bad,
    fontSize: font.size.sm,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.okSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  successText: {
    flex: 1,
    color: colors.ok,
    fontSize: font.size.sm,
  },
  cta: {
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  ctaDisabled: {
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  ctaLabel: {
    color: colors.bg,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
});
