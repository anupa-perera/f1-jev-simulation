import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { integer, percent } from '@/lib/format';
import type { LiveProvider } from '@/lib/useLiveRun';

const accent = {
  queued: 'border-l-subtle',
  running: 'border-l-chart-2',
  complete: 'border-l-nf-green',
  failed: 'border-l-destructive',
} as const;

/** One interval for the whole panel rather than one per card, and it only runs
 *  while something is actually in flight. */
function useElapsedTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(value => value + 1), 100);
    return () => clearInterval(timer);
  }, [active]);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid gap-1">
      <span className="label-caption">{label}</span>
      <span className="tabular text-3xl leading-none font-black">{value}</span>
      <span className="text-xs text-subtle">{note ?? ' '}</span>
    </div>
  );
}

function ProviderPanel({ entry }: { entry: LiveProvider }) {
  const running = entry.state === 'running';

  // A queued panel shows a zeroed clock rather than a dash: it reads as armed
  // and waiting, which is true, instead of as missing data.
  const elapsed = entry.record
    ? `${(entry.record.durationMs / 1000).toFixed(1)}s`
    : running && entry.startedAt !== null
      ? `${((Date.now() - entry.startedAt) / 1000).toFixed(1)}s`
      : entry.state === 'queued'
        ? '0.0s'
        : '—';

  // Invariant 6: only the provider's own count is ever shown unqualified. While
  // a model streams, all we have is a chars/4 estimate, so it is labelled one.
  const exact = entry.record?.usage.totalTokens;
  const tokens = exact !== undefined ? integer(exact) : running && entry.activity ? `~${integer(entry.activity.estimatedOutputTokens)}` : '—';
  const tokenNote = exact !== undefined ? 'provider-reported total' : running && entry.activity ? 'estimated output, not final' : undefined;

  return (
    <article className={cn('grid content-start gap-4 border-l-4 bg-background px-5 py-4', accent[entry.state])}>
      <header className="grid gap-1">
        <div className="flex items-start justify-between gap-3">
          <strong className="text-lg leading-tight font-black break-words">{entry.model}</strong>
          {entry.state === 'queued' ? <Badge variant="secondary">queued</Badge> : null}
          {entry.state === 'running' ? <Badge className="bg-chart-2">running</Badge> : null}
          {entry.state === 'complete' ? <Badge className="bg-nf-green text-black">done</Badge> : null}
          {entry.state === 'failed' ? <Badge variant="destructive">failed</Badge> : null}
        </div>
        <span className="text-sm font-medium text-muted-foreground">{entry.provider}</span>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Elapsed" value={elapsed} />
        <Stat label="Tokens" value={tokens} note={tokenNote} />
      </div>

      {entry.state === 'queued' ? <p className="text-base text-muted-foreground">Waiting for race evidence…</p> : null}

      {running ? (
        <p className="text-base text-muted-foreground">
          {entry.activity ? <span className="font-bold text-foreground">{entry.activity.phase}</span> : 'Waiting for model response…'}
        </p>
      ) : null}

      {entry.state === 'failed' ? <p className="text-base break-words text-destructive">{entry.message}</p> : null}

      {entry.record ? (
        <ol className="tabular grid gap-1.5 text-base">
          {entry.record.ranking.slice(0, 5).map((row, index) => (
            <li key={row.driverId} className="flex justify-between gap-3">
              <span className="font-medium">
                <span className="text-subtle">{index + 1}.</span> {row.name}
              </span>
              <span className="font-bold">{percent(row.probability)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

type Props = { providers: LiveProvider[]; busy: boolean; onBack: () => void };

export function LivePanel({ providers, busy, onBack }: Props) {
  useElapsedTicker(providers.some(entry => entry.state === 'running'));

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="label-caption">Live execution</span>
          <CardTitle className="text-3xl font-black">Provider results</CardTitle>
        </div>
        {/* Only offered once the run is over, so a comparison in flight cannot
            be navigated away from and silently abandoned mid-billing. */}
        <Button variant="outline" size="lg" onClick={onBack} disabled={busy}>
          <ArrowLeft />
          New comparison
        </Button>
      </CardHeader>
      <CardContent>
        {providers.length ? (
          // Four models read better as a 2x2 than as a 3+1 orphan row, so the
          // column count is chosen from the roster size rather than by auto-fit.
          <div
            className="grid grid-cols-1 gap-4 sm:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
            style={{ '--cols': providers.length === 4 ? 2 : Math.min(providers.length, 3) } as React.CSSProperties}
          >
            {[...providers]
              .sort((a, b) => a.index - b.index)
              .map(entry => (
                <ProviderPanel key={entry.index} entry={entry} />
              ))}
          </div>
        ) : (
          <div className="rounded-md bg-background p-12 text-center text-lg text-muted-foreground">
            Preparing race evidence…
          </div>
        )}
      </CardContent>
    </Card>
  );
}
