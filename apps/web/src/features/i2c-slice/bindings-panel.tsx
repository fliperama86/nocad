import type { EndpointRef, ProjectSource, ResolvedProject } from "@nocad/intent-core";

import { Panel, PanelHeader } from "./panel";

type SelectedChoice = ResolvedProject["resolvedChoices"][number] | undefined;

export function BindingsPanel({
  nets,
  selectedChoice,
  source
}: {
  nets: ResolvedProject["nets"];
  selectedChoice: SelectedChoice;
  source: ProjectSource;
}) {
  const bindings = selectedChoice?.selected.bindings;
  const labels = nodeLabels(source);

  return (
    <Panel>
      <PanelHeader eyebrow="Resolved" title="Bindings and nets" />
      <div className="grid gap-3 p-4">
        {bindings ? (
          Object.entries(bindings).map(([signal, binding]) => (
            <div className="rounded-md border border-border bg-background px-3 py-3" key={signal}>
              <div className="mb-2 text-sm font-semibold">{signal.toUpperCase()}</div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <BindingEndpoint endpoint={binding.from} label="from" labels={labels} />
                <BindingEndpoint endpoint={binding.to} label="to" labels={labels} />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            unresolved
          </div>
        )}

        <div className="grid gap-2 pt-1">
          {nets.map((net) => (
            <div
              className="flex items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-2"
              key={net.id}
            >
              <span className="text-sm font-medium">{net.name}</span>
              <span className="text-xs text-muted-foreground">{net.sourceMap.signal}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function BindingEndpoint({
  endpoint,
  label,
  labels
}: {
  endpoint?: EndpointRef;
  label: string;
  labels: Map<string, string>;
}) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{endpoint ? endpointLabel(endpoint, labels) : "unassigned"}</div>
    </div>
  );
}

function endpointLabel(endpoint: EndpointRef, labels: Map<string, string>) {
  return `${labels.get(endpoint.node) ?? "Unknown"}.${endpoint.pin ?? endpoint.port ?? "?"}`;
}

function nodeLabels(source: ProjectSource) {
  return new Map(source.nodes.map((node) => [node.id, node.label ?? node.role ?? "Node"]));
}
