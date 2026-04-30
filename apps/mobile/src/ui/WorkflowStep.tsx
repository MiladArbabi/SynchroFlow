// apps/mobile/src/ui/WorkflowStep.tsx
//
// UNIFIED 3-SECTION WORKFLOW STEP
// --------------------------------
// Used across all operator workflows:
// Pick → Stow → Receive → Pack
//
// Section 1: Context (location, supplier, order)
// Section 2: Item (product, quantity, progress)
// Section 3: Action (barcode input, scan/confirm, exception)

import { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Modal, Vibration,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, radius } from '../theme';
import { Row } from './Row';
import { Divider } from './Divider';

export type WorkflowStepContext = {
  label: string;       // e.g. "Location", "Supplier", "Order"
  value: string;       // e.g. "WH-1-A01", "QA Supplier", "#900001"
  sublabel?: string;   // optional secondary context
};

export type WorkflowStepItem = {
  title: string;
  sku?: string | null;
  quantity: number;
  currentIndex: number;  // 1-based
  totalCount: number;
};

export type ExceptionType = {
  type: string;
  label: string;
  icon?: string;
};

type Props = {
  context: WorkflowStepContext;
  item: WorkflowStepItem;
  exceptions: ExceptionType[];
  expectedBarcode?: string | null;
  onConfirm: (scannedValue: string) => Promise<void>;
  onException: (exceptionType: string, quantity: number) => Promise<void>;
  confirmLabel?: string;
  isSubmitting?: boolean;
  inputPrefix?: string;
  scanType?: 'location' | 'product' | 'invoice' | 'generic';
};

const VIBRATION_SUCCESS = [0, 80];
const VIBRATION_ERROR = [0, 100, 80, 100];

