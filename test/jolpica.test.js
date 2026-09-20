import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeJolpicaPages, normalizeNextRace } from '../src/jolpica.js';

function page(results, total = results.length) {
  return { MRData: { total: String(total), RaceTable: { Races: [{
    season: '2025', round: '1', raceName: 'Test GP', date: '2025-03-01', time: '14:00:00Z',
    Circuit: { circuitId: 'test', circuitName: 'Test Circuit', Location: { country: 'Testland' } },
    Results: results.map((id, index) => ({
      position: String(index + 1), grid: String(index + 2), points: index ? '18' : '25', laps: '55', status: 'Finished',
      Driver: { driverId: id, givenName: id.toUpperCase(), familyName: 'Driver' },
      Constructor: { constructorId: `team-${id}`, name: `Team ${id}` },
    })),
  }] } } };
}

test('Jolpica pages merge results for the same race', () => {
  const races = mergeJolpicaPages([page(['a'], 2), page(['b'], 2)]);
  assert.equal(races.length, 1);
  assert.deepEqual(races[0].entrants.map(row => row.driverId), ['a', 'b']);
  assert.equal(races[0].results[0].finishPosition, 1);
});

test('next race adapter excludes results and entrants', () => {
  const next = normalizeNextRace(page([]));
  assert.equal(next.id, '2025-1');
  assert.deepEqual(next.results, []);
  assert.deepEqual(next.entrants, []);
});
