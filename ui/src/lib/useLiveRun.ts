import { useCallback, useEffect, useRef, useState } from 'react';
import type { Record_, Target } from './types';

export type Connection = 'connecting' | 'online' | 'error';

/** Mid-run progress from `provider.activity`. `estimatedOutputTokens` is a
 *  character-count estimate, never the provider's own count, so the UI must
 *  always label it as an estimate (invariant 6). */
export type Activity = { phase: string; streamedChars: number; estimatedOutputTokens: number };

/** `queued` exists so a roster panel can be on screen before its provider has
 *  started. Its clock must not run yet, or evidence-loading time would be
 *  charged to every model. */
export type ProviderState = 'queued' | 'running' | 'complete' | 'failed';

export type Roster = { index: number; provider: string; model: string }[];

export type LiveProvider = {
  index: number;
  provider: string;
  model: string;
  state: ProviderState;
  startedAt: number | null;
  activity?: Activity;
  record?: Record_;
  message?: string;
};

const isTerminal = (state: ProviderState) => state === 'complete' || state === 'failed';

const seedFromRoster = (roster: Roster): LiveProvider[] =>
  roster.map(entry => ({ ...entry, state: 'queued', startedAt: null }));

export type ComparisonRequest = {
  mode: 'next' | 'historical';
  season?: number;
  round?: number;
  historyFrom: number;
  providers: string[];
  models: string[];
  reasoning: string;
};

export function useLiveRun() {
  const [connection, setConnection] = useState<Connection>('connecting');
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<LiveProvider[]>([]);
  const activeRunId = useRef<string | null>(null);

  // Upsert by provider index, so the roster seed, the start event, the activity
  // ticks and the terminal event all fold into one card. A reconnect that
  // replays the buffered event log therefore rebuilds the list without dupes.
  const upsert = useCallback((index: number, next: Partial<LiveProvider> & Pick<LiveProvider, 'provider' | 'model' | 'state'>) => {
    setProviders(current => {
      const existing = current.find(entry => entry.index === index);
      // Activity ticks are fire-and-forget, so one can land after the provider
      // already finished. A terminal state is never walked back.
      if (existing && isTerminal(existing.state) && !isTerminal(next.state)) return current;
      const merged: LiveProvider = { startedAt: null, ...existing, ...next, index };
      return existing ? current.map(entry => (entry.index === index ? merged : entry)) : [...current, merged];
    });
  }, []);

  useEffect(() => {
    const events = new EventSource('/api/events');
    const on = (name: string, handler: (payload: any) => void) =>
      events.addEventListener(name, message => handler(JSON.parse((message as MessageEvent).data)));

    events.onopen = () => setConnection('online');
    events.onerror = () => setConnection('error');

    on('connected', event => {
      if (event.activeRun) {
        activeRunId.current = event.activeRun.runId;
        setBusy(true);
        // Seed from the roster first; the replayed event log then upgrades each
        // panel to whatever state it had reached before this client connected.
        if (event.activeRun.roster) setProviders(seedFromRoster(event.activeRun.roster));
        setStatus('Reconnected to active comparison');
      } else if (event.lastRun?.status === 'failed') {
        setStatus(`Last run failed: ${event.lastRun.message}`);
      } else if (event.lastRun?.status === 'completed') {
        setStatus('Ready · last comparison saved');
      }
    });

    // The roster is known before evidence is loaded, so every model gets a panel
    // up front rather than popping in one at a time as providers start.
    on('run.accepted', event => {
      activeRunId.current = event.runId;
      setBusy(true);
      setProviders(seedFromRoster(event.roster));
    });

    on('run.started', event => {
      activeRunId.current = event.runId;
      const target = event.target as Target;
      setStatus(`Running ${target.raceName} · ${target.season} round ${target.round}`);
    });

    on('run.progress', event => {
      if (event.runId === activeRunId.current) setStatus(event.message);
    });

    on('provider.started', event =>
      upsert(event.index, { provider: event.provider, model: event.model, state: 'running', startedAt: Date.now() }),
    );

    on('provider.activity', event =>
      upsert(event.index, {
        provider: event.provider,
        model: event.model,
        state: 'running',
        activity: { phase: event.phase, streamedChars: event.streamedChars, estimatedOutputTokens: event.estimatedOutputTokens },
      }),
    );

    on('provider.completed', event =>
      upsert(event.index, {
        provider: event.record.provider,
        model: event.record.model,
        state: 'complete',
        record: event.record,
      }),
    );

    on('provider.failed', event =>
      upsert(event.index, { provider: event.provider, model: event.model, state: 'failed', message: event.message }),
    );

    on('run.completed', event => {
      setStatus(`Comparison saved · ${event.successfulProviders} provider result(s)`);
      setBusy(false);
      activeRunId.current = null;
    });

    on('run.failed', event => {
      setStatus(`Run failed: ${event.message}`);
      setBusy(false);
      activeRunId.current = null;
    });

    return () => events.close();
  }, [upsert]);

  const submit = useCallback(async (request: ComparisonRequest) => {
    setBusy(true);
    setStatus('Submitting comparison…');
    // Clearing here, not on run.started, so roster-seeded panels survive.
    setProviders([]);
    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      // Status first, body second. An unreachable API server answers through the
      // dev proxy with an empty 502, and parsing that before reading the status
      // would replace the real failure with a JSON syntax error.
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? `The API server answered ${response.status}. Start it with \`npm run dashboard\`.`);
      }
      if (!body?.runId) throw new Error('The API server accepted the run but returned no run id.');
      activeRunId.current = body.runId;
      setStatus('Accepted · preparing race evidence');
      return true;
    } catch (error) {
      setStatus(`Request failed: ${(error as Error).message}`);
      setBusy(false);
      return false;
    }
  }, []);

  return { connection, status, busy, providers, submit };
}
