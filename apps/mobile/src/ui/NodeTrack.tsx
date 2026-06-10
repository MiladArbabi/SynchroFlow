// apps/mobile/src/ui/NodeTrack.tsx
//
// NODE TRACK — §10.7 shared component (MOB-UX-01)
// ------------------------------------------------
// Two-node pipeline visual for Work screens (§10.4.3, §10.6).
// Shows operator progress through a two-step scan sequence
// (e.g. Location → Product in Pick/Stow, Inspect → Scan in Receive).
//
// NODE STATES:
//   pending — greyed out, not yet reached
//   active  — accent color + looping pulse animation (awaiting scan)
//   done    — success green + checkmark icon (confirmed by server)
//   error   — error red + X icon (exception / sad path)
//
// DESIGNED FOR: exactly 2 nodes (the canonical warehouse two-step).
// Accepts up to 4 for future flexibility — layout degrades gracefully.
//
// CONTRACT (§10.7):
//   - Pure visual — no state, no API calls, no side effects.
//   - Parent owns all state; NodeTrack renders it.
//   - Animations clean up on unmount.
//
// CHANGE CONTROL: consumed by every Work screen. Test across
// Receive, Stow, and Pick after changes.

import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, radius } from '../theme';

export type NodeState = 'pending' | 'active' | 'done' | 'error' | 'queued';

export type TrackNode = {
  /** Unique key for this node */
  id: string;
  /** Primary label — the thing the operator acts on (e.g. "A-3-07", "Blue T-Shirt · L") */
  label: string;
  /** Secondary label — the role of the node (e.g. "Location", "Product") */
  sublabel?: string;
  /** Render state */
  state: NodeState;
};

export type NodeTrackProps = {
  nodes: TrackNode[]; // ordered left → right; canonical use is 2 nodes
};

// ─── Palette (resolves tokens to concrete values per state) ──────────────────

const NODE_COLOR: Record<NodeState, string> = {
  pending: colors.ink4,
  active:  colors.accent,
  done:    colors.ok,
  error:   colors.bad,
  queued:  colors.ink3,
};

const NODE_BG: Record<NodeState, string> = {
  pending: colors.bg3,
  active:  colors.accentSubtle,
  done:    colors.okSoft,
  error:   colors.badSoft,
  queued:  colors.queued,
};

const CONNECTOR_COLOR = colors.rule ?? '#333';

// ─── Single animated node ─────────────────────────────────────────────────────

function TrackNodeView({ node }: { node: TrackNode }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (node.state === 'active') {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.18, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
    return () => { pulseLoop.current?.stop(); };
  }, [node.state, pulseAnim]);

  const icon = node.state === 'done'
    ? 'checkmark'
    : node.state === 'error'
    ? 'close'
    : node.state === 'queued'
    ? 'time-outline'
    : null;

  return (
    <View style={styles.nodeWrapper}>
      {/* Pulse ring — visible only on active */}
      {node.state === 'active' && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              borderColor: NODE_COLOR.active,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />
      )}

      {/* Node circle */}
      <View
        style={[
          styles.nodeCircle,
          {
            backgroundColor: NODE_BG[node.state],
            borderColor: NODE_COLOR[node.state],
            borderWidth: node.state === 'pending' ? 1 : 1.5,
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={14}
            color={NODE_COLOR[node.state]}
          />
        ) : (
          <View
            style={[
              styles.nodeDot,
              { backgroundColor: NODE_COLOR[node.state] },
            ]}
          />
        )}
      </View>

      {/* Labels */}
      <Text
        style={[
          styles.nodeLabel,
          { color: node.state === 'pending' ? (colors.ink4 ?? '#888') : colors.ink },
        ]}
        numberOfLines={1}
      >
        {node.label}
      </Text>
      {node.sublabel ? (
        <Text style={styles.nodeSublabel} numberOfLines={1}>
          {node.sublabel}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Connector line between nodes ─────────────────────────────────────────────

function Connector({ filled }: { filled: boolean }) {
  return (
    <View style={styles.connectorWrapper}>
      <View
        style={[
          styles.connectorLine,
          { backgroundColor: filled ? NODE_COLOR.done : CONNECTOR_COLOR },
        ]}
      />
    </View>
  );
}

// ─── NodeTrack ────────────────────────────────────────────────────────────────

export function NodeTrack({ nodes }: NodeTrackProps) {
  return (
    <View style={styles.track}>
      {nodes.map((node, i) => (
        <View key={node.id} style={styles.trackSlot}>
          <TrackNodeView node={node} />
          {i < nodes.length - 1 && (
            <Connector filled={node.state === 'done'} />
          )}
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const NODE_SIZE = 36;
const PULSE_RING_SIZE = NODE_SIZE + 14;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  trackSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  nodeWrapper: {
    alignItems: 'center',
    minWidth: 72,
  },
  pulseRing: {
    position: 'absolute',
    top: -(PULSE_RING_SIZE - NODE_SIZE) / 2,
    width: PULSE_RING_SIZE,
    height: PULSE_RING_SIZE,
    borderRadius: PULSE_RING_SIZE / 2,
    borderWidth: 1.5,
    opacity: 0.4,
  },
  nodeCircle: {
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  nodeLabel: {
    marginTop: spacing.xs,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
    textAlign: 'center',
    maxWidth: 80,
  },
  nodeSublabel: {
    marginTop: 2,
    fontSize: font.size.xs ?? font.size.sm,
    color: colors.ink4 ?? '#888',
    textAlign: 'center',
    maxWidth: 80,
  },
  connectorWrapper: {
    flex: 1,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.lg, // visually align with node center
  },
  connectorLine: {
    height: 1.5,
    borderRadius: 1,
  },
});