export function WorkflowStep({
  context,
  item,
  exceptions,
  expectedBarcode,
  onConfirm,
  onException,
  confirmLabel = 'Confirm',
  isSubmitting = false,
  inputPrefix,
  scanType = 'generic',
}: Props) {
  const [barcodeValue, setBarcodeValue] = useState('');
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'scanned' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showExceptions, setShowExceptions] = useState(false);
  const [selectedExType, setSelectedExType] = useState('');
  const [exQty, setExQty] = useState('1');
  const [permission, requestPermission] = useCameraPermissions();
  const inputRef = useRef<TextInput>(null);
  const [confirmed, setConfirmed] = useState(false);
  const confirmingRef = useRef(false);

  const scanConfig = {
    location: {
      icon: 'location-outline' as const,
      color: colors.info ?? colors.accent,
      placeholder: 'Scan location barcode',
      stepLabel: 'SCAN LOCATION',
    },
    product: {
      icon: 'cube-outline' as const,
      color: colors.accent,
      placeholder: 'Scan product barcode or type SKU',
      stepLabel: 'SCAN PRODUCT',
    },
    invoice: {
      icon: 'document-outline' as const,
      color: colors.success,
      placeholder: 'Scan invoice barcode',
      stepLabel: 'SCAN INVOICE',
    },
    generic: {
      icon: 'scan-outline' as const,
      color: colors.accent,
      placeholder: 'Scan or type barcode',
      stepLabel: 'SCAN',
    },
  }[scanType];

  const handleScan = useCallback(({ data }: { data: string }) => {
    setShowCamera(false);
    setBarcodeValue(data);
    setScanState('scanned');
    setErrorMsg(null);
    Vibration.vibrate(VIBRATION_SUCCESS);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    if (!barcodeValue.trim()) {
      setErrorMsg('Please scan or enter a barcode first.');
      setScanState('error');
      confirmingRef.current = false;
      return;
    }

    if (expectedBarcode && barcodeValue.trim() !== expectedBarcode) {
      Vibration.vibrate(VIBRATION_ERROR);
      setErrorMsg(`Wrong barcode. Expected: ${expectedBarcode}`);
      setScanState('error');
      return;
    }

    try {
      setScanState('scanned');
      await onConfirm(barcodeValue.trim());
      // Show success briefly then reset
      setConfirmed(true);
      setTimeout(() => {
        setConfirmed(false);
        setBarcodeValue('');
        setScanState('idle');
        setErrorMsg(null);
        confirmingRef.current = false;
      }, 600);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Confirmation failed.';
      setErrorMsg(msg);
      setScanState('error');
      Vibration.vibrate(VIBRATION_ERROR);
      confirmingRef.current = false;
    }
  }, [barcodeValue, expectedBarcode, onConfirm]);

  const handleOpenCamera = useCallback(async () => {
    if (!permission?.granted) {
      await requestPermission();
    }
    setShowCamera(true);
    setScanState('idle');
    setErrorMsg(null);
  }, [permission, requestPermission]);

  const handleException = useCallback(async () => {
    if (!selectedExType) return;
    setShowExceptions(false);
    await onException(selectedExType, parseInt(exQty, 10) || 1);
    setBarcodeValue('');
    setScanState('idle');
    setErrorMsg(null);
    setSelectedExType('');
    setExQty('1');
  }, [onException, selectedExType, exQty]);

  const isConfirmReady = scanState === 'scanned' || (barcodeValue.trim().length > 0 && scanState !== 'error');

  return (
    <View style={styles.root}>

      {/* ── STEP BANNER ── */}
      <View style={[styles.stepBanner, { borderLeftColor: scanConfig.color }]}>
        <Ionicons name={scanConfig.icon} size={20} color={scanConfig.color} />
        <Text style={[styles.stepBannerText, { color: scanConfig.color }]}>
          {scanConfig.stepLabel}
        </Text>
      </View>

      {/* ── SECTION 1: CONTEXT ── */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{context.label}</Text>
        <Text style={styles.contextValue}>{context.value}</Text>
        {context.sublabel && (
          <Text style={styles.contextSublabel}>{context.sublabel}</Text>
        )}
      </View>

      <Divider />

      {/* ── SECTION 2: ITEM ── */}
      <View style={styles.section}>
        <Row style={styles.progressRow}>
          <Text style={styles.sectionLabel}>Item</Text>
          <Text style={styles.progressText}>
            {item.currentIndex} of {item.totalCount}
          </Text>
        </Row>
        <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
        {item.sku && <Text style={styles.itemSku}>{item.sku}</Text>}
        <Text style={styles.itemQty}>Qty: {item.quantity}</Text>

        {/* Progress dots */}
        <Row style={styles.dots}>
          {Array.from({ length: item.totalCount }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i < item.currentIndex - 1 && styles.dotDone,
                i === item.currentIndex - 1 && styles.dotActive,
              ]}
            />
          ))}
        </Row>
      </View>

      <Divider />

      {/* ── SECTION 3: ACTION ── */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.actionKAV}
      >
      <View style={styles.section}>
        <View style={styles.scanTypeHeader}>
          <Ionicons name={scanConfig.icon} size={18} color={scanConfig.color} />
          <Text style={[styles.sectionLabel, { color: scanConfig.color }]}>
            {scanConfig.stepLabel}
          </Text>
        </View>

        {/* Input field */}
        <View style={[
          styles.barcodeInputWrap,
          scanState === 'scanned' && styles.barcodeInputSuccess,
          scanState === 'error' && styles.barcodeInputError,
        ]}>
          {inputPrefix && (
            <Text style={styles.inputPrefix}>{inputPrefix}</Text>
          )}
          <TextInput
            ref={inputRef}
            style={styles.barcodeInput}
            value={barcodeValue}
            onChangeText={(v) => {
              setBarcodeValue(v);
              setScanState(v ? 'scanned' : 'idle');
              setErrorMsg(null);
            }}
            placeholder={scanConfig.placeholder}
            placeholderTextColor={colors.ink4}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Error message */}
        {errorMsg && (
          <Text style={styles.errorText}>{errorMsg}</Text>
        )}

        {/* Scan / Confirm button */}
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            isConfirmReady && styles.primaryBtnReady,
            (isSubmitting || confirmed) && styles.primaryBtnDisabled,
            confirmed && styles.primaryBtnConfirmed,
          ]}
          onPress={isConfirmReady ? () => void handleConfirm() : () => void handleOpenCamera()}
          disabled={isSubmitting || confirmed}
        >
          <Ionicons
            name={confirmed ? 'checkmark-circle' : isConfirmReady ? 'checkmark-circle-outline' : 'scan-outline'}
            size={20}
            color={colors.bg}
          />
          <Text style={[styles.primaryBtnText, isConfirmReady && styles.primaryBtnReadyText]}>
            {confirmed ? 'Confirmed ✓' : isSubmitting ? 'Confirming…' : isConfirmReady ? confirmLabel : 'Scan barcode'}
          </Text>
        </TouchableOpacity>

        {/* Report problem */}
        <TouchableOpacity
          style={styles.exceptionBtn}
          onPress={() => setShowExceptions(true)}
        >
              <Ionicons name="warning-outline" size={18} color={colors.ink3} />
            <Text style={styles.exceptionBtnText}>Report problem</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── CAMERA MODAL ── */}
      <Modal visible={showCamera} animationType="slide" onRequestClose={() => setShowCamera(false)}>
        <View style={styles.cameraRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            onBarcodeScanned={handleScan}
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e'],
            }}
          />
          {/* Viewfinder */}
          <View style={styles.viewfinderContainer}>
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <Text style={styles.cameraHint}>Point at barcode to scan</Text>
          </View>
          {/* Close */}
          <TouchableOpacity
            style={styles.cameraClose}
            onPress={() => setShowCamera(false)}
          >
            <Ionicons name="close-circle" size={44} color={colors.ink} />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── EXCEPTION SHEET ── */}
      <Modal
        visible={showExceptions}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowExceptions(false); setSelectedExType(''); setExQty('1'); }}
      >
        <TouchableOpacity
          style={styles.exceptionBackdrop}
          activeOpacity={1}
          onPress={() => { setShowExceptions(false); setSelectedExType(''); setExQty('1'); }}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'position' : 'height'}
          style={styles.exceptionKAV}
        >
          <View style={styles.exceptionSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.exceptionTitle}>Report problem</Text>

            {/* Exception type grid */}
            <View style={styles.exceptionGrid}>
              {exceptions.map((exc) => {
              const { type, label } = exc;
              return (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.exceptionGridItem,
                    selectedExType === type && styles.exceptionGridItemSelected,
                  ]}
                  onPress={() => setSelectedExType(type)}
                >
                  <Ionicons
                    name={(exc.icon ?? 'alert-circle-outline') as any}
                    size={22}
                    color={selectedExType === type ? colors.accent : colors.ink3}
                  />
                  <Text style={[
                    styles.exceptionGridLabel,
                    selectedExType === type && styles.exceptionGridLabelSelected,
                  ]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            </View>

            {/* Qty input */}
            <View style={styles.exQtyRow}>
              <Text style={styles.exQtyLabel}>Quantity affected</Text>
              <TextInput
                style={styles.exQtyInput}
                keyboardType="number-pad"
                value={exQty}
                onChangeText={setExQty}
                placeholder="1"
                placeholderTextColor={colors.ink4}
                maxLength={3}
              />
            </View>

            {/* Actions */}
            <TouchableOpacity
              style={[styles.exceptionConfirm, !selectedExType && styles.exceptionConfirmDisabled]}
              onPress={() => void handleException()}
              disabled={!selectedExType}
            >
              <Text style={styles.exceptionConfirmText}>Report problem</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.exceptionCancel}
              onPress={() => { setShowExceptions(false); setSelectedExType(''); setExQty('1'); }}
            >
              <Text style={styles.exceptionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const VIEWFINDER_SIZE = 240;
const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  root: { flex: 1 },
  section: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.ink3,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  contextValue: {
    color: colors.accent,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
  contextSublabel: {
    color: colors.ink3,
    fontSize: font.size.sm,
  },
  progressRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    color: colors.ink3,
    fontSize: font.size.sm,
  },
  itemTitle: {
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    lineHeight: 24,
  },
  itemSku: {
    color: colors.ink3,
    fontSize: font.size.sm,
  },
  itemQty: {
    color: colors.ink2,
    fontSize: font.size.md,
    fontWeight: font.weight.medium,
  },
  dots: {
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.bg3,
  },
  dotDone: {
    backgroundColor: colors.success,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 20,
    borderRadius: 4,
  },
  barcodeInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.rule2,
    paddingHorizontal: spacing.md,
  },
  inputPrefix: {
    color: colors.ink3,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    marginRight: spacing.xs,
  },
  barcodeInput: {
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    letterSpacing: 1,
  },
  barcodeInputSuccess: {
    borderColor: colors.success,
    backgroundColor: colors.successGhost,
  },
  barcodeInputError: {
    borderColor: colors.error,
    backgroundColor: colors.errorGhost,
  },
  errorText: {
    color: colors.error,
    fontSize: font.size.sm,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg3,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.rule2,
  },
  primaryBtnReady: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  primaryBtnReadyText: {
    color: colors.bg,
  },
  exceptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule2,
    backgroundColor: colors.bg3,
  },
  exceptionBtnText: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.medium,
  },
  // Camera
  cameraRoot: { flex: 1, backgroundColor: colors.bg },
  viewfinderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: colors.accent,
    borderWidth: CORNER_THICKNESS,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  cameraHint: {
    marginTop: spacing.lg,
    color: colors.cameraHint,
    fontSize: font.size.sm,
  },
  cameraClose: {
    position: 'absolute',
    bottom: spacing.xxl,
    alignSelf: 'center',
  },
  // Exception sheet
  exceptionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetHandle: {
    width: 40, height: 4,
    backgroundColor: colors.ink4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  exceptionTitle: {
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    marginBottom: spacing.xs,
  },
  exceptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  exceptionItemText: {
    color: colors.ink,
    fontSize: font.size.md,
  },
  exceptionCancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  exceptionCancelText: {
    color: colors.ink3,
    fontSize: font.size.md,
  },
  exceptionKAV: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  exceptionSheet: {
    backgroundColor: colors.bg2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  exceptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  exceptionGridItem: {
    width: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderColor: colors.rule,
    gap: spacing.xs,
  },
  exceptionGridItemSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGhost,
  },
  exceptionGridLabel: {
    color: colors.ink3,
    fontSize: font.size.xs,
    textAlign: 'center',
  },
  exceptionGridLabelSelected: {
    color: colors.accent,
    fontWeight: font.weight.semibold,
  },
  exQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exQtyLabel: {
    color: colors.ink3,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
  },
  exQtyInput: {
    backgroundColor: colors.bg3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.rule2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    textAlign: 'center',
    width: 80,
  },
  exceptionConfirm: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  exceptionConfirmDisabled: { backgroundColor: colors.bg3 },
  exceptionConfirmText: {
    color: colors.bg,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  scanTypeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderLeftWidth: 3,
    backgroundColor: colors.bg2,
  },
  stepBannerText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  primaryBtnConfirmed: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  actionKAV: { flex: 1 },
});