import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { COLORS, SPACING } from '../constants/theme';
import { LagCorrelationStat, LagWindowKey } from '../types';

export const LagProfileChart: React.FC<{
  lags: LagCorrelationStat[];
  bestLagKey: LagWindowKey;
  compact?: boolean;
}> = ({ lags, bestLagKey, compact = false }) => {
  if (compact) {
    return (
      <View style={styles.compactRow}>
        {lags.map((lag) => {
          const abs = Math.min(1, Math.abs(lag.score));
          const isBest = lag.lagKey === bestLagKey;
          const color =
            lag.score >= 0.18
              ? COLORS.trigger
              : lag.score <= -0.18
              ? COLORS.protective
              : COLORS.border;
          return (
            <View key={lag.lagKey} style={styles.compactCol}>
              <View style={styles.compactBarTrack}>
                <View
                  style={[
                    styles.compactBarFill,
                    {
                      height: `${Math.max(12, Math.round(abs * 100))}%`,
                      backgroundColor: color,
                      opacity: isBest ? 1 : 0.45,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.compactLabel, isBest && styles.compactLabelBest]}>
                {lag.shortLabel}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  const width = 320;
  const height = 148;
  const padLeft = 10;
  const padRight = 10;
  const midY = 76;
  const maxBarH = 48;
  const colW = (width - padLeft - padRight) / Math.max(1, lags.length);

  return (
    <View style={styles.fullContainer}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Zero correlation baseline */}
        <Line
          x1={padLeft}
          y1={midY}
          x2={width - padRight}
          y2={midY}
          stroke={COLORS.border}
          strokeWidth={1.2}
          strokeDasharray="3,3"
        />

        {lags.map((lag, idx) => {
          const xCenter = padLeft + colW * idx + colW / 2;
          const barW = Math.min(28, colW * 0.56);
          const barH = Math.max(3, Math.abs(lag.score) * maxBarH);
          const isPos = lag.score >= 0;
          const y = isPos ? midY - barH : midY;
          const isBest = lag.lagKey === bestLagKey;
          const isCumulative = lag.lagKey.startsWith('cumulative_');

          const fill =
            lag.score >= 0.18
              ? isCumulative
                ? COLORS.cumulative
                : COLORS.trigger
              : lag.score <= -0.18
              ? COLORS.protective
              : COLORS.textMuted;

          return (
            <React.Fragment key={lag.lagKey}>
              <Rect
                x={xCenter - barW / 2}
                y={y}
                width={barW}
                height={barH}
                rx={4}
                fill={fill}
                opacity={isBest ? 1 : 0.42}
              />
              <SvgText
                x={xCenter}
                y={isPos ? y - 5 : y + barH + 11}
                fontSize={9.5}
                fontWeight={isBest ? '700' : '500'}
                fill={isBest ? COLORS.text : COLORS.textMuted}
                textAnchor="middle"
              >
                {lag.score >= 0 ? `+${lag.score.toFixed(2)}` : lag.score.toFixed(2)}
              </SvgText>
              <SvgText
                x={xCenter}
                y={height - 6}
                fontSize={9.5}
                fontWeight={isBest ? '700' : '500'}
                fill={isBest ? COLORS.primaryDark : COLORS.textSecondary}
                textAnchor="middle"
              >
                {lag.shortLabel}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>

      <View style={styles.legendRow}>
        <Text style={styles.legendHint}>
          Above line (+r): Trigger · Below line (-r): Protective · Peak window highlighted
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  compactRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    marginTop: SPACING.sm,
  },
  compactCol: {
    flex: 1,
    alignItems: 'center',
  },
  compactBarTrack: {
    width: '100%',
    height: 22,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  compactBarFill: {
    width: '100%',
    borderRadius: 4,
  },
  compactLabel: {
    fontSize: 9.5,
    color: COLORS.textMuted,
    marginTop: 3,
  },
  compactLabelBest: {
    color: COLORS.text,
    fontWeight: '700',
  },
  fullContainer: {
    marginTop: SPACING.xs,
  },
  legendRow: {
    alignItems: 'center',
    marginTop: 2,
  },
  legendHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
