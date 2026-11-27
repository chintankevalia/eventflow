/**
 * The title block every portal page opens with.
 *
 * It used to live inside `module-placeholder.tsx`, which made it look like
 * scaffolding for the unbuilt modules rather than the one header every page
 * shares — and four pages hand-rolled their own instead of importing it, each
 * with slightly different spacing. Its own file states what it is.
 *
 * `sm:items-end` rather than `items-center`: an action button lines up with the
 * baseline of the description, not with the middle of a two-line block.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
