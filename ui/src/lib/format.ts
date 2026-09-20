import type { Comparison, Record_ } from './types';

const integerFormat = new Intl.NumberFormat('en-US');

export const integer = (value: number) => integerFormat.format(Math.round(value));
export const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
export const seriesKey = (record: Pick<Record_, 'provider' | 'model'>) => `${record.provider}:${record.model}`;
export const raceLabel = (target: Comparison['target']) => `${target.season} R${target.round}`;

/** Four validated hues, assigned in first-seen order so a provider keeps the
 *  same colour across every chart and race card on the page.
 *  ponytail: a fifth series wraps. Fold into "Other" if runs ever compare >4. */
const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];

export function seriesColors(comparisons: Comparison[]): Map<string, string> {
  const keys: string[] = [];
  for (const comparison of comparisons) {
    for (const record of comparison.records) {
      const key = seriesKey(record);
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return new Map(keys.map((key, index) => [key, palette[index % palette.length]]));
}

export function sortComparisons(comparisons: Comparison[]): Comparison[] {
  return [...comparisons].sort(
    (a, b) =>
      a.target.season - b.target.season ||
      a.target.round - b.target.round ||
      Date.parse(a.snapshotAt) - Date.parse(b.snapshotAt),
  );
}

export const isScored = (comparison: Comparison) =>
  Boolean(comparison.outcome) && comparison.records.some(record => record.metrics);
