import { hash } from '../util.js';

/**
 * Replays a provider answer that was already measured for the exact same question.
 *
 * The key covers the provider, the model and the whole evidence object, and the
 * evidence object already carries priorLessons, so editing a lesson, changing the
 * recent-race window or adding a rung all invalidate their entries by themselves.
 * There is nothing to expire by hand.
 *
 * A replayed record keeps the duration and token counts of the original call, so
 * it is marked `cached` and must never be read as a fresh measurement of latency
 * or consumption. It also freezes one sample of a non-deterministic model, which
 * makes repeated runs reproducible and hides run-to-run variance. Measure with
 * caching off.
 */
export function withPredictionCache(provider, store) {
  const keyFor = value => hash({ provider: provider.name, model: provider.model, ...value }).slice(0, 32);

  const replay = async (key, call) => {
    const cached = await store.getPrediction(key);
    if (cached) return { ...cached, metadata: { ...cached.metadata, cached: true } };
    const fresh = await call();
    await store.putPrediction(key, { ...fresh, metadata: { ...fresh.metadata, measuredAt: new Date().toISOString() } });
    return fresh;
  };

  const wrapped = {
    name: provider.name,
    model: provider.model,
    predict: (evidence, options) => replay(keyFor({ question: 'predict', evidence }), () => provider.predict(evidence, options)),
  };
  if (typeof provider.diagnose === 'function') {
    wrapped.diagnose = (review, criteria) => replay(keyFor({ question: 'diagnose', review, criteria }), () => provider.diagnose(review, criteria));
  }
  return wrapped;
}
