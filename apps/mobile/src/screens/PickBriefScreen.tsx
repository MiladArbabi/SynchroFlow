// apps/mobile/src/screens/PickBriefScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import { Screen, Card, Button, Badge, Row, Divider } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

type LineItem = {
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  lasyncro_order_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  location_code: string;
};

export default function PickBriefScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const route = useRoute<TaskStackScreenProps<'PickBrief'>['route']>();
  const { task } = route.params;

  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchStatus, setBatchStatus] = useState<string>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lineRes, batchRes] = await Promise.all([
        apiClient.get(`/api/v1/wms/batch/${task.id}/line-items`),
        apiClient.get('/api/v1/wms/batches'),
      ]);
      setLineItems(lineRes.data.line_items ?? []);
      const batch = (batchRes.data.batches ?? []).find((b: any) => b.pick_batch_id === task.id);
      if (batch) setBatchStatus(batch.status);
    } catch {
      setError('Failed to load batch details.');
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);

  const handleClaim = useCallback(async () => {
    setClaiming(true);
    try {
      await apiClient.post(`/api/v1/wms/batch/${task.id}/claim`);
      navigation.replace('Scan', { task, lineItems });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to claim batch.';
      Alert.alert('Cannot claim', msg);
    } finally {
      setClaiming(false);
    }
  }, [task, lineItems, navigation]);

  const handleContinue = useCallback(() => {
    navigation.replace('Scan', { task, lineItems });
  }, [task, lineItems, navigation]);

  const totalUnits = lineItems.reduce((sum, li) => sum + li.quantity, 0);
  const locations = [...new Set(lineItems.map((li) => li.location_code))];

  return (
    <Screen>
      {/* HEADER */}
      <Row style={styles.header}>
        <Text style={styles.headerTitle}>Pick brief</Text>
        <Badge
          label={
            batchStatus === 'pick_complete' ? 'PICK COMPLETE' :
            batchStatus === 'picking' ? 'IN PROGRESS' :
            batchStatus === 'packing' ? 'PACKING' :
            batchStatus === 'pack_complete' ? 'PACKED' :
            'PENDING'
          }
          variant={
            batchStatus === 'pick_complete' || batchStatus === 'pack_complete' ? 'success' :
            batchStatus === 'picking' || batchStatus === 'packing' ? 'warning' :
            'info'
          }
        />
      </Row>

      <Divider />

      {/* SUMMARY */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{lineItems.length}</Text>
          <Text style={styles.summaryLabel}>Lines</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalUnits}</Text>
          <Text style={styles.summaryLabel}>Units</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{locations.length}</Text>
          <Text style={styles.summaryLabel}>Locations</Text>
        </View>
      </View>

      <Divider />

      {/* LINE ITEMS */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Button label="Retry" onPress={load} style={styles.retryBtn} />
        </View>
      ) : (
        <FlatList
          data={lineItems}
          keyExtractor={(item) => item.lasyncro_line_item_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Card style={styles.lineCard}>
              <Text style={styles.location}>{item.location_code}</Text>
              <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
              {item.sku && <Text style={styles.sku}>{item.sku}</Text>}
              <Text style={styles.qty}>Qty: {item.quantity}</Text>
            </Card>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        />
      )}

      {/* ACTIONS */}
      {!loading && !error && (
        <View style={styles.actions}>
          {batchStatus === 'pick_complete' || batchStatus === 'pack_complete' ? (
            <Button
              label="Pick complete ✓"
              onPress={() => navigation.goBack()}
              variant="ghost"
            />
          ) : batchStatus === 'picking' ? (
            <Button
              label="Continue picking"
              onPress={handleContinue}
              variant="primary"
            />
          ) : (
            <Button
              label={claiming ? 'Claiming…' : 'Claim & start picking'}
              onPress={handleClaim}
              variant="primary"
            />
          )}
          <Button
            label="Back"
            onPress={() => navigation.goBack()}
            variant="ghost"
            style={styles.backBtn}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  summaryItem: { alignItems: 'center', gap: spacing.xs },
  summaryValue: {
    color: colors.accent,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
  summaryLabel: {
    color: colors.ink3,
    fontSize: font.size.sm,
  },
  list: { padding: spacing.md },
  lineCard: { gap: spacing.xs },
  location: {
    color: colors.accent,
    fontSize: font.size.xs ?? 11,
    fontWeight: font.weight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemTitle: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.medium,
  },
  sku: { color: colors.ink3, fontSize: font.size.sm },
  qty: { color: colors.ink2, fontSize: font.size.sm },
  actions: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  backBtn: { marginTop: spacing.xs },
  retryBtn: { marginTop: spacing.md },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorText: { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
});