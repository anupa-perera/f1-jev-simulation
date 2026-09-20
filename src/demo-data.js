function entrant(driverId, name, constructorId, constructorName) {
  return { driverId, name, constructorId, constructorName };
}

const field = [
  entrant('atlas', 'Alex Atlas', 'orion', 'Orion GP'),
  entrant('blake', 'Bailey Blake', 'nova', 'Nova Racing'),
  entrant('chen', 'Casey Chen', 'vertex', 'Vertex Motorsport'),
  entrant('diaz', 'Drew Diaz', 'orion', 'Orion GP'),
];

function race(round, circuit, order) {
  const startsAt = `2025-0${round}-0${round}T14:00:00.000Z`;
  const results = order.map((driverId, index) => {
    const driver = field.find(row => row.driverId === driverId);
    return { ...driver, finishPosition: index + 1, grid: ((index + round) % 4) + 1, points: [25, 18, 15, 12][index], laps: 57, status: 'Finished' };
  });
  return {
    id: `2025-${round}`, season: 2025, round, name: `Demo Grand Prix ${round}`,
    startsAt, circuit: { id: circuit, name: `Circuit ${circuit.toUpperCase()}`, country: 'Demo' },
    entrants: field, results,
  };
}

export function demoRaces() {
  return [
    race(1, 'alpha', ['atlas', 'blake', 'chen', 'diaz']),
    race(2, 'beta', ['blake', 'atlas', 'diaz', 'chen']),
    race(3, 'alpha', ['atlas', 'chen', 'blake', 'diaz']),
    race(4, 'gamma', ['chen', 'atlas', 'blake', 'diaz']),
  ];
}
