import { getComponentPinOptions, getI2cPinPairOptions } from "@nocad/intent-core";
import type { ComponentPinOption } from "@nocad/intent-core";
import type {
  IntentConnectionEdge,
  IntentExposesEdge,
  IntentProvidesEdge,
  ProjectSource,
  ResolvedProject
} from "@nocad/intent-core";

import { cn } from "../../lib/utils";
import { Panel, PanelHeader } from "./panel";

type PinPair = {
  sda: string;
  scl: string;
};

type SelectableIntentEdge = IntentConnectionEdge | IntentExposesEdge | IntentProvidesEdge;
type ProviderModeOption = {
  label: string;
  value: string;
};
type ProviderSignal = {
  id: string;
  label: string;
};
type MappingSource = "auto" | "mode" | "unassigned" | "user";

const defaultProviderModes: ProviderModeOption[] = [
  { label: "Auto", value: "auto" },
  { label: "Custom GPIO", value: "custom_gpio" }
];

const providerModesByComponent: Record<string, ProviderModeOption[]> = {
  "@nocad/rp2350:RP2350A": [
    { label: "Auto", value: "auto" },
    { label: "HSTX", value: "hstx" },
    { label: "PIO GPIO", value: "pio_gpio" },
    { label: "Custom GPIO", value: "custom_gpio" }
  ]
};
const tmdsSignals: ProviderSignal[] = [
  { id: "tmds2_p", label: "D2+" },
  { id: "tmds2_n", label: "D2-" },
  { id: "tmds1_p", label: "D1+" },
  { id: "tmds1_n", label: "D1-" },
  { id: "tmds0_p", label: "D0+" },
  { id: "tmds0_n", label: "D0-" },
  { id: "clock_p", label: "CLK+" },
  { id: "clock_n", label: "CLK-" }
];
const gpio12To19Preset = {
  clock_n: "gpio19",
  clock_p: "gpio18",
  tmds0_n: "gpio17",
  tmds0_p: "gpio16",
  tmds1_n: "gpio15",
  tmds1_p: "gpio14",
  tmds2_n: "gpio13",
  tmds2_p: "gpio12"
};
const derivedPinsByProviderMode: Record<string, Record<string, string>> = {
  hstx: gpio12To19Preset,
  pio_gpio: gpio12To19Preset
};

export function EdgeAssignmentPanel({
  className,
  onLockCurrent,
  onSetAuto,
  onSetManualPair,
  onSetProviderMode,
  onSetProviderPin,
  onSetProviderPinPreset,
  resolved,
  selectedEdgeId,
  source
}: {
  className?: string;
  onLockCurrent: (edgeId: string) => void;
  onSetAuto: (edgeId: string) => void;
  onSetManualPair: (edgeId: string, pair: PinPair) => void;
  onSetProviderMode: (edgeId: string, providerMode: string) => void;
  onSetProviderPin: (edgeId: string, signal: string, pin: string | undefined) => void;
  onSetProviderPinPreset: (edgeId: string, pinsBySignal: Record<string, string>) => void;
  resolved: ResolvedProject;
  selectedEdgeId: string | undefined;
  source: ProjectSource;
}) {
  const edge = selectedEdgeId ? findIntentEdge(source, selectedEdgeId) : undefined;
  const labels = nodeLabels(source);

  return (
    <Panel className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <PanelHeader eyebrow="Properties" title="Selection" />
      <div className="grid gap-4 overflow-auto p-4">
        {!selectedEdgeId ? (
          <EmptyState text="Select an edge to inspect or edit its source intent." />
        ) : !edge ? (
          <EmptyState text="The selected graph item has no editable source intent." />
        ) : edge.kind === "intent.connection" ? (
          <I2cEdgeProperties
            edge={edge}
            labels={labels}
            onLockCurrent={onLockCurrent}
            onSetAuto={onSetAuto}
            onSetManualPair={onSetManualPair}
            resolved={resolved}
            source={source}
          />
        ) : edge.kind === "intent.provides" ? (
          <ProviderEdgeProperties
            edge={edge}
            labels={labels}
            modes={providerModesForEdge(source, edge)}
            onSetProviderPin={onSetProviderPin}
            onSetProviderPinPreset={onSetProviderPinPreset}
            onSetProviderMode={onSetProviderMode}
            pinOptions={getComponentPinOptions(source, edge.from.node, "gpio")}
            signals={providerSignalsForEdge(source, edge)}
          />
        ) : (
          <ExposesEdgeProperties edge={edge} labels={labels} />
        )}
      </div>
    </Panel>
  );
}

