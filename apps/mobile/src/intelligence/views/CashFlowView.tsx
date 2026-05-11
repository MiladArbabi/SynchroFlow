// apps/mobile/src/intelligence/views/CashFlowView.tsx
import { styles } from '../styles';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../ui';
import { colors, font, spacing } from '../../theme';
import { CashFlowData } from '../types';
import { formatCurrency, cashColor, formatDate } from '../helpers';
import { ZoneError, StatRow, MiniSparkline } from '../components';

function CashFlowView({ data, loading, error, onRetry }: { data: CashFlowData | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  if (error) return <ZoneError message={error} onRetry={onRetry} />;
  if (!data) return null;
  return (
    <>
      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>Net Cash Position</Text>
        <Text style={[styles.heroValue, { color: cashColor(data.summary.net_cash_position) }]}>
          {formatCurrency(data.summary.net_cash_position)}
        </Text>
        {data.summary.at_risk_revenue > 0 && (
          <View style={styles.heroAlertRow}>
            <Ionicons name="warning-outline" size={13} color={colors.error} />
            <Text style={styles.heroAlertText}>{formatCurrency(data.summary.at_risk_revenue)} at risk</Text>
          </View>
        )}
      </Card>
      <Card>
        <StatRow label="Realized Revenue" value={formatCurrency(data.summary.realized_revenue)} />
        <StatRow label="Pending Revenue" value={formatCurrency(data.summary.pending_revenue)} />
        {data.gross_profit.gross_margin_pct != null && (
          <StatRow
            label="Gross Margin"
            value={`${Number(data.gross_profit.gross_margin_pct).toFixed(1)}%`}
            accent={Number(data.gross_profit.gross_margin_pct) >= 40 ? colors.success : colors.warning}
          />
        )}
        {data.summary.working_capital_locked > 0 && (
          <StatRow label="Locked in Inventory" value={formatCurrency(data.summary.working_capital_locked)} accent={colors.warning} />
        )}
      </Card>
      {data.po_outflows.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>Upcoming PO Outflows</Text>
          {data.po_outflows.map(po => (
            <View key={po.po_id} style={styles.poRow}>
              <View style={styles.poLeft}>
                <Text style={styles.poSupplier} numberOfLines={1}>{po.supplier_name}</Text>
                <Text style={[styles.poDate, new Date(po.expected_delivery_date) < new Date() && { color: colors.error }]}>
                  {new Date(po.expected_delivery_date) < new Date() ? 'Overdue · ' : ''}{formatDate(po.expected_delivery_date)}
                </Text>
              </View>
              <Text style={styles.poCost}>{formatCurrency(po.total_cost)}</Text>
            </View>
          ))}
        </Card>
      )}
      {data.projection_60d?.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>60-day runway</Text>
          <Text style={styles.sectionSubtitle}>Projected weekly cash position (base scenario)</Text>
          <MiniSparkline
            values={data.projection_60d.map(w => Number(w.base))}
            color={cashColor(data.summary.net_cash_position)}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
            <Text style={{ color: colors.ink4, fontSize: 9 }}>Now</Text>
            <Text style={{ color: colors.ink4, fontSize: 9 }}>+60 days</Text>
          </View>
        </Card>
      )}
    </>
  );
}

export { CashFlowView };
