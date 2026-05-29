import type { Diagnostic, DiagnosticTarget, ProjectSource } from "@nocad/intent-core";

import { Panel, PanelHeader } from "./panel";

export function DiagnosticsPanel({ diagnostics, source }: { diagnostics: Diagnostic[]; source: ProjectSource }) {
  const labels = objectLabels(source);

  return (
    <Panel>
      <PanelHeader eyebrow="Diagnostics" title="Resolver messages" />
      <div className="grid gap-2 p-4">
        {diagnostics.length === 0 ? (
          <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            clean
          </div>
        ) : (
          diagnostics.map((diagnostic, index) => (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
              key={`${diagnostic.code}-${index}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{diagnostic.code}</span>
                <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  {diagnostic.severity}
                </span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{formatMessage(diagnostic.message, labels)}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {diagnostic.targets.map((target) => targetLabel(target, labels)).join(", ")}
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function targetLabel(target: DiagnosticTarget, labels: Map<string, string>) {
  if (target.kind === "pin") {
    return `${labels.get(target.node) ?? "Unknown"}.${target.pin}`;
  }

  return `${target.kind}:${labels.get(target.id) ?? "Unknown"}`;
}

function objectLabels(source: ProjectSource) {
  return new Map([
    ...source.nodes.map((node) => [node.id, node.label ?? node.role ?? "Node"] as const),
    ...source.edges.map((edge) => [edge.id, edge.label ?? edge.role ?? "Edge"] as const)
  ]);
}

function formatMessage(message: string, labels: Map<string, string>) {
  return [...labels.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .reduce((formatted, [id, label]) => formatted.replaceAll(id, label), message);
}
