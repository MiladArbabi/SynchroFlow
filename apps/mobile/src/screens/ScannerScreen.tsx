// apps/mobile/src/screens/ScannerScreen.tsx
import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Vibration, ActivityIndicator, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Badge, Row, Divider, AppHeader } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';
import { useAuth } from '../hooks/useAuth';

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

const VIBRATION_SUCCESS = [0, 80];
const VIBRATION_ERROR = [0, 100, 80, 100];

export default function ScannerScreen() {
  const { logout } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');

  useEffect(() => {
    if (!permission?.granted) void requestPermission();
  }, [permission, requestPermission]);

  const handleScan = useCallback(async ({ data: scannedValue }: { data: string }) => {
    if (cooldown || resolving) return;
    setCooldown(true);
    setTimeout(() => setCooldown(false), 2000);

    setResolving(true);
    setError(null);
    setScanning(false);

    try {
      const { data } = await apiClient.post('/api/v1/wms/scan/resolve', {
        scanned_value: scannedValue,
      });
      Vibration.vibrate(VIBRATION_SUCCESS);
      setResult(data);
    } catch (err: unknown) {
      Vibration.vibrate(VIBRATION_ERROR);
      const status = (err as any)?.response?.status;
      if (status === 404) {
        setError(`Not recognised: ${scannedValue}`);
      } else {
        setError('Scan failed. Check connection.');
      }
      setScanning(true);
    } finally {
      setResolving(false);
    }
  }, [cooldown, resolving]);

  const handleReset = useCallback(() => {
    setResult(null);
    setError(null);
    setScanning(true);
  }, []);

  if (!permission?.granted) {
    return (
      <Screen>
        <AppHeader showLogo  />
        <View style={styles.center}>
          <Text style={styles.permText}>Camera access required for scanning.</Text>
          <TouchableOpacity style={styles.permBtn} onPress={() => void requestPermission()}>
            <Text style={styles.permBtnText}>Grant permission</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

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
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={scanning && !resolving ? handleScan : undefined}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
        }}
      />

      {/* Top bar */}
      <View style={styles.cameraTopBar}>
        <Image source={require('../../assets/logo.png')} style={styles.cameraLogo} resizeMode="contain" />
        <TouchableOpacity onPress={() => void logout()} style={styles.profileBtn}>
          <View style={styles.avatar}>
            <Ionicons name="person-outline" size={16} color={colors.accent} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Viewfinder */}
      <View style={styles.viewfinderContainer}>
        {resolving ? (
          <ActivityIndicator size="large" color={colors.accent} />
        ) : (
          <>
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <Text style={styles.scanHint}>
              Scan product, location, or order barcode
            </Text>
          </>
        )}
      </View>

      {/* Error */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Manual entry */}
      {manualMode ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'position' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.manualSheetWrapper}
        >
        <View style={styles.manualSheet}>
          <Text style={styles.manualLabel}>Enter barcode manually</Text>
          <TextInput
            style={styles.manualInput}
            value={manualValue}
            onChangeText={setManualValue}
            placeholder="SKU, barcode, location or order ID"
            placeholderTextColor={colors.ink4}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <View style={styles.manualBtns}>
            <TouchableOpacity
              style={styles.manualSubmit}
              onPress={() => {
                if (manualValue.trim()) {
                  setManualMode(false);
                  void handleScan({ data: manualValue.trim() });
                  setManualValue('');
                }
              }}
            >
              <Text style={styles.manualSubmitText}>Search</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.manualCancel}
              onPress={() => { setManualMode(false); setManualValue(''); }}
            >
              <Text style={styles.manualCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
       </KeyboardAvoidingView>
      ) : (
        <TouchableOpacity
          style={styles.manualTrigger}
          onPress={() => setManualMode(true)}
        >
          <Ionicons name="create-outline" size={18} color={colors.ink3} />
          <Text style={styles.manualTriggerText}>Enter manually</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Need Image import
import { Image } from 'react-native';

const VIEWFINDER_SIZE = 240;
const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  cameraTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 56, paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    backgroundColor: colors.cameraOverlay,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  cameraLogo: { height: 20, width: 100 },
  profileBtn: {},
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.accentGhost,
    borderWidth: 1, borderColor: colors.accentBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  viewfinderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewfinder: {
    width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE,
    borderColor: colors.accent, borderWidth: CORNER_THICKNESS,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  scanHint: { marginTop: spacing.lg, color: colors.cameraHint, fontSize: font.size.sm },
  errorBanner: {
    position: 'absolute', bottom: 100, left: spacing.lg, right: spacing.lg,
    backgroundColor: colors.errorGhost, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.errorBorder,
    padding: spacing.md,
  },
  errorText: { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
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
  permText: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center', marginBottom: spacing.lg },
  permBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  permBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  manualTrigger: {
    position: 'absolute',
    bottom: spacing.xxl + spacing.lg,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.cameraBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  manualTriggerText: {
    color: colors.ink3,
    fontSize: font.size.sm,
  },
  manualSheet: {
    backgroundColor: colors.bg2,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    gap: spacing.md,
  },
  manualLabel: {
    color: colors.ink3,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  manualInput: {
    backgroundColor: colors.bg3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.rule2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.medium,
  },
  manualBtns: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  manualSubmit: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  manualSubmitText: {
    color: colors.bg,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  manualCancel: {
    flex: 1,
    backgroundColor: colors.bg3,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.rule,
  },
  manualCancelText: {
    color: colors.ink3,
    fontSize: font.size.md,
  },
  manualSheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});