// apps/mobile/src/screens/AvailabilityScreen.tsx
import { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Screen, Card, Row, Button, Divider, AppHeader } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

/**
 * AVAILABILITY CALENDAR SCREEN (PP10-03)
 * ---------------------------------------
 * Operator marks days available/unavailable for the current week.
 * Owner reads team availability via web dashboard.
 *
 * UX:
 * - Shows Mon–Sun of current week
 * - Tap a day to toggle available/unavailable
 * - Saves immediately on tap (no submit button needed)
 * - Optimistic update — reverts on API error
 */

type DayAvailability = {
  date: string;        // YYYY-MM-DD
  is_available: boolean;
  notes?: string | null;
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekDates(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function formatMonthRange(dates: string[]): string {
  const first = new Date(dates[0]);
  const last = new Date(dates[6]);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${first.toLocaleDateString('en-US', opts)} – ${last.toLocaleDateString('en-US', opts)}`;
}

export default function AvailabilityScreen() {
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // date being saved
  const [error, setError] = useState<string | null>(null);

  const weekDates = getWeekDates(weekStart);
  const weekParam = weekDates[0];

  const loadWeek = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(
        `/api/v1/operators/availability?week=${weekParam}`
      );
      const map: Record<string, boolean> = {};
      // Default all days to available — operator only marks unavailable explicitly
      weekDates.forEach((d) => { map[d] = true; });
      for (const row of data.availability ?? []) {
        map[row.date] = row.is_available;
      }
      setAvailability(map);
    } catch {
      setError('Failed to load availability.');
    } finally {
      setLoading(false);
    }
  }, [weekParam]);

  useEffect(() => { void loadWeek(); }, [loadWeek]);

  const toggleDay = useCallback(async (date: string) => {
    const current = availability[date] ?? true;
    const next = !current;

    // Optimistic update
    setAvailability((prev) => ({ ...prev, [date]: next }));
    setSaving(date);

    try {
      await apiClient.post('/api/v1/operators/availability', {
        date,
        is_available: next,
      });
    } catch {
      // Revert on failure
      setAvailability((prev) => ({ ...prev, [date]: current }));
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(null);
    }
  }, [availability]);

  const goToPrevWeek = () => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const goToNextWeek = () => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <Screen>
      {/* HEADER */}
      <AppHeader showLogo />

      <Divider />

      <ScrollView contentContainerStyle={styles.content}>

        {/* WEEK NAV */}
        <Row style={styles.weekNav}>
          <TouchableOpacity onPress={goToPrevWeek} style={styles.weekNavBtn}>
            <Text style={styles.weekNavArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.weekRange}>{formatMonthRange(weekDates)}</Text>
          <TouchableOpacity onPress={goToNextWeek} style={styles.weekNavBtn}>
            <Text style={styles.weekNavArrow}>›</Text>
          </TouchableOpacity>
        </Row>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <Card style={styles.calendarCard}>
            {weekDates.map((date, idx) => {
              const isAvailable = availability[date] ?? true;
              const isToday = date === todayStr;
              const isSavingThis = saving === date;
              const isPast = date < todayStr;

              return (
                <View key={date}>
                  <TouchableOpacity
                    style={[
                      styles.dayRow,
                      isPast && styles.dayRowPast,
                    ]}
                    onPress={() => !isPast && void toggleDay(date)}
                    disabled={isPast || isSavingThis}
                    activeOpacity={isPast ? 1 : 0.7}
                  >
                    {/* DAY LABEL */}
                    <View style={styles.dayLabel}>
                      <Text style={[
                        styles.dayName,
                        isToday && styles.dayNameToday,
                        isPast && styles.dayTextPast,
                      ]}>
                        {DAY_LABELS[idx]}
                      </Text>
                      <Text style={[
                        styles.dayDate,
                        isToday && styles.dayNameToday,
                        isPast && styles.dayTextPast,
                      ]}>
                        {new Date(date).getDate()}
                      </Text>
                    </View>

                    {/* STATUS */}
                    {isSavingThis ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <View style={[
                        styles.statusPill,
                        isAvailable
                          ? styles.statusAvailable
                          : styles.statusUnavailable,
                        isPast && styles.statusPast,
                      ]}>
                        <Text style={[
                          styles.statusText,
                          isAvailable
                            ? styles.statusTextAvailable
                            : styles.statusTextUnavailable,
                          isPast && styles.statusTextPast,
                        ]}>
                          {isAvailable ? 'Available' : 'Unavailable'}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  {idx < 6 && <Divider />}
                </View>
              );
            })}
          </Card>
        )}

        {/* LEGEND */}
        <View style={styles.legend}>
          <Text style={styles.legendText}>
            Tap a day to toggle your availability. Past days cannot be changed.
          </Text>
        </View>

      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backText: {
    color: colors.accent,
    fontSize: font.size.md,
    width: 48,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  weekNav: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.xs,
  },
  weekNavBtn: {
    padding: spacing.sm,
  },
  weekNavArrow: {
    color: colors.accent,
    fontSize: 24,
  },
  weekRange: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  calendarCard: {
    padding: 0,
    overflow: 'hidden',
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    minHeight: 56,
  },
  dayRowPast: {
    opacity: 0.4,
  },
  dayLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dayName: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.medium,
    width: 36,
  },
  dayDate: {
    color: colors.ink3,
    fontSize: font.size.sm,
    width: 24,
  },
  dayNameToday: {
    color: colors.accent,
    fontWeight: font.weight.bold,
  },
  dayTextPast: {
    color: colors.ink4,
  },
  statusPill: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderWidth: 1,
  },
  statusAvailable: {
    backgroundColor: colors.successGhost,
    borderColor: colors.successBorder,
  },
  statusUnavailable: {
    backgroundColor: colors.errorGhost,
    borderColor: colors.errorBorder,
  },
  statusPast: {
    backgroundColor: colors.bg3,
    borderColor: colors.rule,
  },
  statusText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
  },
  statusTextAvailable: {
    color: colors.success,
  },
  statusTextUnavailable: {
    color: colors.error,
  },
  statusTextPast: {
    color: colors.ink4,
  },
  center: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  errorBanner: {
    backgroundColor: colors.errorGhost,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    padding: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: font.size.sm,
  },
  legend: {
    paddingHorizontal: spacing.sm,
  },
  legendText: {
    color: colors.ink4,
    fontSize: font.size.xs,
    textAlign: 'center',
    lineHeight: 18,
  },
});