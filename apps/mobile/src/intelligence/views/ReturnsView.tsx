// apps/mobile/src/intelligence/views/ReturnsView.tsx
import { styles } from '../styles';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../ui';
import { colors, font, spacing } from '../../theme';
import { ReturnCorrelation } from '../types';
import { returnRateColor, formatDate } from '../helpers';
import { ZoneError, StatRow, ReturnRateBar } from '../components';

function ReturnsView({ data, loading, error, onRetry }: { data: ReturnCorrelation[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  if (error) return <ZoneError message={error} onRetry={onRetry} />;

  const totalReturned = data.reduce((s, r) => s + Number(r.units_returned), 0);
  const totalSold = data.reduce((s, r) => s + Number(r.units_sold), 0);
  const overallRate = totalSold > 0 ? (totalReturned / totalSold) * 100 : null;
  const avgRate = data.length > 0 ? data.reduce((s, r) => s + Number(r.return_rate_pct ?? 0), 0) / data.length : 0;

  const supplierMap = new Map<string, { name: string; returned: number; sold: number }>();
  for (const row of data) {
    if (!row.supplier_name) continue;
    const e = supplierMap.get(row.supplier_name) ?? { name: row.supplier_name, returned: 0, sold: 0 };
    e.returned += row.units_returned; e.sold += row.units_sold;
    supplierMap.set(row.supplier_name, e);
  }
  const suppliers = Array.from(supplierMap.values())
    .map(s => ({ ...s, rate: s.sold > 0 ? (s.returned / s.sold) * 100 : 0 }))
    .sort((a, b) => b.rate - a.rate);

  if (data.length === 0) {
    return (
      <Card style={styles.allClearCard}>
        <Ionicons name="checkmark-circle-outline" size={32} color={colors.success} />
        <Text style={styles.allClearText}>No return data yet</Text>
      </Card>
    );
  }

  return (
    <>
      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>Overall Return Rate</Text>
        {overallRate !== null ? (
          <>
            <Text style={[styles.heroValue, { color: returnRateColor(overallRate) }]}>{overallRate.toFixed(1)}%</Text>
            <Text style={styles.heroTarget}>{totalReturned} of {totalSold} units returned</Text>
            {overallRate >= 10 && (
              <View style={styles.heroAlertRow}>
                <Ionicons name="warning-outline" size={13} color={colors.error} />
                <Text style={styles.heroAlertText}>Above healthy threshold (10%)</Text>
              </View>
            )}
          </>
        ) : null}
      </Card>
      {overallRate !== null && (
        <Card>
          <Text style={styles.sectionTitle}>Return rate health</Text>
          <ReturnRateBar rate={overallRate} />
        </Card>
      )}
      {totalReturned > 0 && (
        <Card>
          <StatRow label="Units returned this period" value={`${totalReturned} of ${totalSold} sold`} />
          <StatRow
            label="Return rate impact"
            value={overallRate !== null ? `${overallRate.toFixed(1)}% of revenue at risk` : '—'}
            accent={overallRate !== null && overallRate >= 10 ? colors.error : colors.warning}
          />
        </Card>
      )}
      {suppliers.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>By supplier</Text>
          {suppliers.map(s => (
            <View key={s.name} style={styles.poRow}>
              <View style={styles.poLeft}>
                <Text style={styles.poSupplier} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.poDate}>{s.returned} of {s.sold} returned</Text>
              </View>
              <Text style={[styles.poCost, { color: returnRateColor(s.rate) }]}>{s.rate.toFixed(1)}%</Text>
            </View>
          ))}
        </Card>
      )}
      {data.filter(r => (Number(r.return_rate_pct ?? 0)) >= Math.max(15, avgRate * 1.5)).length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>⚠️ Suspect batches</Text>
          {data.filter(r => (Number(r.return_rate_pct ?? 0)) >= Math.max(15, avgRate * 1.5)).map(row => (
            <View key={`${row.lasyncro_variant_id}-${row.receive_job_id ?? 'x'}`} style={styles.variantRow}>
              <View style={styles.variantTop}>
                <Text style={styles.variantTitle} numberOfLines={1}>{row.variant_title ?? row.sku ?? 'Unknown'}</Text>
                <Text style={[styles.skuMarginPct, { color: returnRateColor(row.return_rate_pct ?? 0) }]}>
                  {(row.return_rate_pct ?? 0).toFixed(1)}%
                </Text>
              </View>
              {row.supplier_name && (
                <Text style={styles.variantStat}>{row.supplier_name}{row.batch_received_at ? ` · ${formatDate(row.batch_received_at)}` : ''}</Text>
              )}
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

export { ReturnsView };
