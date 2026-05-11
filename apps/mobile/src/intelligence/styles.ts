// apps/mobile/src/intelligence/styles.ts
// Shared styles for all Intelligence segment views.
import { StyleSheet } from 'react-native';
import { colors, font, spacing, radius } from '../theme';

export const styles = StyleSheet.create({
  // Hero card
  heroCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  heroLabel: { color: colors.ink3, fontSize: font.size.sm },
  heroValue: { fontSize: 44, fontWeight: font.weight.bold, lineHeight: 52 },
  heroTarget: { color: colors.ink4, fontSize: font.size.xs },
  heroAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.xs },
  heroAlertText: { color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },

  // Section
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: 2 },
  sectionSubtitle: { color: colors.ink4, fontSize: font.size.xs, marginBottom: spacing.sm },

  // PO / supplier rows
  poRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  poLeft: { flex: 1, marginRight: spacing.sm },
  poSupplier: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  poDate: { color: colors.ink4, fontSize: font.size.xs },
  poCost: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },

  // Variant rows
  variantRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule, gap: spacing.xs },
  variantTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  variantTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, flex: 1, marginRight: spacing.sm },
  variantBottom: { flexDirection: 'row', gap: spacing.md },
  variantStat: { color: colors.ink4, fontSize: font.size.xs },

  // SKU margin rows
  skuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule, gap: spacing.sm },
  skuRank: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' },
  skuRankText: { color: colors.ink3, fontSize: 10, fontWeight: font.weight.bold },
  skuMeta: { flex: 1 },
  skuMarginBlock: { alignItems: 'flex-end' },
  skuMarginPct: { fontSize: font.size.md, fontWeight: font.weight.bold },

  // Status line
  statusLine: { paddingVertical: spacing.xs },
  statusText: { color: colors.ink3, fontSize: font.size.sm },

  // All clear / empty
  allClearCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  allClearText: { color: colors.ink3, fontSize: font.size.sm },
  emptyText: { color: colors.ink3, fontSize: font.size.md },

  // Computed at
  computedAt: { color: colors.ink4, fontSize: font.size.xs, textAlign: 'center' },
});
