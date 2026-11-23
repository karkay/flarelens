import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { VariableCorrelationResult } from '../types';

function formatClockTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${h12}:${m} ${ampm}`;
}

export const ExposureFlareChart: React.FC<{
  result: VariableCorrelationResult;
  windowDays?: number;
}> = ({ result, windowDays = 21 }) => {
  const [showCumulative, setShowCumulative] = useState(
    result.pattern === 'cumulative_buildup'
  );

  const points = useMemo(() => {
    const slice = result.timeline.slice(-windowDays);
    return slice;
  }, [result.timeline, windowDays]);

  const isBinaryExposure =
    result.category === 'food_ingredient' || result.valueType === 'boolean';

  const width = 340;
  const height = 225;
  const padLeft = 30;
  const padRight = 14;
  const padTop = 26;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const n = Math.max(1, points.length);
  const xForIndex = (i: number) =>
    n === 1 ? padLeft + plotW / 2 : padLeft + (i / (n - 1)) * plotW;

  const yForSeverity = (sev: number) =>
    padTop + plotH - (Math.max(0, Math.min(10, sev)) / 10) * plotH;

  // Normalize exposure values into lower 70% of plot height so both series read clearly
  const expValues = points
    .map((p) => p.exposureValue)
    .filter((v): v is number => v !== null);
  const maxExp = Math.max(1, ...expValues);
  const minExp = isBinaryExposure ? 0 : Math.min(0, ...expValues);
  const expRange = Math.max(1, maxExp - minExp);

  const cumValues = points
    .map((p) => p.cumulativeExposure)
    .filter((v): v is number => v !== null);
  const maxCum = Math.max(1, ...cumValues);
  const minCum = isBinaryExposure ? 0 : Math.min(0, ...cumValues);
  const cumRange = Math.max(1, maxCum - minCum);

  const yForExposure = (val: number) => {
    const norm = (val - minExp) / expRange;
    return padTop + plotH - norm * (plotH * 0.72);
  };

  const yForCumulative = (val: number) => {
    const norm = (val - minCum) / cumRange;
    return padTop + plotH - norm * (plotH * 0.78);
  };

  // Build Eczema Severity line & area paths
  const severityCoords = points
    .map((p, idx) =>
      p.severity !== null ? { x: xForIndex(idx), y: yForSeverity(p.severity), idx, p } : null
    )
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const severityPath = severityCoords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');

  const severityAreaPath =
    severityCoords.length >= 2
      ? `${severityPath} L ${severityCoords[severityCoords.length - 1].x.toFixed(1)} ${(
          padTop + plotH
        ).toFixed(1)} L ${severityCoords[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
      : '';

  // Build 3-day cumulative build-up path
  const cumCoords = points
    .map((p, idx) =>
      p.cumulativeExposure !== null
        ? { x: xForIndex(idx), y: yForCumulative(p.cumulativeExposure), idx }
        : null
    )
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const cumulativePath = cumCoords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');

  // Map dateKey -> x index for drawing Exposure-to-Flare Lag Connectors
  const dateIndexMap = new Map<string, number>();
  points.forEach((p, idx) => dateIndexMap.set(p.dateKey, idx));

  const visiblePairs = result.exposureFlarePairs.filter(
    (pair) =>
      dateIndexMap.has(pair.exposureDateKey) && dateIndexMap.has(pair.flareDateKey)
  );

  // Pick 4–5 evenly spaced date labels along X-axis
  const tickIndices: number[] = [];
  if (points.length > 0) {
    const step = Math.max(1, Math.floor((points.length - 1) / 4));
    for (let i = 0; i < points.length; i += step) {
      tickIndices.push(i);
    }
    if (tickIndices[tickIndices.length - 1] !== points.length - 1) {
      tickIndices.push(points.length - 1);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.topControlRow}>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: COLORS.trigger }]} />
            <Text style={styles.legendText}>Eczema Severity</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: COLORS.exposure }]} />
            <Text style={styles.legendText}>
              {isBinaryExposure ? 'Exposure Time' : result.variableName}
            </Text>
          </View>
          {showCumulative && (
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: COLORS.cumulative }]} />
              <Text style={styles.legendText}>3d Build-Up</Text>
            </View>
          )}
        </View>

        <Pressable
          onPress={() => setShowCumulative((prev) => !prev)}
          style={[styles.togglePill, showCumulative && styles.togglePillActive]}
        >
          <Text
            style={[styles.togglePillText, showCumulative && styles.togglePillTextActive]}
          >
            3d Build-Up
          </Text>
        </Pressable>
      </View>

      <View style={styles.chartFrame}>
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          <Defs>
            <LinearGradient id="flareAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={COLORS.trigger} stopOpacity="0.24" />
              <Stop offset="1" stopColor={COLORS.trigger} stopOpacity="0.02" />
            </LinearGradient>
          </Defs>

          {/* Horizontal severity gridlines (0, 5, 10) */}
          {[0, 5, 10].map((val) => {
            const y = yForSeverity(val);
            return (
              <React.Fragment key={val}>
                <Line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke={COLORS.borderLight}
                  strokeWidth={1}
                />
                <SvgText
                  x={padLeft - 6}
                  y={y + 3.5}
                  fontSize={9.5}
                  fill={COLORS.textMuted}
                  textAnchor="end"
                >
                  {val}
                </SvgText>
              </React.Fragment>
            );
          })}

          {/* Variable Exposure Bars / Event Markers */}
          {points.map((p, idx) => {
            if (p.exposureValue === null) return null;
            const x = xForIndex(idx);
            const bottomY = padTop + plotH;

            if (isBinaryExposure) {
              if (p.exposureValue <= 0) return null;
              const stemTop = padTop + plotH * 0.34;
              return (
                <React.Fragment key={`exp_${p.dateKey}`}>
                  <Line
                    x1={x}
                    y1={stemTop}
                    x2={x}
                    y2={bottomY}
                    stroke={COLORS.exposure}
                    strokeWidth={2}
                    strokeDasharray="3,2"
                    opacity={0.75}
                  />
                  {/* Diamond exposure marker */}
                  <Polygon
                    points={`${x},${stemTop - 5.5} ${x + 5.5},${stemTop} ${x},${
                      stemTop + 5.5
                    } ${x - 5.5},${stemTop}`}
                    fill={COLORS.exposure}
                  />
                </React.Fragment>
              );
            }

            const barTop = yForExposure(p.exposureValue);
            const barW = Math.max(4, Math.min(11, plotW / (n * 1.6)));
            return (
              <Rect
                key={`bar_${p.dateKey}`}
                x={x - barW / 2}
                y={barTop}
                width={barW}
                height={Math.max(2, bottomY - barTop)}
                rx={2.5}
                fill={COLORS.exposure}
                opacity={0.28}
              />
            );
          })}

          {/* 3-Day Cumulative Build-Up Curve */}
          {showCumulative && cumulativePath.length > 0 && (
            <Path
              d={cumulativePath}
              fill="none"
              stroke={COLORS.cumulative}
              strokeWidth={1.9}
              strokeDasharray="5,3"
            />
          )}

          {/* Eczema Severity Shaded Area & Line */}
          {severityAreaPath.length > 0 && (
            <Path d={severityAreaPath} fill="url(#flareAreaGrad)" />
          )}
          {severityPath.length > 0 && (
            <Path
              d={severityPath}
              fill="none"
              stroke={COLORS.trigger}
              strokeWidth={2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Exposure -> Flare-Up Lag Connectors */}
          {(() => {
            const placed: { midX: number; arcY: number }[] = [];
            return visiblePairs.slice(-4).map((pair, idx) => {
              const expIdx = dateIndexMap.get(pair.exposureDateKey)!;
              const flareIdx = dateIndexMap.get(pair.flareDateKey)!;
              const x1 = xForIndex(expIdx);
              const x2 = xForIndex(flareIdx);
              const yPeak = yForSeverity(pair.flareSeverity);
              const midX = Math.max(padLeft + 20, Math.min(width - padRight - 20, (x1 + x2) / 2));
              let arcY = Math.max(14, yPeak - 18);
              for (const prev of placed) {
                if (Math.abs(prev.midX - midX) < 42 && Math.abs(prev.arcY - arcY) < 17) {
                  arcY = Math.max(12, prev.arcY - 17);
                }
              }
              placed.push({ midX, arcY });

              return (
                <React.Fragment key={`pair_${idx}`}>
                  <Path
                    d={`M ${x1.toFixed(1)} ${(arcY + 8).toFixed(1)} Q ${midX.toFixed(
                      1
                    )} ${(arcY - 4).toFixed(1)} ${x2.toFixed(1)} ${(yPeak - 6).toFixed(1)}`}
                    fill="none"
                    stroke={COLORS.primaryDark}
                    strokeWidth={1.3}
                    strokeDasharray="2.5,2"
                  />
                  <Rect
                    x={midX - 18}
                    y={arcY - 10}
                    width={36}
                    height={14}
                    rx={7}
                    fill={COLORS.primaryDark}
                  />
                  <SvgText
                    x={midX}
                    y={arcY}
                    fontSize={8.5}
                    fontWeight="700"
                    fill="#FFFFFF"
                    textAnchor="middle"
                  >
                    +{Math.round(pair.lagHours)}h
                  </SvgText>
                </React.Fragment>
              );
            });
          })()}

          {/* Flare Peak Dots */}
          {severityCoords.map((c) => (
            <Circle
              key={`dot_${c.p.dateKey}`}
              cx={c.x}
              cy={c.y}
              r={c.p.isFlarePeak ? 4.5 : 2.3}
              fill={c.p.isFlarePeak ? COLORS.extreme : COLORS.trigger}
              stroke="#FFFFFF"
              strokeWidth={c.p.isFlarePeak ? 1.5 : 0.6}
            />
          ))}

          {/* X-axis date ticks */}
          {tickIndices.map((idx) => (
            <SvgText
              key={`tick_${idx}`}
              x={xForIndex(idx)}
              y={height - 10}
              fontSize={9.5}
              fill={COLORS.textMuted}
              textAnchor="middle"
            >
              {points[idx].label}
            </SvgText>
          ))}
        </Svg>
      </View>

      {/* Exposure-to-Reaction Event Pairing Breakdown */}
      {result.exposureFlarePairs.length > 0 && (
        <View style={styles.pairsBox}>
          <Text style={styles.pairsTitle}>
            Exposure → Flare-Up Reaction Timing ({result.exposureFlarePairs.length} matched)
          </Text>
          {result.exposureFlarePairs.slice(-4).reverse().map((pair, idx) => (
            <View key={idx} style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pairTimes}>
                  Exposed {formatClockTime(pair.exposureTimestamp)}
                </Text>
                <Text style={styles.pairSub}>
                  Flare ({pair.flareSeverity}/10) at {formatClockTime(pair.flareTimestamp)}
                </Text>
              </View>
              <View style={styles.lagChip}>
                <Text style={styles.lagChipText}>+{pair.lagLabel}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.xs,
  },
  topControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
    gap: SPACING.xs,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    flex: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  togglePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceMuted,
  },
  togglePillActive: {
    backgroundColor: COLORS.cumulativeLight,
    borderColor: COLORS.cumulative,
  },
  togglePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  togglePillTextActive: {
    color: COLORS.cumulative,
  },
  chartFrame: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 4,
  },
  pairsBox: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  pairsTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    gap: 8,
  },
  pairTimes: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  pairSub: {
    fontSize: 11.5,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  lagChip: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  lagChipText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: COLORS.primaryDark,
  },
});
