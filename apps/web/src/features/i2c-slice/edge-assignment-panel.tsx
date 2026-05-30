import { getI2cPinPairOptions } from "@nocad/intent-core";
import type { IntentConnectionEdge, ProjectSource, ResolvedProject } from "@nocad/intent-core";

import { cn } from "../../lib/utils";
import { Panel, PanelHeader } from "./panel";

type PinPair = {
  sda: string;
  scl: string;
};

export function EdgeAssignmentPanel({
  className,
  onLockCurrent,
  onSetAuto,
  onSetManualPair,
  resolved,
  selectedEdgeId,
  source
}: {
  className?: string;
  onLockCurrent: (edgeId: string) => void;
  onSetAuto: (edgeId: string) => void;
  onSetManualPair: (edgeId: string, pair: PinPair) => void;
  resolved: ResolvedProject;
  selectedEdgeId: string | undefined;
  source: ProjectSource;
}) {
  const edge = selectedEdgeId ? findIntentEdge(source, selectedEdgeId) : undefined;
  const labels = nodeLabels(source);
  const choice = edge ? resolved.resolvedChoices.find((resolvedChoice) => resolvedChoice.sourceEdge === edge.id) : undefined;
  const options = edge ? getI2cPinPairOptions(source, edge.id) : [];
  const sourcePair = edge ? bindingPair(edge.bindings) : undefined;
  const resolvedPair = bindingPair(choice?.selected.bindings);
  const selectedPair = sourcePair ?? resolvedPair;
  const mode = edge?.strategy?.pinAssignment === "manual" ? "manual" : "auto";

  return (
    <Panel className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <PanelHeader eyebrow="Properties" title="Selection" />
      <div className="grid gap-4 overflow-auto p-4">
        {!selectedEdgeId ? (
          <EmptyState text="Select an I2C edge to inspect or override its pin assignment." />
        ) : !edge ? (
          <EmptyState text="The selected graph item is not an editable I2C intent edge." />
        ) : (
          <>
            <div className="grid gap-1">
              <div className="text-sm font-semibold">{edge.label ?? edge.role ?? "I2C connection"}</div>
              <div className="text-xs text-muted-foreground">
                {labels.get(edge.from.node) ?? "Unknown"} {"->"} {labels.get(edge.to.node) ?? "Unknown"}
              </div>
            </div>

            <div className="grid grid-cols-2 rounded-md border border-border p-1">
              <button
                className={modeButtonClass(mode === "auto")}
                onClick={() => onSetAuto(edge.id)}
                type="button"
              >
                Auto
              </button>
              <button
                className={modeButtonClass(mode === "manual")}
                disabled={!resolvedPair}
                onClick={() => onLockCurrent(edge.id)}
                type="button"
              >
                Manual
              </button>
            </div>

            <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Resolved pins</span>
                <span className="font-mono text-xs text-muted-foreground">{pairLabel(resolvedPair)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Source override</span>
                <span className="font-mono text-xs text-muted-foreground">{sourcePair ? pairLabel(sourcePair) : "none"}</span>
              </div>
            </div>

            <label className="grid gap-2 text-sm font-medium">
              Pin pair
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={options.length === 0}
                onChange={(event) => {
                  const pair = parsePairKey(event.target.value);

                  if (pair) {
                    onSetManualPair(edge.id, pair);
                  }
                }}
                value={selectedPair ? pairKey(selectedPair) : ""}
              >
                <option disabled value="">
                  No compatible pair
                </option>
                {options.map((option) => (
                  <option key={pairKey(option)} value={pairKey(option)}>
                    {pairLabel(option)}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                className="h-8 rounded-md border border-border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!resolvedPair}
                onClick={() => onLockCurrent(edge.id)}
                type="button"
              >
                Lock current
              </button>
              <button
                className="h-8 rounded-md border border-border px-3 text-sm font-medium"
                onClick={() => onSetAuto(edge.id)}
                type="button"
              >
                Clear override
              </button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">{text}</div>;
}

function modeButtonClass(active: boolean) {
  return cn(
    "h-8 rounded-sm px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
    active ? "bg-primary text-primary-foreground" : "text-muted-foreground"
  );
}

function findIntentEdge(source: ProjectSource, edgeId: string): IntentConnectionEdge | undefined {
  return source.edges.find((edge): edge is IntentConnectionEdge => edge.id === edgeId && edge.kind === "intent.connection");
}

function bindingPair(bindings: IntentConnectionEdge["bindings"] | undefined): PinPair | undefined {
  const sda = bindings?.sda?.from?.pin;
  const scl = bindings?.scl?.from?.pin;

  return sda && scl ? { sda, scl } : undefined;
}

function pairKey(pair: PinPair) {
  return `${pair.sda}:${pair.scl}`;
}

function parsePairKey(value: string): PinPair | undefined {
  const [sda, scl] = value.split(":");

  return sda && scl ? { sda, scl } : undefined;
}

function pairLabel(pair: PinPair | undefined) {
  return pair ? `${pinLabel(pair.sda)} / ${pinLabel(pair.scl)}` : "unresolved";
}

function pinLabel(pin: string) {
  return pin.toUpperCase();
}

function nodeLabels(source: ProjectSource) {
  return new Map(source.nodes.map((node) => [node.id, node.label ?? node.role ?? "Node"]));
}
