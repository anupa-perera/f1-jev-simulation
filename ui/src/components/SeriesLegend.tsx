export function Swatch({ color }: { color?: string }) {
  return <span className="inline-block size-[0.8em] shrink-0 rounded-[2px]" style={{ background: color }} />;
}

export function SeriesLegend({ colors }: { colors: Map<string, string> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
      {[...colors].map(([key, color]) => (
        <span key={key} className="flex items-center gap-2">
          <Swatch color={color} />
          {key}
        </span>
      ))}
    </div>
  );
}
