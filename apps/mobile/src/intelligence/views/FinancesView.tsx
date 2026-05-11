// apps/mobile/src/intelligence/views/FinancesView.tsx
import { styles } from '../styles';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../ui';
import { colors, font, spacing } from '../../theme';
import { SkuMargin, MARGIN_TARGET } from '../types';
import { formatCurrency, marginColor } from '../helpers';
import { ZoneError, StatRow, MiniBarChart } from '../components';

function FinancesView({ data, loading, error, onRetry }: { data: SkuMargin[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  if (error) return <ZoneError message={error} onRetry={onRetry} />;

  const totalRevenue = data.reduce((s, r) => s + Number(r.gross_revenue), 0);
  const totalMargin = data.reduce((s, r) => s + Number(r.gross_margin), 0);
  const blended = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : null;
  const destroyers = [...data].filter(s => Number(s.margin_pct) < MARGIN_TARGET)
    .sort((a, b) => (MARGIN_TARGET - Number(b.margin_pct)) * b.total_units_sold - (MARGIN_TARGET - Number(a.margin_pct)) * a.total_units_sold)
    .slice(0, 3);

  return (
    <>
      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>Blended Margin</Text>
        {blended !== null ? (
          <>
            <Text style={[styles.heroValue, { color: marginColor(blended) }]}>{blended.toFixed(1)}%</Text>
            <Text style={styles.heroTarget}>Target: {MARGIN_TARGET}%</Text>
            {blended < MARGIN_TARGET && (
              <View style={styles.heroAlertRow}>
                <Ionicons name="arrow-down-outline" size={13} color={colors.error} />
                <Text style={styles.heroAlertText}>{(MARGIN_TARGET - blended).toFixed(1)}% below target</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.emptyText}>No margin data yet</Text>
        )}
      </Card>
      {destroyers.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>⚠️ Margin destroyers</Text>
          <Text style={styles.sectionSubtitle}>Ranked by revenue impact</Text>
          {destroyers.map((sku, i) => (
            <View key={sku.lasyncro_variant_id} style={styles.skuRow}>
              <View style={styles.skuRank}><Text style={styles.skuRankText}>{i + 1}</Text></View>
              <View style={styles.skuMeta}>
                <Text style={styles.variantTitle} numberOfLines={1}>{sku.title}</Text>
                <Text style={styles.variantStat}>{sku.total_units_sold} units · {formatCurrency(sku.gross_revenue)}</Text>
              </View>
              <View style={styles.skuMarginBlock}>
                <Text style={[styles.skuMarginPct, { color: marginColor(Number(sku.margin_pct)) }]}>{Number(sku.margin_pct).toFixed(1)}%</Text>
                <Text style={styles.variantStat}>{formatCurrency(sku.gross_margin)}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}
      {data.length > 0 && (() => {
        const star = [...data].sort((a, b) => Number(b.margin_pct) - Number(a.margin_pct))[0];
        return star && Number(star.margin_pct) >= MARGIN_TARGET ? (
          <Card>
            <Text style={styles.sectionTitle}>⭐ Top performer</Text>
            <View style={styles.skuRow}>
              <View style={styles.skuMeta}>
                <Text style={styles.variantTitle} numberOfLines={1}>{star.title}</Text>
                <Text style={styles.variantStat}>{star.total_units_sold} units · {formatCurrency(Number(star.gross_revenue))}</Text>
              </View>
              <View style={styles.skuMarginBlock}>
                <Text style={[styles.skuMarginPct, { color: colors.success }]}>{Number(star.margin_pct).toFixed(1)}%</Text>
                <Text style={styles.variantStat}>{formatCurrency(Number(star.gross_margin))}</Text>
              </View>
            </View>
          </Card>
        ) : null;
      })()}

      {data.length > 0 && (() => {
        const sorted = [...data].sort((a, b) => Number(a.margin_pct) - Number(b.margin_pct));
        const worst = sorted.slice(0, 5);
        const best = sorted[sorted.length - 1];
        const display = worst.some(s => s.lasyncro_variant_id === best.lasyncro_variant_id)
          ? worst : [...worst, best];
        const remaining = data.length - display.length;
        return (
          <Card>
            <Text style={styles.sectionTitle}>Margin by SKU</Text>
            <Text style={styles.sectionSubtitle}>vs {MARGIN_TARGET}% target · worst first</Text>
            <MiniBarChart
              values={display.map(s => Number(s.margin_pct))}
              labels={display.map(s => (s.sku ?? s.title).slice(0, 8))}
              color={colors.accent}
            />
            {remaining > 0 && (
              <Text style={{ color: colors.ink4, fontSize: font.size.xs, marginTop: spacing.xs }}>
                +{remaining} more SKUs not shown
              </Text>
            )}
          </Card>
        );
      })()}
    </>
  );
}

export { FinancesView };
