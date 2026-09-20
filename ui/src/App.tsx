import { useState } from 'react';
import { cn } from 'cn';
import { ControlPanel } from '@/components/ControlPanel';
import { Dashboard } from '@/components/Dashboard';
import { LivePanel } from '@/components/LivePanel';
import { useLiveRun, type Connection } from '@/lib/useLiveRun';
import type { RunData } from '@/lib/types';

function Wordmark({ children }: { children: string }) {
  return (
    <h1 className="text-[clamp(1.1rem,2vw,1.4rem)] leading-none font-black tracking-[-0.02em] text-primary uppercase">
      {children}
    </h1>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto grid max-w-[1400px] gap-8 px-4 pt-5 pb-16">{children}</main>;
}

/** Only the exported report carries the disclosures now. That is the artifact
 *  that leaves this machine, so it is the one that has to stay self-describing;
 *  the live page is driven by the operator who already knows what they ran. */
function Footer({ simulated }: { simulated: boolean }) {
  return (
    <footer className="grid gap-1.5 border-t pt-5 text-sm text-subtle">
      <span>Token counts are provider-reported and units are not comparable across TypeSafe Jev and OpenAI models.</span>
      <span>
        OpenAI timing includes Codex CLI startup and authentication. Probabilities are unvalidated model outputs, not
        calibrated forecasts, and are unsuitable for betting.
      </span>
      {simulated ? <span>Some records come from simulated providers. No live model was called for those.</span> : null}
    </footer>
  );
}

const hasSimulated = (data: RunData) =>
  data.comparisons.some(comparison => comparison.records.some(record => record.metadata?.simulated));

function ConnectionDot({ connection }: { connection: Connection }) {
  return (
    <i
      title={connection === 'online' ? 'Live event stream connected' : 'Live event stream disconnected'}
      className={cn(
        'size-2.5 rounded-full bg-subtle',
        connection === 'online' && 'bg-nf-green shadow-[0_0_0.75rem_rgba(70,211,105,0.55)]',
        connection === 'error' && 'bg-destructive',
      )}
    />
  );
}

function LiveApp({ defaults }: { defaults: { model: string; reasoning: string } }) {
  const { connection, status, busy, providers, submit } = useLiveRun();
  // The form and the execution view share the full width instead of splitting
  // it: only one of them is useful at a time, and the run is what you watch.
  const [showForm, setShowForm] = useState(true);

  // The form stays up until the server has actually accepted the run. Switching
  // first stranded a rejected submit on an empty "preparing evidence" panel that
  // implied a run was under way when none had started.
  const handleSubmit = async (request: Parameters<typeof submit>[0]) => {
    if (await submit(request)) setShowForm(false);
  };

  return (
    <Shell>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b pb-3">
        <Wordmark>F1 Jev Live Bench</Wordmark>
        <span className="flex items-center gap-2.5 text-sm">
          <ConnectionDot connection={connection} />
          <strong>{status}</strong>
        </span>
      </header>

      {showForm ? (
        <ControlPanel busy={busy} defaults={defaults} onSubmit={handleSubmit} />
      ) : (
        <LivePanel providers={providers} busy={busy} onBack={() => setShowForm(true)} />
      )}

    </Shell>
  );
}

function StaticApp({ data }: { data: RunData }) {
  const providerCount = new Set(
    data.comparisons.flatMap(comparison => comparison.records.map(record => `${record.provider}:${record.model}`)),
  ).size;
  const scored = data.comparisons.filter(comparison => comparison.outcome).length;

  return (
    <Shell>
      <header>
        <Wordmark>F1 Jev Bench</Wordmark>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground">
          <span>
            <strong className="text-foreground">{data.comparisons.length}</strong> race
            {data.comparisons.length === 1 ? '' : 's'}
          </span>
          <span>
            <strong className="text-foreground">{providerCount}</strong> provider/model
            {providerCount === 1 ? '' : 's'}
          </span>
          <span>
            <strong className="text-foreground">{scored}</strong> with revealed results
          </span>
          <span>
            Generated <strong className="text-foreground">{data.generatedAt}</strong>
          </span>
        </div>
      </header>

      <Dashboard data={data} />
      <Footer simulated={hasSimulated(data)} />
    </Shell>
  );
}

/** The exported report ships its data inline and has no server behind it, so
 *  its presence is what selects the read-only view. */
export function App({ defaults }: { defaults: { model: string; reasoning: string } }) {
  const injected = window.__F1_RUNS__;
  return injected ? <StaticApp data={injected} /> : <LiveApp defaults={defaults} />;
}
