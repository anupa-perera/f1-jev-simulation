import { ChevronDown } from 'lucide-react';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Swatch } from './SeriesLegend';
import { integer, percent, seriesKey } from '@/lib/format';
import type { Comparison } from '@/lib/types';

/** Which drivers earn a bar row. The union of each provider's top five keeps
 *  disagreement visible, and the actual winner is forced in even when no model
 *  ranked them, because that miss is the most informative row on the card. */
function highlightedDrivers(comparison: Comparison) {
  const winner = comparison.outcome?.winnerDriverId;
  const drivers = new Map<string, { name: string; max: number }>();
  for (const record of comparison.records) {
    for (const entry of record.ranking.slice(0, 5)) {
      drivers.set(entry.driverId, {
        name: entry.name,
        max: Math.max(drivers.get(entry.driverId)?.max ?? 0, entry.probability),
      });
    }
  }
  if (winner && !drivers.has(winner)) {
    const entry = comparison.records[0].ranking.find(row => row.driverId === winner);
    if (entry) drivers.set(winner, { name: entry.name, max: entry.probability });
  }
  return [...drivers].sort((a, b) => b[1].max - a[1].max);
}

export function RaceCard({ comparison, colors }: { comparison: Comparison; colors: Map<string, string> }) {
  const winner = comparison.outcome?.winnerDriverId;
  const finish = new Map((comparison.outcome?.finishOrder ?? []).map(row => [row.driverId, row.finishPosition]));
  const drivers = highlightedDrivers(comparison);
  // Bars scale to the strongest shown probability, not to 100%, so a field where
  // nobody clears 20% still reads as a comparison between providers.
  const scale = Math.max(...drivers.map(([, row]) => row.max), 0.01);
  const allDrivers = comparison.records[0].ranking;

  return (
    <Card className="gap-5">
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="text-xl font-bold">
          {comparison.target.season} · Round {comparison.target.round} · {comparison.target.raceName}
        </h3>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            Snapshot <strong className="text-foreground">{comparison.snapshotAt}</strong>
          </span>
          <span>
            Evidence <strong className="text-foreground">{String(comparison.evidenceHash).slice(0, 12)}</strong>
          </span>
          {winner ? null : <Badge variant="secondary">Result not yet revealed</Badge>}
        </div>
      </CardHeader>

      <CardContent className="grid gap-5">
        <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
          {comparison.records.map(record => {
            const key = seriesKey(record);
            return (
              <div key={key} className="grid gap-0.5 rounded-md bg-background px-3.5 py-3">
                <span className="label-caption flex items-center gap-2">
                  <Swatch color={colors.get(key)} />
                  {key}
                </span>
                <span className={cn('tabular text-[1.35rem] font-bold', record.metadata?.simulated && 'text-muted-foreground')}>
                  {record.metrics ? record.metrics.winnerLogLoss.toFixed(3) : '—'}
                  <small className="text-[0.65em] font-normal"> log loss</small>
                </span>
                <span className="text-sm text-subtle">
                  {integer(record.durationMs)} ms · {integer(record.usage.totalTokens)} tokens
                  {record.metrics
                    ? ` · top pick ${record.metrics.topPickCorrect ? 'correct' : 'wrong'} · ρ ${record.metrics.rankCorrelation?.toFixed(2) ?? 'n/a'}`
                    : ''}
                  {record.metadata?.simulated ? (
                    <Badge variant="secondary" className="ml-2 align-middle">
                      simulated
                    </Badge>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid gap-3">
          {drivers.map(([driverId, row]) => (
            <div key={driverId} className="grid items-center gap-3 sm:grid-cols-[minmax(8rem,12rem)_1fr]">
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span className="tabular min-w-[1.6em] text-subtle">
                  {finish.has(driverId) ? `P${finish.get(driverId)}` : '–'}
                </span>
                <span>{row.name}</span>
                {driverId === winner ? <Badge>Winner</Badge> : null}
              </div>
              <div className="grid gap-0.5">
                {comparison.records.map(record => {
                  const probability = record.probabilities[driverId] ?? 0;
                  const key = seriesKey(record);
                  return (
                    <div
                      key={key}
                      className="tabular grid grid-cols-[1fr_4rem] items-center gap-2 text-sm text-muted-foreground"
                      title={`${key}: ${percent(probability)}`}
                    >
                      <i
                        className="block h-2 min-w-[2px] rounded-r"
                        style={{ background: colors.get(key), width: `${((probability / scale) * 100).toFixed(1)}%` }}
                      />
                      <span>{percent(probability)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-2 text-sm font-bold hover:text-primary">
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
            Full field distribution
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="label-caption">Driver</TableHead>
                  <TableHead className="label-caption text-right">Finish</TableHead>
                  {comparison.records.map(record => (
                    <TableHead key={seriesKey(record)} className="label-caption text-right">
                      {seriesKey(record)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {allDrivers.map(entry => (
                  <TableRow key={entry.driverId}>
                    <TableCell className="whitespace-nowrap">{entry.name}</TableCell>
                    <TableCell className="text-right">
                      {finish.has(entry.driverId) ? `P${finish.get(entry.driverId)}` : '–'}
                    </TableCell>
                    {comparison.records.map(record => (
                      <TableCell key={seriesKey(record)} className="text-right">
                        {percent(record.probabilities[entry.driverId] ?? 0)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
