// apps/mobile/src/screens/ScanScreen.tsx
import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import { Screen, AppHeader, WorkflowStep } from '../ui';
import { colors, font, spacing } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

const PICK_EXCEPTIONS = [
  { type: 'item_missing', label: 'Item missing', icon: 'search-outline' },
  { type: 'short_pick', label: 'Short pick', icon: 'remove-circle-outline' },
  { type: 'product_defect', label: 'Damaged', icon: 'hammer-outline' },
  { type: 'packaging_defect', label: 'Packaging', icon: 'cube-outline' },
  { type: 'wrong_item', label: 'Wrong item', icon: 'swap-horizontal-outline' },
];

export default function ScanScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const route = useRoute<TaskStackScreenProps<'Scan'>['route']>();
  const { task, lineItems = [] } = route.params;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [pickPhase, setPickPhase] = useState<'location' | 'product'>('location');

  const currentItem = lineItems[currentIndex] ?? null;

  const handleLocationConfirm = useCallback(async (scannedValue: string) => {
    if (!currentItem) return;
    // Resolve scanned value against expected location
    const expected = currentItem.location_code ?? 'ROOT';
    if (scannedValue.trim().toUpperCase() !== expected.toUpperCase()) {
      throw Object.assign(new Error('Wrong location.'), {
        response: { data: { error: `Wrong location — expected ${expected}. Scan the correct location barcode.` } },
      });
    }
    setPickPhase('product');
  }, [currentItem]);

  const handleConfirm = useCallback(async (scannedValue: string) => {
    if (!currentItem) return;
    setSubmitting(true);
    
    try {
      // Resolve barcode to variant
      const { data: resolved } = await apiClient.post('/api/v1/wms/barcode/resolve', {
        scanned_value: scannedValue,
      });

      if (!resolved?.lasyncro_variant_id) {
        throw Object.assign(new Error('Barcode not recognised.'), {
          response: { data: { error: 'Barcode not recognised. Try scanning or check the SKU.' } },
        });
      }

      if (resolved.lasyncro_variant_id !== currentItem.lasyncro_variant_id) {
        throw Object.assign(new Error('Wrong item.'), {
          response: { data: { error: 'Wrong item — barcode does not match this line item.' } },
        });
      }

      // Confirm pick scan
      await apiClient.post('/api/v1/wms/pick/scan', {
        pick_batch_id: task.id,
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id: resolved.lasyncro_variant_id,
        location_code: currentItem.location_code,
        quantity_confirmed: currentItem.quantity,
      });

      const nextIndex = currentIndex + 1;
      if (nextIndex >= lineItems.length) {
        setComplete(true);
      } else {
        setCurrentIndex(nextIndex);
        setPickPhase('location');
      }
    } finally {
      setSubmitting(false);
    }
  }, [currentItem, currentIndex, lineItems.length, task.id]);

const handleException = useCallback(async (exceptionType: string, quantity: number = 1) => {
    if (!currentItem) return;
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/exception`, {
        lasyncro_line_item_id: currentItem.lasyncro_line_item_id,
        lasyncro_variant_id: currentItem.lasyncro_variant_id,
        exception_type: exceptionType,
        stage: 'pick',
        quantity_required: currentItem.quantity,
        quantity_found: currentItem.quantity - quantity,
      });
      // Create PROB label + problem center task for physical bin routing
      await apiClient.post('/api/v1/wms/problem-center', {
        lasyncro_variant_id: currentItem.lasyncro_variant_id,
        quantity,
        exception_type: exceptionType,
        source: 'pick',
        source_exception_id: task.id,
      });
      // Move to next item
      const nextIndex = currentIndex + 1;
      if (nextIndex >= lineItems.length) {
        setComplete(true);
      } else {
        setCurrentIndex(nextIndex);
        setPickPhase('location');
      }
    } catch {
      Alert.alert('Error', 'Failed to report exception.');
    }
  }, [currentItem, currentIndex, lineItems.length, task.id]);

  const handlePickComplete = useCallback(async () => {
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/pick-complete`);
      navigation.goBack();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to complete pick.';
      Alert.alert('Cannot complete', msg);
    }
  }, [task.id, navigation]);

  // Complete screen
  if (complete) {
    return (
      <Screen>
        <AppHeader showLogo />
        <View style={styles.center}>
          <Text style={styles.completeIcon}>✓</Text>
          <Text style={styles.completeTitle}>All items picked</Text>
          <Text style={styles.completeSub}>
            {lineItems.length} line{lineItems.length !== 1 ? 's' : ''} confirmed.
          </Text>
          <TouchableOpacity style={styles.completeBtn} onPress={() => void handlePickComplete()}>
            <Text style={styles.completeBtnText}>Complete pick</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  if (!currentItem) {
    return (
      <Screen>
        <AppHeader showLogo />
        <View style={styles.center}>
          <Text style={styles.completeIcon}>✓</Text>
          <Text style={styles.completeTitle}>All items picked</Text>
          <Text style={styles.completeSub}>This batch has been fully picked.</Text>
          <TouchableOpacity style={styles.completeBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.completeBtnText}>Back to tasks</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader
        title={`Pick · ${task.title}`}
        rightAction={{
          icon: 'close-outline',
          onPress: () => navigation.goBack(),
        }}
      />
      {pickPhase === 'location' ? (
        <WorkflowStep
          scanType="location"
          context={{
            label: 'Item',
            value: currentItem.title,
            sublabel: `SKU: ${currentItem.sku ?? '—'} · Qty: ${currentItem.quantity}`,
          }}
          item={{
            title: currentItem.location_code ?? 'ROOT',
            sku: null,
            quantity: currentItem.quantity,
            currentIndex: currentIndex + 1,
            totalCount: lineItems.length,
          }}
          exceptions={[]}
          onConfirm={handleLocationConfirm}
          onException={async () => {}}
          confirmLabel="Confirm location"
          isSubmitting={false}
        />
      ) : (
        <WorkflowStep
          scanType="product"
          context={{
            label: 'Location',
            value: currentItem.location_code ?? 'ROOT',
            sublabel: 'Scan the product barcode to confirm pick',
          }}
          item={{
            title: currentItem.title,
            sku: currentItem.sku,
            quantity: currentItem.quantity,
            currentIndex: currentIndex + 1,
            totalCount: lineItems.length,
          }}
          exceptions={PICK_EXCEPTIONS}
          onConfirm={handleConfirm}
          onException={handleException}
          confirmLabel="Confirm pick"
          isSubmitting={submitting}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl,
  },
  completeIcon: { fontSize: 64, color: colors.success, marginBottom: spacing.md },
  completeTitle: {
    color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.xs,
  },
  completeSub: { color: colors.ink3, fontSize: font.size.md, marginBottom: spacing.xl },
  completeBtn: {
    backgroundColor: colors.accent, borderRadius: 12,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    width: '100%', alignItems: 'center',
  },
  completeBtnText: { color: colors.bg, fontSize: font.size.md, fontWeight: font.weight.bold },
  backLink: { marginTop: spacing.lg, padding: spacing.md },
  backLinkText: { color: colors.ink3, fontSize: font.size.sm },
  emptyText: { color: colors.ink3, fontSize: font.size.md },
});