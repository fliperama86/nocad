import type { GeneratedObject, ProjectSource, ResolvedProject } from "@nocad/intent-core";

import { Panel, PanelHeader } from "./panel";

export function ResolutionPanel({
  resolved,
  source
}: {
  resolved: ResolvedProject;
  source: ProjectSource;
}) {
  const componentCount = source.nodes.filter((node) => node.kind === "component").length;
  const intentEdgeCount = source.edges.filter((edge) => edge.kind.startsWith("intent.")).length;
  const dependencyCount = Object.keys(resolved.dependencies).length;
  const labels = objectLabels(source, resolved);

  return (
    <Panel>
      <PanelHeader eyebrow="Resolution" title="Compiled output" />
      <div className="grid gap-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="components" value={componentCount} />
          <Metric label="intent edges" value={intentEdgeCount} />
          <Metric label="packages" value={dependencyCount} />
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Generated objects</h2>
          <div className="grid gap-2">
            {resolved.generated.length > 0 ? (
              resolved.generated.map((item) => <GeneratedRow item={item} key={item.id} labels={labels} />)
            ) : (
              <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                none
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function GeneratedRow({ item, labels }: { item: GeneratedObject; labels: Map<string, string> }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{itemLabel(item)}</span>
        <span className="text-xs text-muted-foreground">{item.value}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {item.connects.map((connect) => labels.get(connect) ?? connect).join(" -> ")}
      </div>
    </div>
  );
}

function itemLabel(item: GeneratedObject) {
  if (item.sourceMap.feature === "pullups" && item.sourceMap.signal === "sda") {
    return "SDA pullup";
  }

  if (item.sourceMap.feature === "pullups" && item.sourceMap.signal === "scl") {
    return "SCL pullup";
  }

  return item.component.split(":").pop() ?? item.component;
}

function objectLabels(source: ProjectSource, resolved: ResolvedProject) {
  return new Map([
    ...source.nodes.map((node) => [node.id, node.label ?? node.role ?? "Node"] as const),
    ...resolved.nets.map((net) => [net.id, net.name] as const)
  ]);
}