function I2cEdgeProperties({
  edge,
  labels,
  onLockCurrent,
  onSetAuto,
  onSetManualPair,
  resolved,
  source
}: {
  edge: IntentConnectionEdge;
  labels: Map<string, string>;
  onLockCurrent: (edgeId: string) => void;
  onSetAuto: (edgeId: string) => void;
  onSetManualPair: (edgeId: string, pair: PinPair) => void;
  resolved: ResolvedProject;
  source: ProjectSource;
}) {
  const choice = resolved.resolvedChoices.find((resolvedChoice) => resolvedChoice.sourceEdge === edge.id);
  const options = getI2cPinPairOptions(source, edge.id);
  const sourcePair = bindingPair(edge.bindings);
  const resolvedPair = bindingPair(choice?.selected.bindings);
  const selectedPair = sourcePair ?? resolvedPair;
  const mode = edge.strategy?.pinAssignment === "manual" ? "manual" : "auto";

  return (
    <>
      <EdgeHeading edge={edge} labels={labels} />

      <div className="grid grid-cols-2 rounded-md border border-border p-1">
        <button className={modeButtonClass(mode === "auto")} onClick={() => onSetAuto(edge.id)} type="button">
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
        <Field label="Resolved pins" value={pairLabel(resolvedPair)} />
        <Field label="Source override" value={sourcePair ? pairLabel(sourcePair) : "none"} />
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
  );
}

