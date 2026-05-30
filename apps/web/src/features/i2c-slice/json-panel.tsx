import { cn } from "../../lib/utils";
import { Panel } from "./panel";

export type JsonView = "source" | "resolved";

export function JsonPanel({
  className,
  resolvedJson,
  selectedView,
  setSelectedView,
  sourceJson
}: {
  className?: string;
  resolvedJson: string;
  selectedView: JsonView;
  setSelectedView: (view: JsonView) => void;
  sourceJson: string;
}) {
  return (
    <Panel className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">JSON</p>
          <h2 className="text-base font-semibold">Source and resolved</h2>
        </div>
        <div className="inline-grid grid-cols-2 rounded-md border border-border p-1">
          <button
            className={tabClassName(selectedView === "source")}
            onClick={() => setSelectedView("source")}
            type="button"
          >
            Source
          </button>
          <button
            className={tabClassName(selectedView === "resolved")}
            onClick={() => setSelectedView("resolved")}
            type="button"
          >
            Resolved
          </button>
        </div>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-4 text-xs leading-relaxed text-muted-foreground">
        {selectedView === "source" ? sourceJson : resolvedJson}
      </pre>
    </Panel>
  );
}

function tabClassName(active: boolean) {
  return active
    ? "h-7 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground"
    : "h-7 rounded-sm px-3 text-xs font-medium text-muted-foreground";
}
