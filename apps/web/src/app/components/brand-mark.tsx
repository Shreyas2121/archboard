export function BrandMark() {
  return (
    <span
      className="relative grid size-7 shrink-0 grid-cols-2 grid-rows-2 gap-0.5"
      aria-hidden="true"
    >
      <span className="rounded-[3px] bg-primary" />
      <span className="rounded-[3px] border border-primary/50" />
      <span className="col-span-2 rounded-[3px] bg-foreground/85" />
    </span>
  );
}
