// apps/mobile/src/screens/ScannerScreen.tsx
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Badge, Row, Divider, AppHeader, BarcodeScannerView, BarcodeScanEvent } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

type ScanResult = {
  type: 'product' | 'location' | 'order';
  // product
  lasyncro_variant_id?: string;
  variant_title?: string;
  sku?: string;
  stage?: string;
  inventory?: Array<{ location_code: string; on_hand_quantity: number; reserved_quantity: number; available_quantity: number }>;
  total_on_hand?: number;
  total_reserved?: number;
  total_available?: number;
  active_receive?: any;
  active_stow?: any;
  active_batch?: any;
  open_exceptions?: number;
  // location
  location_code?: string;
  total_variants?: number;
  total_units?: number;
  pending_stow_tasks?: number;
  // order
  external_order_id?: string;
  fulfillment_status?: string;
  total_price?: number;
  currency?: string;
  line_items?: Array<{ title: string; quantity: number; sku: string | null }>;
};

const STAGE_LABELS: Record<string, { label: string; variant: 'info' | 'warning' | 'success' }> = {
  receiving:     { label: 'RECEIVING',     variant: 'info' },
  received:      { label: 'RECEIVED',      variant: 'success' },
  stow_pending:  { label: 'STOW PENDING',  variant: 'warning' },
  stowing:       { label: 'STOWING',       variant: 'warning' },
  stowed:        { label: 'STOWED',        variant: 'success' },
  picking:       { label: 'PICKING',       variant: 'info' },
  pick_complete: { label: 'PICK COMPLETE', variant: 'success' },
  packing:       { label: 'PACKING',       variant: 'warning' },
  unknown:       { label: 'UNKNOWN',       variant: 'info' },
};

