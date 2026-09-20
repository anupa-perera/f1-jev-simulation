/** The model presets the installed Codex CLI offers in its own picker, read
 *  from codex-cli 0.144.2 rather than invented. The backend validates only the
 *  id format and caps a run at four models, so this list is an affordance, not
 *  a security boundary: a model configured through CODEX_MODEL that is missing
 *  here is merged in at render time rather than being dropped. */
export type CodexModel = { id: string; name: string; note?: string };

export const codexModels: CodexModel[] = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', note: 'Most capable' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', note: 'Deepest reasoning' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
];

/** A run may compare at most four OpenAI models (see normalizeComparisonRequest). */
export const maxModels = 4;

export function modelCatalog(configured: string): CodexModel[] {
  return codexModels.some(model => model.id === configured)
    ? codexModels
    : [{ id: configured, name: configured, note: 'From CODEX_MODEL' }, ...codexModels];
}
