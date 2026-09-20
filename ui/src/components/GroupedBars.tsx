import { cn } from 'cn';
import { raceLabel, seriesKey } from '@/lib/format';
import type { Comparison, Record_ } from '@/lib/types';

/** Round only the top corners so a bar reads as growing off the baseline. */
function roundedTopBar(x: number, y: number, width: number, height: number, radius = 4) {
  const r = Math.min(radius, height, width / 2);
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`;
}

/** Snap the axis to a 1/2/2.5/5/10 step so gridline labels stay readable. */
function niceMax(value: number) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

type Props = {
  title: string;
  unit?: string;
  comparisons: Comparison[];
  colors: Map<string, string>;
  value: (record: Record_) => number | undefined;
  format: (value: number) => string;
  className?: string;
};

export function GroupedBars({ title, unit, comparisons, colors, value, format, className }: Props) {
  const width = 320;
  const height = 200;
  const left = 48;
  const right = 8;
  const top = 10;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const max = niceMax(
    Math.max(0, ...comparisons.flatMap(comparison => comparison.records.map(value).filter((n): n is number => Number.isFinite(n)))),
  );
  const groupWidth = plotWidth / comparisons.length;
  const seriesCount = colors.size;
  const barWidth = Math.max(2, Math.min(28, (groupWidth * 0.7 - 2 * (seriesCount - 1)) / seriesCount));
  const y = (amount: number) => top + plotHeight - (amount / max) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(fraction => fraction * max);
  const keys = [...colors.keys()];

  return (
    <figure className={cn('rounded-md bg-card p-4', className)}>
      <figcaption className="pb-1 text-sm font-bold text-foreground">
        {title}
        {unit ? <span className="ml-2 font-normal text-subtle">{unit}</span> : null}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} per race by provider`} className="block h-auto w-full overflow-visible">
        <g>
          {ticks.map(tick => (
            <line key={tick} x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" />
          ))}
        </g>
        <g className="fill-subtle text-[13px]">
          {ticks.map(tick => (
            <text key={tick} x={left - 8} y={y(tick) + 4} textAnchor="end">
              {format(tick)}
            </text>
          ))}
          {comparisons.map((comparison, groupIndex) => {
            const groupStart = left + groupIndex * groupWidth + (groupWidth - (barWidth * seriesCount + 2 * (seriesCount - 1))) / 2;
            return (
              <g key={comparison.id}>
                {comparison.records.map(record => {
                  const amount = value(record);
                  if (!Number.isFinite(amount)) return null;
                  const key = seriesKey(record);
                  const x = groupStart + keys.indexOf(key) * (barWidth + 2);
                  const barHeight = Math.max(0, top + plotHeight - y(amount as number));
                  return (
                    <path
                      key={key}
                      d={roundedTopBar(x, y(amount as number), barWidth, barHeight)}
                      fill={colors.get(key)}
                      className="transition-[filter] hover:brightness-125"
                    >
                      <title>{`${raceLabel(comparison.target)} · ${key}: ${format(amount as number)}${unit ? ` ${unit}` : ''}`}</title>
                    </path>
                  );
                })}
                <text x={left + groupIndex * groupWidth + groupWidth / 2} y={height - 8} textAnchor="middle">
                  {raceLabel(comparison.target)}
                </text>
              </g>
            );
          })}
        </g>
        <line x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} stroke="var(--subtle)" />
      </svg>
    </figure>
  );
}
