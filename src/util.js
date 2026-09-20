import { createHash } from 'node:crypto';

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function isoRaceTime(race) {
  const date = race.date;
  const time = race.time || '00:00:00Z';
  const value = `${date}T${time}`;
  assert(Number.isFinite(Date.parse(value)), `Invalid race time: ${value}`);
  return new Date(value).toISOString();
}

export function finiteNumber(value, label) {
  const number = typeof value === 'number' ? value : Number(value);
  assert(Number.isFinite(number), `${label} must be a finite number.`);
  return number;
}

export function normalizeDistribution(input, ids, tolerance = 0.03) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Probability distribution must be an object.');
  assert(Object.keys(input).length === ids.length, 'Probability distribution must contain every driver exactly once.');
  const output = {};
  let total = 0;
  for (const id of ids) {
    const probability = finiteNumber(input[id], `Probability for ${id}`);
    assert(probability >= 0 && probability <= 1, `Probability for ${id} must be between zero and one.`);
    output[id] = probability;
    total += probability;
  }
  assert(Math.abs(total - 1) <= tolerance, `Probabilities sum to ${total}, outside the ${tolerance} rounding tolerance.`);
  assert(total > 0, 'Probability distribution cannot be empty.');
  for (const id of ids) output[id] /= total;
  return output;
}

export function rankedEntries(probabilities, field) {
  const names = new Map(field.map(driver => [driver.driverId, driver.name]));
  return Object.entries(probabilities)
    .map(([driverId, probability]) => ({ driverId, name: names.get(driverId) || driverId, probability }))
    .sort((a, b) => b.probability - a.probability || a.driverId.localeCompare(b.driverId));
}

export function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      options._.push(item);
      continue;
    }
    const equals = item.indexOf('=');
    if (equals !== -1) {
      options[item.slice(2, equals)] = item.slice(equals + 1);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index++;
    } else {
      options[key] = true;
    }
  }
  return options;
}

export function integerOption(value, fallback, label, min, max) {
  const parsed = value === undefined ? fallback : Number(value);
  assert(Number.isInteger(parsed) && parsed >= min && parsed <= max, `${label} must be an integer from ${min} to ${max}.`);
  return parsed;
}
