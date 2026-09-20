/** Mirrors the run records written by src/compare.js. Kept read-only: the UI
 *  never recomputes a metric, it only displays what the harness stored. */

export type Target = { season: number; round: number; raceName: string };

export type Usage = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type Metrics = {
  winnerLogLoss: number;
  brier: number;
  topPickCorrect: boolean;
  rankCorrelation: number | null;
};

export type RankEntry = { driverId: string; name: string; probability: number };

export type Record_ = {
  provider: string;
  model: string;
  durationMs: number;
  usage: Usage;
  probabilities: Record<string, number>;
  ranking: RankEntry[];
  metrics: Metrics | null;
  metadata?: { simulated?: boolean } & Record<string, unknown>;
};

export type Outcome = {
  winnerDriverId: string;
  finishOrder: { driverId: string; finishPosition: number }[];
} | null;

export type Comparison = {
  id: string;
  target: Target;
  snapshotAt: string;
  evidenceHash: string;
  outcome: Outcome;
  records: Record_[];
  failures: { index: number; provider: string; model: string; message: string }[];
};

/** Aggregates stay in src/metrics.js so there is exactly one implementation.
 *  The server ships them alongside the runs; the UI only formats them. */
export type SummaryRow = {
  providerModel: string;
  races: number;
  meanWinnerLogLoss: number;
  meanBrier: number;
  topPickAccuracy: number;
  meanRankCorrelation: number;
  totalTokens: number;
  meanDurationMs: number;
};

export type RunData = {
  generatedAt: string;
  comparisons: Comparison[];
  summary: SummaryRow[];
};

declare global {
  interface Window {
    /** Present only in the exported standalone report, where there is no
     *  server to fetch from. Its presence selects the read-only view. */
    __F1_RUNS__?: RunData;
    /** Injected by the live server so the form opens on the configured model. */
    __F1_DEFAULTS__?: { model: string; reasoning: string };
  }
}
