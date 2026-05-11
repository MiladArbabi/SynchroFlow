// apps/mobile/src/intelligence/views/DemandView.tsx
import { styles } from '../styles';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Badge } from '../../ui';
import { colors, font, spacing } from '../../theme';
import { DemandData } from '../types';
import { formatCurrency, daysLabel, statusVariant } from '../helpers';
import { ZoneError, StatRow, HorizontalBar } from '../components';

function DemandView({ data, loading, error, onRetry }: { data: DemandData | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  if (error) return <ZoneError message={error} onRetry={onRetry} />;
  if (!data) return null;
  const alertVariants = data.variants.filter(v => v.reorder_urgency === 'critical' || v.reorder_urgency === 'warning');
  return (
    <>
      <View style={styles.statusLine}>
        <Text style={styles.statusText}>
          {data.summary.total_variants_tracked} SKUs monitored
          {data.summary.critical_reorder_count > 0
            ? ` · ${data.summary.critical_reorder_count} critical`
            : data.summary.warning_reorder_count > 0
            ? ` · ${data.summary.warning_reorder_count} need attention`
            : ' · all healthy'}
        </Text>
      </View>
      {alertVariants.length === 0 ? (
        <Card style={styles.allClearCard}>
          <Ionicons name="checkmark-circle-outline" size={32} color={colors.success} />
          <Text style={styles.allClearText}>No reorder alerts</Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.sectionTitle}>
            {data.summary.critical_reorder_count > 0 ? '⚠️ Reorder alerts' : 'Watch list'}
          </Text>
          {alertVariants.map(v => (
            <View key={v.lasyncro_variant_id} style={styles.variantRow}>
              <View style={styles.variantTop}>
                <Text style={styles.variantTitle} numberOfLines={1}>{v.title}</Text>
                <Badge label={daysLabel(v.days_of_stock_remaining)} variant={statusVariant(v.reorder_urgency)} />
              </View>
              <View style={styles.variantBottom}>
                <Text style={styles.variantStat}>{v.available_quantity} units left</Text>
                {v.velocity_per_day != null && v.velocity_per_day > 0 && (
                  <Text style={styles.variantStat}>{v.velocity_per_day.toFixed(1)} sold/day</Text>
                )}
              </View>
            </View>
          ))}
        </Card>
      )}
      {data.variants.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>Days of stock</Text>
          <Text style={styles.sectionSubtitle}>Red line = 14-day reorder threshold</Text>
          {data.variants
            .filter(v => v.reorder_urgency !== 'no_velocity')
            .slice(0, 6)
            .map(v => (
              <HorizontalBar
                key={v.lasyncro_variant_id}
                label={v.sku ?? v.title}
                value={v.days_of_stock_remaining ?? 0}
                max={Math.max(30, ...data.variants.map(x => x.days_of_stock_remaining ?? 0))}
                threshold={14}
                color={v.reorder_urgency === 'critical' ? colors.error : v.reorder_urgency === 'warning' ? colors.warning : colors.success}
              />
            ))}
        </Card>
      )}
      {(data.summary.avg_days_of_stock != null || data.summary.total_inventory_value > 0) && (
        <Card>
          {data.summary.total_inventory_value > 0 && (
            <StatRow label="Inventory value" value={formatCurrency(data.summary.total_inventory_value)} />
          )}
          {data.summary.avg_days_of_stock != null && (
            <StatRow label="Avg days of stock" value={`${data.summary.avg_days_of_stock.toFixed(1)}d`} />
          )}
          <Text style={[styles.computedAt, { textAlign: 'left', marginTop: spacing.xs }]}>
            Updated {new Date(data.computed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </Card>
      )}
      
    </>
  );
}

export { DemandView };
