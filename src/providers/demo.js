import { normalizeDistribution } from '../util.js';

function softmax(values) {
  const maximum = Math.max(...values);
  const weights = values.map(value => Math.exp(value - maximum));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(value => value / total);
}

function strength(driver) {
  const summary = driver.historySummary;
  const average = summary.averageFinish ?? 12;
  const circuit = summary.circuitAverageFinish ?? average;
  const recent = driver.recentRaces.slice(-5).map(run => run.finishPosition ?? 20);
  const recentAverage = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : average;
  return -0.5 * average - 0.3 * recentAverage - 0.2 * circuit;
}

export class DemoProvider {
  constructor(name, bias = 0) {
    this.name = name;
    this.model = `simulated-${name}-v1`;
    this.bias = bias;
  }
  async predict(evidence) {
    const weights = softmax(evidence.field.map((driver, index) => strength(driver) + (index === this.bias ? 0.15 : 0)));
    const raw = Object.fromEntries(evidence.field.map((driver, index) => [driver.driverId, weights[index]]));
    const inputTokens = Math.ceil(JSON.stringify(evidence).length / 4);
    return {
      provider: this.name,
      model: this.model,
      probabilities: normalizeDistribution(raw, evidence.field.map(driver => driver.driverId)),
      durationMs: this.name === 'demo-jev' ? 18 : 55,
      usage: { inputTokens, cachedInputTokens: 0, outputTokens: evidence.field.length * 4, reasoningOutputTokens: 0, totalTokens: inputTokens + evidence.field.length * 4 },
      metadata: { simulated: true, priorLessonCount: evidence.priorLessons?.length ?? 0 },
    };
  }

  /** Deterministic stand-in for a model diagnosis so the rounds loop can be
   * demonstrated and tested without calling a live provider. */
  async diagnose(review, criteria) {
    const winnerId = review.actual.winnerDriverId;
    const nearMiss = review.prediction.slice(0, 3).some(entry => entry.driverId === winnerId);
    const wonRecently = review.field.find(driver => driver.driverId === winnerId)?.recentRaces.some(run => run.finish === 1);
    const cause = wonRecently ? 'underconfident_in_a_dominant_driver' : nearMiss ? 'leading_group_not_separated' : 'evidence_did_not_contain_cause';
    return {
      cause: Object.hasOwn(criteria, cause) ? cause : Object.keys(criteria)[0],
      confidence: 0.5,
      durationMs: 9,
      usage: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 0, totalTokens: 44 },
    };
  }
}
