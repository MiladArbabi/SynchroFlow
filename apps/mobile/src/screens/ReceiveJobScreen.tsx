// apps/mobile/src/screens/ReceiveJobScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  Alert, TextInput, TouchableOpacity,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { TaskStackScreenProps, TaskStackParamList } from '../navigation/types';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Card, Button, Badge, Row, Divider } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

type ReceiveJobLine = {
  receive_job_line_id: string;
  lasyncro_variant_id: string;
  sku: string | null;
  variant_title: string | null;
  quantity_expected: number;
  quantity_accepted: number;
  quantity_rejected: number;
  inspection_complete: boolean;
};

type ReceiveJob = {
  receive_job_id: string;
  status: string;
  supplier_name: string;
  total_variants: number;
  total_units: number;
  units_accepted: number;
  units_rejected: number;
};

type InspectionEntry = {
  accepted: string;
  rejected: string;
  done: boolean;
};

const EXCEPTION_TYPES = [
  { type: 'defect', label: 'Product defect' },
  { type: 'packaging_damage', label: 'Packaging damage' },
  { type: 'wrong_item', label: 'Wrong item' },
  { type: 'wrong_variant', label: 'Wrong variant' },
  { type: 'wrong_quantity', label: 'Wrong quantity' },
  { type: 'barcode_mismatch', label: 'Barcode mismatch' },
  { type: 'other', label: 'Other' },
];

