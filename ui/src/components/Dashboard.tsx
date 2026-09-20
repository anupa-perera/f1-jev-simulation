import { GroupedBars } from './GroupedBars';
import { RaceCard } from './RaceCard';
import { Scoreboard } from './Scoreboard';
import { SeriesLegend } from './SeriesLegend';
import { integer, isScored, seriesColors, sortComparisons } from '@/lib/format';
import type { RunData } from '@/lib/types';

/** The saved-run view, shared verbatim by the live dashboard's history section
 *  and the standalone exported report. Pure presentation: no fetching here. */
export function Dashboard({ data }: { data: RunData }) {
  const comparisons = sortComparisons(data.comparisons);
  const colors = seriesColors(comparisons);
  const scored = comparisons.filter(isScored);

  if (!comparisons.length) {
    return (
      <div className="rounded-md bg-card p-10 text-center text-muted-foreground">
        No run records yet. Run <code className="text-foreground">npm run compare</code> or{' '}
        <code className="text-foreground">npm run benchmark</code>, then reload this page.
      </div>
    );
  }

  return (
    <div className="grid gap-10">
      <SeriesLegend colors={colors} />

      {data.summary.length ? <Scoreboard rows={data.summary} /> : null}

      <section>
        <h2 className="mb-4 text-2xl font-bold">Per-race comparison</h2>
        <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
          {scored.length ? (
            <GroupedBars
              title="Winner log loss"
              unit="lower is better"
              comparisons={scored}
              colors={colors}
              value={record => record.metrics?.winnerLogLoss}
              format={value => value.toFixed(2)}
            />
          ) : null}
          {scored.length ? (
            <GroupedBars
              title="Brier score"
              unit="lower is better"
              comparisons={scored}
              colors={colors}
              value={record => record.metrics?.brier}
              format={value => value.toFixed(2)}
            />
          ) : null}
          <GroupedBars
            title="End-to-end time"
            unit="ms"
            comparisons={comparisons}
            colors={colors}
            value={record => record.durationMs}
            format={integer}
          />
          <GroupedBars
            title="Reported tokens"
            unit="provider units"
            comparisons={comparisons}
            colors={colors}
            value={record => record.usage.totalTokens}
            format={integer}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">Races</h2>
        <div className="grid gap-4">
          {comparisons.map(comparison => (
            <RaceCard key={comparison.id} comparison={comparison} colors={colors} />
          ))}
        </div>
      </section>
    </div>
  );
}