function ProviderEdgeProperties({
  edge,
  labels,
  modes,
  onSetProviderMode,
  onSetProviderPin,
  onSetProviderPinPreset,
  pinOptions,
  signals
}: {
  edge: IntentProvidesEdge;
  labels: Map<string, string>;
  modes: ProviderModeOption[];
  onSetProviderMode: (edgeId: string, providerMode: string) => void;
  onSetProviderPin: (edgeId: string, signal: string, pin: string | undefined) => void;
  onSetProviderPinPreset: (edgeId: string, pinsBySignal: Record<string, string>) => void;
  pinOptions: ComponentPinOption[];
  signals: ProviderSignal[];
}) {
  const mode = edge.strategy?.providerMode ?? "auto";

  return (
    <>
      <EdgeHeading edge={edge} labels={labels} />

      <div className="grid grid-cols-2 rounded-md border border-border p-1">
        {modes.map((providerMode) => (
          <button
            className={modeButtonClass(mode === providerMode.value)}
            key={providerMode.value}
            onClick={() => onSetProviderMode(edge.id, providerMode.value)}
            type="button"
          >
            {providerMode.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
        <Field label="Contract" value={edge.contract} />
        <Field label="Provider port" value={edge.from.port ?? "auto"} />
        <Field label="Function port" value={edge.to.port ?? "source"} />
      </div>

      <SignalMapping
        edge={edge}
        mode={mode}
        onSetProviderPin={onSetProviderPin}
        onSetProviderPinPreset={onSetProviderPinPreset}
        pinOptions={pinOptions}
        signals={signals}
      />
    </>
  );
}

function SignalMapping({
  edge,
  mode,
  onSetProviderPin,
  onSetProviderPinPreset,
  pinOptions,
  signals
}: {
  edge: IntentProvidesEdge;
  mode: string;
  onSetProviderPin: (edgeId: string, signal: string, pin: string | undefined) => void;
  onSetProviderPinPreset: (edgeId: string, pinsBySignal: Record<string, string>) => void;
  pinOptions: ComponentPinOption[];
  signals: ProviderSignal[];
}) {
  const derivedPins = derivedPinsByProviderMode[mode] ?? {};
  const selectedPins = new Set(
    [
      ...Object.values(derivedPins),
      ...signals.flatMap((signal) => {
        const pin = edge.bindings?.[signal.id]?.from?.pin;

        return pin ? [pin] : [];
      })
    ]
  );

  return (
    <div className="grid gap-3 rounded-md border border-border bg-background px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Signal mapping</span>
        {mode === "custom_gpio" ? (
          <button
            className="h-8 rounded-md border border-border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!presetFitsOptions(gpio12To19Preset, pinOptions)}
            onClick={() => onSetProviderPinPreset(edge.id, gpio12To19Preset)}
            type="button"
          >
            Fill GPIO12-19
          </button>
        ) : null}
      </div>

      <div className="grid gap-2">
        {signals.map((signal) => {
          const sourcePin = edge.bindings?.[signal.id]?.from?.pin;
          const derivedPin = derivedPins[signal.id];
          const selectedPin = sourcePin ?? "";
          const visiblePin = sourcePin ?? derivedPin;
          const source = mappingSource({ derivedPin, mode, signal: signal.id, sourcePin });
          const editable = mode === "custom_gpio" || !isTmdsSignal(signal.id);

          return (
            <label className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 text-sm" key={signal.id}>
              <span className="font-mono text-xs text-muted-foreground">{signal.label}</span>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                {editable ? (
                  <select
                    className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={pinOptions.length === 0}
                    onChange={(event) => onSetProviderPin(edge.id, signal.id, event.target.value || undefined)}
                    value={selectedPin}
                  >
                    <option value="">{derivedPin ? `${pinLabel(derivedPin)} (mode)` : "Unassigned"}</option>
                    {pinOptions.map((pin) => (
                      <option disabled={selectedPin !== pin.id && selectedPins.has(pin.id)} key={pin.id} value={pin.id}>
                        {pinLabel(pin.id)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex h-9 min-w-0 items-center rounded-md border border-border bg-muted px-2 font-mono text-sm text-muted-foreground">
                    {visiblePin ? pinLabel(visiblePin) : "AUTO"}
                  </div>
                )}
                <span className={mappingSourceClassName(source)}>{mappingSourceLabel(source, mode)}</span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function isTmdsSignal(signal: string) {
  return tmdsSignals.some((item) => item.id === signal);
}

function mappingSource({
  derivedPin,
  mode,
  signal,
  sourcePin
}: {
  derivedPin: string | undefined;
  mode: string;
  signal: string;
  sourcePin: string | undefined;
}): MappingSource {
  if (sourcePin) {
    return "user";
  }

  if (derivedPin) {
    return "mode";
  }

  return mode === "custom_gpio" || !isTmdsSignal(signal) ? "unassigned" : "auto";
}

function mappingSourceLabel(source: MappingSource, mode: string) {
  if (source === "mode") {
    return mode.toUpperCase();
  }

  if (source === "user") {
    return "USER";
  }

  if (source === "auto") {
    return "AUTO";
  }

  return "OPEN";
}

function mappingSourceClassName(source: MappingSource) {
  return cn(
    "inline-flex h-9 items-center justify-center rounded-md border px-2 text-[11px] font-semibold",
    source === "user" && "border-chart-1/40 bg-chart-1/10 text-foreground",
    source === "mode" && "border-chart-2/40 bg-chart-2/10 text-foreground",
    source === "auto" && "border-border bg-muted text-muted-foreground",
    source === "unassigned" && "border-border bg-background text-muted-foreground"
  );
}

function ExposesEdgeProperties({ edge, labels }: { edge: IntentExposesEdge; labels: Map<string, string> }) {
  return (
    <>
      <EdgeHeading edge={edge} labels={labels} />

      <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
        <Field label="Contract" value={edge.contract} />
        <Field label="Function port" value={edge.from.port ?? "connector"} />
        <Field label="Connector port" value={edge.to.port ?? "connector"} />
      </div>
    </>
  );
}

function EdgeHeading({ edge, labels }: { edge: SelectableIntentEdge; labels: Map<string, string> }) {
  return (
    <div className="grid gap-1">
      <div className="text-sm font-semibold">{edge.label ?? edge.role ?? "Intent edge"}</div>
      <div className="text-xs text-muted-foreground">
        {labels.get(edge.from.node) ?? "Unknown"} {"->"} {labels.get(edge.to.node) ?? "Unknown"}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="shrink-0 text-sm font-medium">{label}</span>
      <span className="min-w-0 break-all text-right font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">{text}</div>;
}

function modeButtonClass(active: boolean) {
  return cn(
    "min-h-8 rounded-sm px-2 py-1 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
    active ? "bg-primary text-primary-foreground" : "text-muted-foreground"
  );
}

function findIntentEdge(source: ProjectSource, edgeId: string): SelectableIntentEdge | undefined {
  return source.edges.find(
    (edge): edge is SelectableIntentEdge =>
      edge.id === edgeId &&
      (edge.kind === "intent.connection" || edge.kind === "intent.exposes" || edge.kind === "intent.provides")
  );
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

function providerModesForEdge(source: ProjectSource, edge: IntentProvidesEdge) {
  const providerNode = source.nodes.find((node) => node.id === edge.from.node);

  if (providerNode?.kind !== "component") {
    return defaultProviderModes;
  }

  return providerModesByComponent[providerNode.component] ?? defaultProviderModes;
}

function providerSignalsForEdge(source: ProjectSource, edge: IntentProvidesEdge): ProviderSignal[] {
  const functionNode = source.nodes.find((node) => node.id === edge.to.node);

  if (functionNode?.kind !== "intent.function") {
    return tmdsSignals;
  }

  const signals = [...tmdsSignals];

  if (functionNode.include?.ddc) {
    signals.push({ id: "ddc_sda", label: "SDA" }, { id: "ddc_scl", label: "SCL" });
  }

  if (functionNode.include?.hpd) {
    signals.push({ id: "hpd", label: "HPD" });
  }

  if (functionNode.include?.cec) {
    signals.push({ id: "cec", label: "CEC" });
  }

  return signals;
}

function presetFitsOptions(preset: Record<string, string>, pinOptions: ComponentPinOption[]) {
  const availablePins = new Set(pinOptions.map((pin) => pin.id));

  return Object.values(preset).every((pin) => availablePins.has(pin));
}