export default function ReceiveJobScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const route = useRoute<TaskStackScreenProps<'ReceiveJob'>['route']>();
  const { task } = route.params;

  const [job, setJob] = useState<ReceiveJob | null>(null);
  const [lines, setLines] = useState<ReceiveJobLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-line inspection state: lineId → { accepted, rejected, done }
  const [inspection, setInspection] = useState<Record<string, InspectionEntry>>({});

  // Exception sheet state
  const [exceptionLine, setExceptionLine] = useState<ReceiveJobLine | null>(null);
  const [exceptionNotes, setExceptionNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(`/api/v1/suppliers/receive-jobs/${task.id}`);
      setJob(data.job);
      setLines(data.lines ?? []);

      // Pre-fill inspection state from existing data
      const init: Record<string, InspectionEntry> = {};
      for (const line of data.lines ?? []) {
        init[line.receive_job_line_id] = {
          accepted: line.inspection_complete ? String(line.quantity_accepted) : String(line.quantity_expected),
          rejected: line.inspection_complete ? String(line.quantity_rejected) : '0',
          done: line.inspection_complete,
        };
      }
      setInspection(init);
    } catch {
      setError('Failed to load receive job.');
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);

  const handleInspectLine = useCallback(async (line: ReceiveJobLine) => {
    const entry = inspection[line.receive_job_line_id];
    if (!entry) return;

    const accepted = parseInt(entry.accepted, 10);
    const rejected = parseInt(entry.rejected, 10);

    if (isNaN(accepted) || isNaN(rejected) || accepted < 0 || rejected < 0) {
      Alert.alert('Invalid', 'Enter valid quantities.');
      return;
    }
    if (accepted + rejected > line.quantity_expected) {
      Alert.alert('Invalid', `Total cannot exceed expected qty (${line.quantity_expected}).`);
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/suppliers/receive-jobs/${task.id}/inspect`, {
        lasyncro_variant_id: line.lasyncro_variant_id,
        quantity_accepted: accepted,
        quantity_rejected: rejected,
      });
      setInspection((prev) => ({
        ...prev,
        [line.receive_job_line_id]: { ...entry, done: true },
      }));
      setLines((prev) =>
        prev.map((l) =>
          l.receive_job_line_id === line.receive_job_line_id
            ? { ...l, inspection_complete: true, quantity_accepted: accepted, quantity_rejected: rejected }
            : l
        )
      );
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Inspection failed.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }, [inspection, task.id]);

  const handleReportException = useCallback(async (
    line: ReceiveJobLine,
    exceptionType: string,
    notes?: string,
  ) => {
    try {
      await apiClient.post(`/api/v1/suppliers/receive-jobs/${task.id}/exception`, {
        lasyncro_variant_id: line.lasyncro_variant_id,
        receive_job_line_id: line.receive_job_line_id,
        exception_type: exceptionType,
        quantity_affected: parseInt(inspection[line.receive_job_line_id]?.rejected ?? '0', 10) || 1,
        notes: notes || undefined,
      });
      setExceptionLine(null);
      setExceptionNotes('');
    } catch {
      Alert.alert('Error', 'Failed to report exception.');
    }
  }, [task.id, inspection]);

  const handleClose = useCallback(async () => {
    const allDone = lines.every((l) => l.inspection_complete);
    if (!allDone) {
      Alert.alert('Incomplete', 'All lines must be inspected before closing.');
      return;
    }

    Alert.alert(
      'Close receive job',
      'This will generate barcodes for all accepted variants and create stow tasks. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close & generate barcodes',
          style: 'default',
          onPress: async () => {
            setSubmitting(true);
            try {
              await apiClient.post(`/api/v1/suppliers/receive-jobs/${task.id}/close`, {});
              Alert.alert(
                '✓ Receive job closed',
                'Barcodes are being generated. Print and attach to accepted products before stow.',
                [{ text: 'Done', onPress: () => navigation.goBack() }]
              );
            } catch (err: unknown) {
              const msg = (err as { response?: { data?: { error?: string } } })
                ?.response?.data?.error ?? 'Failed to close job.';
              Alert.alert('Error', msg);
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  }, [lines, task.id, navigation]);

  const allInspected = lines.every((l) => l.inspection_complete);
  const inspectedCount = lines.filter((l) => l.inspection_complete).length;

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  if (error || !job) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? 'Job not found.'}</Text>
          <Button label="Retry" onPress={load} style={styles.retryBtn} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* HEADER */}
      <Row style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{job.supplier_name}</Text>
        <Badge
          label={`${inspectedCount}/${lines.length}`}
          variant={allInspected ? 'success' : 'warning'}
        />
      </Row>

      <Divider />

      {/* SUMMARY */}
      <Row style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{job.total_variants}</Text>
          <Text style={styles.summaryLabel}>Variants</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{job.total_units}</Text>
          <Text style={styles.summaryLabel}>Expected</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{job.units_accepted}</Text>
          <Text style={styles.summaryLabel}>Accepted</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{job.units_rejected}</Text>
          <Text style={styles.summaryLabel}>Rejected</Text>
        </View>
      </Row>

      <Divider />

      {/* LINE ITEMS */}
      <FlatList
        data={lines}
        keyExtractor={(item) => item.receive_job_line_id}
        contentContainerStyle={styles.list}
        renderItem={({ item: line }) => {
          const entry = inspection[line.receive_job_line_id] ?? {
            accepted: String(line.quantity_expected),
            rejected: '0',
            done: false,
          };

          return (
            <Card style={line.inspection_complete ? { ...styles.lineCard, ...styles.lineCardDone } : styles.lineCard}>
              {/* Variant info */}
              <Row style={styles.lineHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.variantTitle} numberOfLines={1}>
                    {line.variant_title ?? line.sku ?? line.lasyncro_variant_id.slice(0, 8)}
                  </Text>
                  {line.sku && <Text style={styles.sku}>{line.sku}</Text>}
                </View>
                {line.inspection_complete ? (
                  <Badge label="✓ Done" variant="success" />
                ) : (
                  <Badge label={`Exp: ${line.quantity_expected}`} variant="info" />
                )}
              </Row>

              {/* Inspection inputs */}
              {!line.inspection_complete && (
                <>
                  <Row style={styles.inputRow}>
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Accepted</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="number-pad"
                        value={entry.accepted}
                        onChangeText={(v) =>
                          setInspection((prev) => ({
                            ...prev,
                            [line.receive_job_line_id]: { ...entry, accepted: v },
                          }))
                        }
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Rejected</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="number-pad"
                        value={entry.rejected}
                        onChangeText={(v) =>
                          setInspection((prev) => ({
                            ...prev,
                            [line.receive_job_line_id]: { ...entry, rejected: v },
                          }))
                        }
                      />
                    </View>
                  </Row>

                  <Row style={styles.lineActions}>
                    <Button
                      label="Confirm"
                      onPress={() => void handleInspectLine(line)}
                      variant="primary"
                      style={styles.confirmBtn}
                    />
                    <Button
                      label="Exception"
                      onPress={() => setExceptionLine(line)}
                      variant="ghost"
                      style={styles.exceptionBtn}
                    />
                  </Row>
                </>
              )}

              {/* Already inspected — allow exception reporting */}
              {line.inspection_complete && line.quantity_rejected > 0 && (
                <Button
                  label="Report exception"
                  onPress={() => setExceptionLine(line)}
                  variant="ghost"
                  style={styles.exceptionBtn}
                />
              )}
            </Card>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />

      {/* CLOSE BUTTON */}
      <View style={styles.footer}>
        <Button
          label={submitting ? 'Processing…' : `Close & generate barcodes (${lines.filter(l => l.inspection_complete).length}/${lines.length})`}
          onPress={() => void handleClose()}
          variant="primary"
        />
      </View>

      {/* EXCEPTION SHEET */}
      {exceptionLine && (
        <View style={styles.exceptionSheet}>
          <Text style={styles.exceptionTitle}>
            Exception — {exceptionLine.variant_title ?? exceptionLine.sku}
          </Text>
          {EXCEPTION_TYPES.map(({ type, label }) => (
            <Button
              key={type}
              label={label}
              onPress={() => {
                if (type === 'other' || type === 'barcode_mismatch') {
                  // Show notes input
                  Alert.prompt(
                    label,
                    'Add notes (required)',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Report',
                        onPress: (notes: string | undefined) => void handleReportException(exceptionLine, type, notes),
                      },
                    ],
                    'plain-text'
                  );
                } else {
                  void handleReportException(exceptionLine, type);
                }
              }}
              variant="ghost"
              style={styles.exceptionTypeBtn}
            />
          ))}
          <Button
            label="Cancel"
            onPress={() => setExceptionLine(null)}
            variant="ghost"
            style={styles.cancelExceptionBtn}
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
  backText: { color: colors.accent, fontSize: font.size.md },
  headerTitle: {
    flex: 1,
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    marginHorizontal: spacing.md,
  },
  summary: {
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  summaryItem: { alignItems: 'center', gap: spacing.xs },
  summaryValue: {
    color: colors.accent,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
  },
  summaryLabel: { color: colors.ink3, fontSize: font.size.xs ?? 11 },
  list: { padding: spacing.md, paddingBottom: 120 },
  lineCard: { gap: spacing.sm },
  lineCardDone: { opacity: 0.7 },
  lineHeader: { justifyContent: 'space-between', alignItems: 'flex-start' },
  variantTitle: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  sku: { color: colors.ink3, fontSize: font.size.sm, marginTop: 2 },
  inputRow: { gap: spacing.md, marginTop: spacing.xs },
  inputGroup: { flex: 1, gap: spacing.xs },
  inputLabel: { color: colors.ink3, fontSize: font.size.sm },
  input: {
    backgroundColor: colors.bg3,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    textAlign: 'center',
  },
  lineActions: { gap: spacing.sm, marginTop: spacing.xs },
  confirmBtn: { flex: 1 },
  exceptionBtn: { flex: 1 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
  },
  exceptionSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.bg2,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.rule,
    gap: spacing.sm,
  },
  exceptionTitle: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    marginBottom: spacing.xs,
  },
  exceptionTypeBtn: {},
  cancelExceptionBtn: { marginTop: spacing.xs },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  errorText: { color: colors.error, fontSize: font.size.sm, textAlign: 'center' },
  retryBtn: { marginTop: spacing.md },
});