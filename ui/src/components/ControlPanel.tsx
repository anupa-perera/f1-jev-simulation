import { useEffect, useState, type FormEvent } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { maxModels, modelCatalog } from '@/lib/models';
import { useSeasonRaces } from '@/lib/useSeasonRaces';
import type { ComparisonRequest } from '@/lib/useLiveRun';

const reasoningLevels = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const currentYear = new Date().getUTCFullYear();

type Props = {
  busy: boolean;
  defaults: { model: string; reasoning: string };
  onSubmit: (request: ComparisonRequest) => void;
};

export function ControlPanel({ busy, defaults, onSubmit }: Props) {
  const catalog = modelCatalog(defaults.model);
  const [mode, setMode] = useState<'next' | 'historical'>('next');
  const [season, setSeason] = useState(String(currentYear - 1));
  const [round, setRound] = useState('1');
  const [historyFrom, setHistoryFrom] = useState(String(Math.max(1950, currentYear - 4)));
  const [models, setModels] = useState<string[]>([defaults.model]);
  const [reasoning, setReasoning] = useState(defaults.reasoning);
  const [useJev, setUseJev] = useState(true);
  const [useCodex, setUseCodex] = useState(true);

  const { races, uncollected } = useSeasonRaces(Number(season), mode === 'historical');
  const selectedRace = races.find(race => String(race.round) === round);

  // A season's round count varies (2026 has 14 so far, 2025 had 24), so a round
  // carried over from the previous season can fall outside the new one. Snap to
  // a real round instead of submitting one that resolves to no race.
  useEffect(() => {
    if (!races.length || races.some(race => String(race.round) === round)) return;
    const fallback = [...races].reverse().find(race => race.hasResult) ?? races[0];
    setRound(String(fallback.round));
  }, [races, round]);

  const atLimit = models.length >= maxModels;
  const providers = [useJev && 'jev', useCodex && 'codex'].filter(Boolean) as string[];
  // The backend rejects Codex with an empty model list, so block it here too
  // rather than letting the user submit into a guaranteed 400.
  const invalid = providers.length === 0 || (useCodex && models.length === 0);

  function toggleModel(id: string, checked: boolean) {
    setModels(current => (checked ? (current.includes(id) || atLimit ? current : [...current, id]) : current.filter(value => value !== id)));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    onSubmit({
      mode,
      ...(mode === 'historical' ? { season: Number(season), round: Number(round) } : {}),
      historyFrom: Number(historyFrom),
      providers,
      models,
      reasoning,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-3xl font-black">Run a comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid content-start gap-5">
              <div className="grid gap-2">
                <Label htmlFor="mode" className="text-base font-bold">
                  Target
                </Label>
                <Select value={mode} onValueChange={value => setMode(value as 'next' | 'historical')}>
                  <SelectTrigger id="mode" className="h-11 w-full text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="next">Next scheduled race</SelectItem>
                    <SelectItem value="historical">Historical race</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === 'historical' ? (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="season" className="text-base font-bold">
                      Season
                    </Label>
                    <Input id="season" className="h-11 text-base" type="number" min={1950} max={2100} value={season} onChange={event => setSeason(event.target.value)} required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="round" className="text-base font-bold">
                      Round
                    </Label>
                    {races.length ? (
                      <Select value={round} onValueChange={setRound}>
                        <SelectTrigger id="round" className="h-11 w-full text-base">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {races.map(race => (
                            <SelectItem key={race.round} value={String(race.round)}>
                              <span className="tabular text-subtle">R{race.round}</span>
                              <span className="ml-2">{race.name}</span>
                              {race.hasResult ? null : <span className="ml-2 text-subtle">· not yet raced</span>}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input id="round" className="h-11 text-base" type="number" min={1} max={40} value={round} onChange={event => setRound(event.target.value)} required />
                    )}
                    {selectedRace && !selectedRace.hasResult ? (
                      <p className="text-sm text-destructive">This race has no result yet, so the prediction cannot be scored.</p>
                    ) : selectedRace?.circuit ? (
                      <p className="text-sm text-subtle">{selectedRace.circuit}</p>
                    ) : uncollected ? (
                      <p className="text-sm text-subtle">
                        Season {season} is not collected yet, so round names are unavailable. Enter the round number, or run{' '}
                        <code className="text-foreground">npm run collect</code>.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="historyFrom" className="text-base font-bold">
                  History begins
                </Label>
                <Input
                  id="historyFrom"
                  className="h-11 text-base"
                  type="number"
                  min={1950}
                  max={2100}
                  value={historyFrom}
                  onChange={event => setHistoryFrom(event.target.value)}
                  required
                />
                <p className="text-sm text-subtle">All collected races from this season onward feed full-history aggregates.</p>
              </div>

              <fieldset className="grid gap-3">
                <legend className="label-caption mb-2">Providers</legend>
                <div className="flex flex-wrap gap-x-8 gap-y-3">
                  <div className="flex items-center gap-2.5">
                    <Checkbox id="provider-jev" checked={useJev} onCheckedChange={value => setUseJev(value === true)} />
                    <Label htmlFor="provider-jev" className="text-base font-medium">
                      TypeSafe Jev
                    </Label>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Checkbox id="provider-codex" checked={useCodex} onCheckedChange={value => setUseCodex(value === true)} />
                    <Label htmlFor="provider-codex" className="text-base font-medium">
                      OpenAI through Codex
                    </Label>
                  </div>
                </div>
              </fieldset>
            </div>

            <div className="grid content-start gap-5">
              <fieldset className={cn('grid gap-3 transition-opacity', !useCodex && 'pointer-events-none opacity-40')}>
                <legend className="label-caption mb-2 flex w-full items-baseline justify-between gap-2">
                  <span>OpenAI models</span>
                  <span className={cn('tabular', atLimit && 'text-primary')}>
                    {models.length} of {maxModels}
                  </span>
                </legend>
                <div className="grid gap-1 rounded-md border p-2">
                  {catalog.map(model => {
                    const checked = models.includes(model.id);
                    return (
                      <label
                        key={model.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-accent',
                          !checked && atLimit && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={!checked && atLimit}
                          onCheckedChange={value => toggleModel(model.id, value === true)}
                        />
                        <span className="grid">
                          <span className="text-base font-bold">{model.name}</span>
                          <span className="font-mono text-xs text-subtle">
                            {model.id}
                            {model.note ? ` · ${model.note}` : ''}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {useCodex && models.length === 0 ? (
                  <p className="text-sm text-destructive">Select at least one model, or turn OpenAI off.</p>
                ) : null}
              </fieldset>

              <div className="grid gap-2">
                <Label htmlFor="reasoning" className="text-base font-bold">
                  OpenAI reasoning
                </Label>
                <Select value={reasoning} onValueChange={setReasoning}>
                  <SelectTrigger id="reasoning" className="h-11 w-full text-base" disabled={!useCodex}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reasoningLevels.map(level => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Disabled while a run is live: the server accepts one comparison at
              a time, so a second click would only earn a 409 after billing. */}
          <Button type="submit" size="lg" className="h-12 text-base font-bold" disabled={busy || invalid}>
            {busy ? 'Running…' : 'Run comparison'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
