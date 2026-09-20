import { cn } from 'cn';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { integer, percent } from '@/lib/format';
import type { SummaryRow } from '@/lib/types';

type Column = {
  key: keyof SummaryRow;
  label: string;
  render: (row: SummaryRow) => string;
  lowerIsBetter?: boolean;
  comparable?: boolean;
};

const columns: Column[] = [
  { key: 'races', label: 'Races', render: row => String(row.races), comparable: false },
  { key: 'meanWinnerLogLoss', label: 'Log loss ↓', render: row => row.meanWinnerLogLoss.toFixed(4), lowerIsBetter: true },
  { key: 'meanBrier', label: 'Brier ↓', render: row => row.meanBrier.toFixed(4), lowerIsBetter: true },
  { key: 'topPickAccuracy', label: 'Top pick ↑', render: row => percent(row.topPickAccuracy) },
  { key: 'meanRankCorrelation', label: 'Rank ρ ↑', render: row => row.meanRankCorrelation.toFixed(3) },
  { key: 'totalTokens', label: 'Tokens', render: row => integer(row.totalTokens), lowerIsBetter: true },
  { key: 'meanDurationMs', label: 'Mean ms', render: row => integer(row.meanDurationMs), lowerIsBetter: true },
];

/** A single-entrant column has no winner, and neither does a tie, so both are
 *  left unmarked rather than crowning whichever row happens to sort first. */
function bestValues(rows: SummaryRow[]) {
  const best = new Map<string, number>();
  for (const column of columns) {
    if (column.comparable === false) continue;
    const values = rows.map(row => row[column.key] as number);
    if (new Set(values).size < 2) continue;
    best.set(column.key, column.lowerIsBetter ? Math.min(...values) : Math.max(...values));
  }
  return best;
}

export function Scoreboard({ rows }: { rows: SummaryRow[] }) {
  const best = bestValues(rows);
  return (
    <section>
      <h2 className="mb-4 text-2xl font-bold">Scoreboard</h2>
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="label-caption text-left">Provider / model</TableHead>
              {columns.map(column => (
                <TableHead key={column.key} className="label-caption text-right">
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.providerModel}>
                <TableCell className="whitespace-nowrap font-medium">{row.providerModel}</TableCell>
                {columns.map(column => {
                  const isBest = best.get(column.key) === row[column.key];
                  return (
                    <TableCell key={column.key} className={cn('text-right whitespace-nowrap', isBest && 'font-bold text-nf-green')}>
                      {column.render(row)}
                      {isBest ? <span className="ml-1 text-[0.6em] align-middle">◆</span> : null}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
