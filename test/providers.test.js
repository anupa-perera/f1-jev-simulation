import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { JevProvider } from '../src/providers/jev.js';
import { CodexProvider, codexActivityReader, parseCodexJsonl } from '../src/providers/codex.js';

const evidence = {
  schemaVersion: 1,
  snapshotAt: '2025-01-01T00:00:00.000Z',
  target: { raceId: 'x', season: 2025, round: 1, raceName: 'Test', startsAt: '2025-01-02T00:00:00.000Z', circuitId: 'c', circuitName: 'C', country: 'X' },
  field: [
    { slotId: 'driver_0', driverId: 'a', name: 'A', constructorName: 'One', historySummary: {}, recentRaces: [] },
    { slotId: 'driver_1', driverId: 'b', name: 'B', constructorName: 'Two', historySummary: {}, recentRaces: [] },
  ],
  evidenceRules: [],
};

test('Jev provider maps slot probabilities and usage to driver ids', async () => {
  const fetchImpl = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.deepEqual(Object.keys(body.questions.winner.criteria), ['driver_0', 'driver_1']);
    return new Response(JSON.stringify({
      model: 'jev-1.13.0',
      answers: { winner: { type: 'choice', choice: 'driver_0', confidence: 0.6, probabilities: { driver_0: 0.7, driver_1: 0.3 } } },
      usage: { input_tokens: 120, output_tokens: 14 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await new JevProvider({ apiKey: 'test', fetchImpl }).predict(evidence);
  assert.deepEqual(result.probabilities, { a: 0.7, b: 0.3 });
  assert.equal(result.usage.totalTokens, 134);
  assert.ok(result.durationMs >= 0);
});

test('Codex JSONL parser extracts final usage', () => {
  const output = [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"predictions":[]}' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 5 } }),
  ].join('\n');
  const result = parseCodexJsonl(output);
  assert.equal(result.usage.cached_input_tokens, 80);
  assert.equal(result.agentText, '{"predictions":[]}');
});

test('Codex provider validates structured probabilities and token accounting', async () => {
  const runner = async ({ args }) => {
    const outputPath = args[args.indexOf('--output-last-message') + 1];
    await writeFile(outputPath, JSON.stringify({ predictions: [
      { driverId: 'a', winProbability: 0.6 }, { driverId: 'b', winProbability: 0.4 },
    ] }));
    return { stdout: [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 200, cached_input_tokens: 150, output_tokens: 30, reasoning_output_tokens: 10 } }),
    ].join('\n'), stderr: '' };
  };
  const result = await new CodexProvider({ model: 'gpt-test', runner }).predict(evidence);
  assert.deepEqual(result.probabilities, { a: 0.6, b: 0.4 });
  assert.deepEqual(result.usage, { inputTokens: 200, cachedInputTokens: 150, outputTokens: 30, reasoningOutputTokens: 10, totalTokens: 230 });
});

test('Codex activity reader reports phase and a streamed-text estimate, never a provider count', () => {
  const ticks = [];
  let clock = 0;
  const read = codexActivityReader(tick => ticks.push(tick), { now: () => (clock += 200) });
  read(JSON.stringify({ type: 'turn.started' }));
  read(JSON.stringify({ type: 'item.updated', item: { id: 'i1', type: 'reasoning', text: 'x'.repeat(40) } }));
  // An update to the same item replaces its contribution instead of adding to it.
  read(JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'reasoning', text: 'x'.repeat(80) } }));
  read(JSON.stringify({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'y'.repeat(20) } }));
  assert.deepEqual(ticks.map(tick => tick.phase), ['thinking', 'reasoning', 'reasoning', 'writing answer']);
  assert.deepEqual(ticks.map(tick => tick.streamedChars), [0, 40, 80, 100]);
  assert.equal(ticks.at(-1).estimatedOutputTokens, 25);
});

test('Codex activity reader throttles ticks and ignores non-JSON lines', () => {
  const ticks = [];
  let clock = 0;
  const read = codexActivityReader(tick => ticks.push(tick), { intervalMs: 100, now: () => clock });
  read('not json at all');
  clock = 1_000;
  read(JSON.stringify({ type: 'item.updated', item: { id: 'i1', type: 'reasoning', text: 'x' } }));
  clock = 1_050;
  read(JSON.stringify({ type: 'item.updated', item: { id: 'i1', type: 'reasoning', text: 'xx' } }));
  clock = 1_200;
  read(JSON.stringify({ type: 'item.updated', item: { id: 'i1', type: 'reasoning', text: 'xxx' } }));
  assert.deepEqual(ticks.map(tick => tick.streamedChars), [1, 3]);
});

test('Codex provider streams stdout lines to the activity channel as they arrive', async () => {
  const lines = [
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'z'.repeat(400) } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 4, reasoning_output_tokens: 0 } }),
  ];
  const runner = async ({ args, onLine }) => {
    const outputPath = args[args.indexOf('--output-last-message') + 1];
    await writeFile(outputPath, JSON.stringify({ predictions: [
      { driverId: 'a', winProbability: 0.5 }, { driverId: 'b', winProbability: 0.5 },
    ] }));
    // Arrives split mid-line, exactly as a pipe delivers it.
    const raw = `${lines.join('\n')}\n`;
    onLine === undefined || raw.split(/(?<=\n)/).forEach(chunk => chunk.trim() && onLine(chunk.trim()));
    return { stdout: raw, stderr: '' };
  };
  const ticks = [];
  const result = await new CodexProvider({ model: 'gpt-test', runner }).predict(evidence, { onActivity: tick => ticks.push(tick) });
  assert.ok(ticks.length > 0, 'expected live activity before completion');
  assert.equal(ticks.at(-1).phase, 'writing answer');
  // The stored usage is the provider's own count, never the streamed estimate.
  assert.equal(result.usage.outputTokens, 4);
});
