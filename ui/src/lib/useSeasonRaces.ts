import { useEffect, useState } from 'react';

export type SeasonRace = {
  round: number;
  name: string;
  circuit: string | null;
  startsAt: string;
  hasResult: boolean;
};

export type SeasonState = {
  races: SeasonRace[];
  /** True once a request for this year has settled, either way. */
  settled: boolean;
  /** Set when the season simply is not in the local cache yet. */
  uncollected: boolean;
};

const empty: SeasonState = { races: [], settled: false, uncollected: false };

/** Loads round names for one season from the local cache so the comparison form
 *  can name each round. `enabled` is false outside historical mode, and the
 *  year is range-checked first, so typing "2" then "20" then "202" on the way to
 *  "2025" issues no requests at all — no debounce needed for a local read. */
export function useSeasonRaces(year: number, enabled: boolean): SeasonState {
  const [state, setState] = useState<SeasonState>(empty);
  const valid = enabled && Number.isInteger(year) && year >= 1950 && year <= 2100;

  useEffect(() => {
    if (!valid) {
      setState(empty);
      return;
    }
    // A slower earlier response must not overwrite a newer year's races.
    let current = true;
    setState(empty);
    (async () => {
      try {
        const response = await fetch(`/api/seasons/${year}`, { cache: 'no-store' });
        if (!current) return;
        if (response.status === 404) {
          setState({ races: [], settled: true, uncollected: true });
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { races: SeasonRace[] };
        if (current) setState({ races: body.races, settled: true, uncollected: false });
      } catch {
        // A failed lookup is not an error the user must act on: the form just
        // falls back to entering the round number directly.
        if (current) setState({ races: [], settled: true, uncollected: false });
      }
    })();
    return () => {
      current = false;
    };
  }, [year, valid]);

  return state;
}