export default function ScannerScreen() {
  const [result, setResult] = useState<ScanResult | null>(null);

  /**
   * UNIVERSAL SCAN HANDLER
   * ----------------------
   * BarcodeScannerView owns: cooldown, vibration, error display,
   * bounds overlay, manual entry, permission.
   * This handler owns: /wms/scan/resolve API call + result display.
   *
   * Returns error string for inline display, or void on success.
   */
  const handleScan = useCallback(async (event: BarcodeScanEvent): Promise<string | void> => {
    try {
      const { data } = await apiClient.post('/api/v1/wms/scan/resolve', {
        scanned_value: event.data,
      });
      setResult(data);
    } catch (err: unknown) {
      const status = (err as any)?.response?.status;
      return status === 404
        ? `Not recognised: ${event.data}`
        : 'Scan failed. Check connection.';
    }
  }, []);

  const handleReset = useCallback(() => {
    setResult(null);
  }, []);

  // ── RESULT VIEW ───────────────────────────────────────────────────────────
  if (result) {
    return (
      <Screen>
        <AppHeader showLogo  />
        <ScrollView contentContainerStyle={styles.resultContent}>

          {/* Type badge */}
          <Row style={styles.typeRow}>
            <Badge
              label={result.type.toUpperCase()}
              variant="info"
            />
            {result.type === 'product' && result.stage && (
              <Badge
                label={STAGE_LABELS[result.stage]?.label ?? result.stage.toUpperCase()}
                variant={STAGE_LABELS[result.stage]?.variant ?? 'info'}
              />
            )}
            {result.open_exceptions !== undefined && result.open_exceptions > 0 && (
              <Badge label={`${result.open_exceptions} EXCEPTION${result.open_exceptions > 1 ? 'S' : ''}`} variant="error" />
            )}
          </Row>

          {/* ── PRODUCT RESULT ── */}
          {result.type === 'product' && (
            <>
              <Text style={styles.resultTitle}>{result.variant_title ?? '—'}</Text>
              {result.sku && <Text style={styles.resultSub}>{result.sku}</Text>}

              <Divider />

              {/* Inventory summary */}
              <Text style={styles.sectionLabel}>Inventory</Text>
              <Row style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{result.total_on_hand ?? 0}</Text>
                  <Text style={styles.statLabel}>On hand</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.warning }]}>{result.total_reserved ?? 0}</Text>
                  <Text style={styles.statLabel}>Reserved</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.success }]}>{result.total_available ?? 0}</Text>
                  <Text style={styles.statLabel}>Available</Text>
                </View>
              </Row>

              {/* Locations */}
              {(result.inventory ?? []).length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Locations</Text>
                  {result.inventory!.map((inv) => (
                    <Card key={inv.location_code} style={styles.invCard}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={styles.locationCode}>{inv.location_code}</Text>
                        <Text style={styles.invQty}>{inv.on_hand_quantity} units</Text>
                      </Row>
                      <Text style={styles.invDetail}>
                        Reserved: {inv.reserved_quantity} · Available: {inv.available_quantity}
                      </Text>
                    </Card>
                  ))}
                </>
              )}

              {/* Active operations */}
              {result.active_receive && (
                <>
                  <Text style={styles.sectionLabel}>Active receive</Text>
                  <Card style={styles.opCard}>
                    <Text style={styles.opText}>
                      Expected: {result.active_receive.quantity_expected} · Accepted: {result.active_receive.quantity_accepted}
                    </Text>
                    <Text style={styles.opSub}>{result.active_receive.inspection_complete ? 'Inspected ✓' : 'Pending inspection'}</Text>
                  </Card>
                </>
              )}
              {result.active_stow && (
                <>
                  <Text style={styles.sectionLabel}>Active stow</Text>
                  <Card style={styles.opCard}>
                    <Text style={styles.opText}>
                      {result.active_stow.quantity} units → {result.active_stow.location_code ?? 'No location'}
                    </Text>
                    <Text style={styles.opSub}>{result.active_stow.status}</Text>
                  </Card>
                </>
              )}
              {result.active_batch && (
                <>
                  <Text style={styles.sectionLabel}>Active batch</Text>
                  <Card style={styles.opCard}>
                    <Text style={styles.opText}>{result.active_batch.pick_batch_id.slice(0, 8).toUpperCase()}</Text>
                    <Text style={styles.opSub}>{result.active_batch.status.replace('_', ' ')}</Text>
                  </Card>
                </>
              )}
            </>
          )}

          {/* ── LOCATION RESULT ── */}
          {result.type === 'location' && (
            <>
              <Text style={styles.resultTitle}>{result.location_code}</Text>

              <Divider />

              <Row style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{result.total_variants ?? 0}</Text>
                  <Text style={styles.statLabel}>Variants</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{result.total_units ?? 0}</Text>
                  <Text style={styles.statLabel}>Units</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.warning }]}>{result.pending_stow_tasks ?? 0}</Text>
                  <Text style={styles.statLabel}>Incoming</Text>
                </View>
              </Row>

              {(result.inventory ?? []).length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Contents</Text>
                  {result.inventory!.map((inv: any) => (
                    <Card key={inv.lasyncro_variant_id} style={styles.invCard}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={styles.locationCode} numberOfLines={1}>
                          {inv.variant_title ?? inv.sku ?? inv.lasyncro_variant_id.slice(0, 8)}
                        </Text>
                        <Text style={styles.invQty}>{inv.on_hand_quantity} units</Text>
                      </Row>
                      {inv.sku && <Text style={styles.invDetail}>{inv.sku}</Text>}
                    </Card>
                  ))}
                </>
              )}
            </>
          )}

          {/* ── ORDER RESULT ── */}
          {result.type === 'order' && (
            <>
              <Text style={styles.resultTitle}>Order #{result.external_order_id}</Text>
              <Text style={styles.resultSub}>
                {result.currency} {Number(result.total_price ?? 0).toFixed(2)}
              </Text>

              <Divider />

              <Row style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Badge
                    label={(result.fulfillment_status ?? 'unknown').toUpperCase()}
                    variant={result.fulfillment_status === 'fulfilled' ? 'success' : 'warning'}
                  />
                  <Text style={styles.statLabel}>Status</Text>
                </View>
                {result.active_batch && (
                  <View style={styles.statItem}>
                    <Badge label={result.active_batch.status.replace('_', ' ').toUpperCase()} variant="info" />
                    <Text style={styles.statLabel}>Batch</Text>
                  </View>
                )}
              </Row>

              {(result.line_items ?? []).length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Line items</Text>
                  {result.line_items!.map((li, i) => (
                    <Card key={i} style={styles.invCard}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={styles.locationCode} numberOfLines={1}>{li.title}</Text>
                        <Text style={styles.invQty}>× {li.quantity}</Text>
                      </Row>
                      {li.sku && <Text style={styles.invDetail}>{li.sku}</Text>}
                    </Card>
                  ))}
                </>
              )}
            </>
          )}

        </ScrollView>

        {/* Scan again */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.scanAgainBtn} onPress={handleReset}>
            <Ionicons name="scan-outline" size={20} color={colors.bg} />
            <Text style={styles.scanAgainText}>Scan another</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  // ── CAMERA VIEW ───────────────────────────────────────────────────────────
  return (
    <BarcodeScannerView
      hint="Scan product, location, or order barcode"
      onScan={handleScan}
    />
  );
}

const styles = StyleSheet.create({
  // Result view
  resultContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: 100 },
  typeRow: { gap: spacing.sm, flexWrap: 'wrap' },
  resultTitle: {
    color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold,
  },
  resultSub: { color: colors.ink3, fontSize: font.size.md },
  sectionLabel: {
    color: colors.ink3, fontSize: font.size.xs, fontWeight: font.weight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.xs,
  },
  statsRow: { gap: spacing.lg, marginVertical: spacing.sm },
  statItem: { alignItems: 'center', gap: spacing.xs },
  statValue: { color: colors.accent, fontSize: font.size.xl, fontWeight: font.weight.bold },
  statLabel: { color: colors.ink3, fontSize: font.size.xs },
  invCard: { gap: spacing.xs },
  locationCode: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold, flex: 1 },
  invQty: { color: colors.ink2, fontSize: font.size.sm },
  invDetail: { color: colors.ink3, fontSize: font.size.sm },
  opCard: { gap: spacing.xs },
  opText: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.medium },
  opSub: { color: colors.ink3, fontSize: font.size.sm },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: spacing.lg, paddingBottom: spacing.xl,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.rule,
  },
  scanAgainBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    padding: spacing.md, flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center', gap: spacing.sm,
  },
  scanAgainText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
});