import { components, contracts, functions, getComponentPinOptions, getI2cPinPairOptions } from "@nocad/intent-core";
import type {
  ComponentPinOption,
  ConnectionContract,
  ContractParamDefinition,
  ContractParams,
  ContractParamValue,
  ContractSignal,
  FunctionIncludeDefinition,
  FunctionIncludeFieldDefinition,
  FunctionSignalDefinition
} from "@nocad/intent-core";
import type {
  FunctionNode,
  IntentConnectionEdge,
  IntentExposesEdge,
  IntentProvidesEdge,
  ProjectNode,
  ProjectSource,
  ResolvedProject
} from "@nocad/intent-core";

import { cn } from "../../lib/utils";
import { Panel } from "./panel";

type PinPair = {
  sda: string;
  scl: string;
};

type SelectableIntentEdge = IntentConnectionEdge | IntentExposesEdge | IntentProvidesEdge;
type ProviderModeOption = {
  label: string;
  value: string;
};
type ProviderSignal = FunctionSignalDefinition;
type MappingSource = "auto" | "mode" | "unassigned" | "user";

const defaultProviderModes: ProviderModeOption[] = [
  { label: "Auto", value: "auto" },
  { label: "Custom GPIO", value: "custom_gpio" }
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
  auto: gpio12To19Preset,
  hstx: gpio12To19Preset,
  pio_gpio: gpio12To19Preset
};

export function EdgeAssignmentPanel({
  className,
  onLockCurrent,
  onApplyConnectionPreset,
  onSetAuto,
  onSetConnectionParam,
  onSetFunctionInclude,
  onSetManualPair,
  onSetProviderMode,
  onSetProviderPin,
  onSetProviderPinPreset,
  resolved,
  selectedEdgeId,
  selectedNodeId,
  source
}: {
  className?: string;
  onApplyConnectionPreset: (edgeId: string, params: ContractParams) => void;
  onLockCurrent: (edgeId: string) => void;
  onSetAuto: (edgeId: string) => void;
  onSetConnectionParam: (edgeId: string, param: string, value: ContractParamValue) => void;
  onSetFunctionInclude: (nodeId: string, feature: string, value: unknown) => void;
  onSetManualPair: (edgeId: string, pair: PinPair) => void;
  onSetProviderMode: (edgeId: string, providerMode: string) => void;
  onSetProviderPin: (edgeId: string, signal: string, pin: string | undefined) => void;
  onSetProviderPinPreset: (edgeId: string, pinsBySignal: Record<string, string>) => void;
  resolved: ResolvedProject;
  selectedEdgeId: string | undefined;
  selectedNodeId: string | undefined;
  source: ProjectSource;
}) {
  const edge = selectedEdgeId ? findIntentEdge(source, selectedEdgeId) : undefined;
  const selectedNode = !selectedEdgeId && selectedNodeId ? source.nodes.find((node) => node.id === selectedNodeId) : undefined;
  const labels = nodeLabels(source);

  return (
    <Panel className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <div className="grid gap-3 overflow-auto p-3">
        {!selectedEdgeId && !selectedNode ? (
          <EmptyState text="Select a node or edge to inspect its source intent." />
        ) : !edge ? (
          selectedNode ? (
            <NodeProperties node={selectedNode} onSetFunctionInclude={onSetFunctionInclude} />
          ) : (
            <EmptyState text="The selected graph item has no editable source intent." />
          )
        ) : edge.kind === "intent.connection" ? (
          <I2cEdgeProperties
            edge={edge}
            labels={labels}
            onApplyConnectionPreset={onApplyConnectionPreset}
            onLockCurrent={onLockCurrent}
            onSetAuto={onSetAuto}
            onSetConnectionParam={onSetConnectionParam}
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
            resolvedChoice={resolved.resolvedChoices.find((choice) => choice.sourceEdge === edge.id)}
            signals={providerSignalsForEdge(source, edge)}
            source={source}
            resolved={resolved}
          />
        ) : (
          <ExposesEdgeProperties edge={edge} labels={labels} />
        )}
      </div>
    </Panel>
  );
}

function NodeProperties({
  node,
  onSetFunctionInclude
}: {
  node: ProjectNode;
  onSetFunctionInclude: (nodeId: string, feature: string, value: unknown) => void;
}) {
  if (node.kind === "intent.function") {
    return <FunctionNodeProperties node={node} onSetFunctionInclude={onSetFunctionInclude} />;
  }

  return (
    <>
      <NodeHeading node={node} />
      <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
        <Field label="Kind" value={node.kind} />
        <Field label="Role" value={node.role ?? "none"} />
      </div>
    </>
  );
}

function FunctionNodeProperties({
  node,
  onSetFunctionInclude
}: {
  node: FunctionNode;
  onSetFunctionInclude: (nodeId: string, feature: string, value: unknown) => void;
}) {
  const definition = functions[node.function];

  return (
    <>
      <NodeHeading node={node} />

      <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
        <Field label="Function" value={node.function} />
      </div>

      {definition ? (
        <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
          <div className="text-sm font-medium">Features</div>
          {Object.entries(definition.include).map(([featureId, featureDefinition]) => (
            <IncludeControl
              definition={featureDefinition}
              featureId={featureId}
              key={featureId}
              node={node}
              onSetFunctionInclude={onSetFunctionInclude}
            />
          ))}
        </div>
      ) : (
        <EmptyState text="This function has no render schema yet." />
      )}
    </>
  );
}

function IncludeControl({
  definition,
  featureId,
  node,
  onSetFunctionInclude
}: {
  definition: FunctionIncludeDefinition;
  featureId: string;
  node: FunctionNode;
  onSetFunctionInclude: (nodeId: string, feature: string, value: unknown) => void;
}) {
  if (definition.kind === "boolean") {
    return (
      <label className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
        <span className="font-medium">{definition.label}</span>
        <input
          checked={includeBooleanValue(node, featureId, definition.default)}
          className="size-4 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={definition.readonly}
          onChange={(event) => onSetFunctionInclude(node.id, featureId, event.target.checked)}
          type="checkbox"
        />
      </label>
    );
  }

  if (definition.kind === "enum") {
    return (
      <label className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm">
        <span className="font-medium">{definition.label}</span>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          onChange={(event) => onSetFunctionInclude(node.id, featureId, event.target.value)}
          value={includeStringValue(node, featureId, definition.default ?? definition.options[0]?.value ?? "")}
        >
          {definition.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const objectValue = includeObjectValue(node, featureId);

  return (
    <div className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <div className="font-medium">{definition.label}</div>
      {Object.entries(definition.fields).map(([fieldId, fieldDefinition]) => (
        <IncludeObjectField
          definition={fieldDefinition}
          featureId={featureId}
          fieldId={fieldId}
          key={fieldId}
          node={node}
          objectValue={objectValue}
          onSetFunctionInclude={onSetFunctionInclude}
        />
      ))}
    </div>
  );
}

function IncludeObjectField({
  definition,
  featureId,
  fieldId,
  node,
  objectValue,
  onSetFunctionInclude
}: {
  definition: FunctionIncludeFieldDefinition;
  featureId: string;
  fieldId: string;
  node: FunctionNode;
  objectValue: Record<string, unknown>;
  onSetFunctionInclude: (nodeId: string, feature: string, value: unknown) => void;
}) {
  const value = includeObjectFieldValue(objectValue, fieldId, definition.default ?? "");
  const updateField = (nextValue: string) =>
    onSetFunctionInclude(node.id, featureId, {
      ...objectValue,
      [fieldId]: nextValue
    });

  if (definition.kind === "enum") {
    return (
      <label className="grid gap-1">
        <span className="text-xs font-medium text-muted-foreground">{definition.label}</span>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          onChange={(event) => updateField(event.target.value)}
          value={value}
        >
          {definition.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{definition.label}</span>
      <input
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        onChange={(event) => updateField(event.target.value)}
        type="text"
        value={value}
      />
    </label>
  );
}

function includeBooleanValue(node: FunctionNode, featureId: string, defaultValue = false) {
  const value = node.include?.[featureId];

  return typeof value === "boolean" ? value : defaultValue;
}

function includeStringValue(node: FunctionNode, featureId: string, defaultValue: string) {
  const value = node.include?.[featureId];

  return typeof value === "string" ? value : defaultValue;
}

function includeObjectValue(node: FunctionNode, featureId: string): Record<string, unknown> {
  const value = node.include?.[featureId];

  return isRecord(value) ? value : {};
}

function includeObjectFieldValue(
  objectValue: Record<string, unknown>,
  fieldId: string,
  defaultValue: string
) {
  const value = objectValue[fieldId];

  return typeof value === "string" ? value : defaultValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function I2cEdgeProperties({
  edge,
  labels,
  onApplyConnectionPreset,
  onLockCurrent,
  onSetAuto,
  onSetConnectionParam,
  onSetManualPair,
  resolved,
  source
}: {
  edge: IntentConnectionEdge;
  labels: Map<string, string>;
  onApplyConnectionPreset: (edgeId: string, params: ContractParams) => void;
  onLockCurrent: (edgeId: string) => void;
  onSetAuto: (edgeId: string) => void;
  onSetConnectionParam: (edgeId: string, param: string, value: ContractParamValue) => void;
  onSetManualPair: (edgeId: string, pair: PinPair) => void;
  resolved: ResolvedProject;
  source: ProjectSource;
}) {
  const choice = resolved.resolvedChoices.find((resolvedChoice) => resolvedChoice.sourceEdge === edge.id);

  if (edge.contract !== "builtin:i2c.v1") {
    return (
      <GenericConnectionEdgeProperties
        choice={choice}
        edge={edge}
        labels={labels}
        onApplyConnectionPreset={onApplyConnectionPreset}
        onSetConnectionParam={onSetConnectionParam}
      />
    );
  }

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

function GenericConnectionEdgeProperties({
  choice,
  edge,
  labels,
  onApplyConnectionPreset,
  onSetConnectionParam
}: {
  choice: ResolvedProject["resolvedChoices"][number] | undefined;
  edge: IntentConnectionEdge;
  labels: Map<string, string>;
  onApplyConnectionPreset: (edgeId: string, params: ContractParams) => void;
  onSetConnectionParam: (edgeId: string, param: string, value: ContractParamValue) => void;
}) {
  const bindings = Object.entries(choice?.selected.bindings ?? {});
  const contract = contracts[edge.contract];

  return (
    <>
      <EdgeHeading edge={edge} labels={labels} />

      <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
        <Field label="Contract" value={contract?.label ? `${contract.label} (${edge.contract})` : edge.contract} />
        <Field label="From port" value={edge.from.port ?? "from"} />
        <Field label="To port" value={edge.to.port ?? "to"} />
        <Field label="Resolved signals" value={bindings.length.toString()} />
      </div>

      <ContractParamsEditor
        contract={contract}
        onApplyPreset={(params) => onApplyConnectionPreset(edge.id, params)}
        onSetParam={(param, value) => onSetConnectionParam(edge.id, param, value)}
        params={edge.params}
      />

      <SignalPreview contract={contract} params={edge.params} />
    </>
  );
}

function ContractParamsEditor({
  contract,
  onApplyPreset,
  onSetParam,
  params
}: {
  contract: ConnectionContract | undefined;
  onApplyPreset: (params: ContractParams) => void;
  onSetParam: (param: string, value: ContractParamValue) => void;
  params: ContractParams | undefined;
}) {
  const paramDefinitions = Object.entries(contract?.params ?? {});

  if (!contract || paramDefinitions.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 rounded-md border border-border bg-background px-3 py-3">
      <div className="text-sm font-medium">Connection params</div>

      {contract.presets && contract.presets.length > 0 ? (
        <div className="grid gap-2">
          <div className="text-xs font-medium text-muted-foreground">Presets</div>
          <div className="flex flex-wrap gap-1.5">
            {contract.presets.map((preset) => (
              <button
                className={modeButtonClass(presetMatches(params, preset.params))}
                key={preset.value}
                onClick={() => onApplyPreset(preset.params)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2">
        {paramDefinitions.map(([paramId, definition]) => (
          <ContractParamControl
            definition={definition}
            key={paramId}
            onSetParam={onSetParam}
            params={params}
            paramId={paramId}
          />
        ))}
      </div>
    </div>
  );
}

function ContractParamControl({
  definition,
  onSetParam,
  params,
  paramId
}: {
  definition: ContractParamDefinition;
  onSetParam: (param: string, value: ContractParamValue) => void;
  params: ContractParams | undefined;
  paramId: string;
}) {
  const value = contractParamValue(params, paramId, definition);

  if (definition.kind === "boolean") {
    return (
      <label className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
        <span className="font-medium">{definition.label}</span>
        <input
          checked={Boolean(value)}
          className="size-4 accent-primary"
          onChange={(event) => onSetParam(paramId, event.target.checked)}
          type="checkbox"
        />
      </label>
    );
  }

  if (definition.kind === "enum") {
    return (
      <label className="grid gap-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">{definition.label}</span>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          onChange={(event) => onSetParam(paramId, event.target.value)}
          value={String(value)}
        >
          {definition.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (definition.options) {
    return (
      <label className="grid gap-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">{definition.label}</span>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          onChange={(event) => onSetParam(paramId, Number(event.target.value))}
          value={String(value)}
        >
          {definition.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{definition.label}</span>
      <input
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        max={definition.max}
        min={definition.min}
        onChange={(event) => onSetParam(paramId, Number(event.target.value))}
        type="number"
        value={String(value)}
      />
    </label>
  );
}

function contractParamValue(
  params: ContractParams | undefined,
  paramId: string,
  definition: ContractParamDefinition
): ContractParamValue {
  const authoredValue = params?.[paramId];

  if (authoredValue !== undefined) {
    return authoredValue;
  }

  if (definition.default !== undefined) {
    return definition.default;
  }

  if (definition.kind === "boolean") {
    return false;
  }

  if (definition.kind === "integer") {
    return definition.options?.[0]?.value ?? definition.min ?? 0;
  }

  return definition.options[0]?.value ?? "";
}

function presetMatches(currentParams: ContractParams | undefined, presetParams: ContractParams) {
  return Object.entries(presetParams).every(([paramId, value]) => currentParams?.[paramId] === value);
}

function SignalPreview({
  contract,
  params
}: {
  contract: ConnectionContract | undefined;
  params: ContractParams | undefined;
}) {
  if (!contract) {
    return null;
  }

  const signals = Object.keys(activeContractSignals(contract, mergeDefaultContractParams(contract.id, params)));

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">Active signals</div>
        <div className="font-mono text-xs text-muted-foreground">{signals.length}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {signals.map((signal) => (
          <span className="rounded-sm bg-muted px-1.5 py-1 font-mono text-[11px] text-muted-foreground" key={signal}>
            {signal}
          </span>
        ))}
      </div>
    </div>
  );
}

function mergeDefaultContractParams(contractId: string, params: ContractParams | undefined): ContractParams | undefined {
  const defaults = defaultContractParams(contracts[contractId]);
  const merged = {
    ...(defaults ?? {}),
    ...(params ?? {})
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function defaultContractParams(contract: ConnectionContract | undefined): ContractParams | undefined {
  const params = Object.fromEntries(
    Object.entries(contract?.params ?? {})
      .filter(([, definition]) => definition.default !== undefined)
      .map(([paramId, definition]) => [paramId, definition.default])
  ) as ContractParams;

  return Object.keys(params).length > 0 ? params : undefined;
}

function activeContractSignals(contract: ConnectionContract, params: ContractParams | undefined): Record<string, ContractSignal> {
  if (!contract.signalPlan) {
    return contract.signals;
  }

  const signals: Record<string, ContractSignal> = {};
  const includeSignal = (signal: string) => {
    const definition = contract.signals[signal];

    if (definition) {
      signals[signal] = definition;
    }
  };

  for (const item of contract.signalPlan) {
    if (item.kind === "fixed") {
      item.signals.forEach(includeSignal);
    } else if (item.kind === "conditional") {
      if (params?.[item.param]) {
        includeSignal(item.signal);
      }
    } else {
      const value = params?.[item.widthParam];
      const width = typeof value === "number" ? value : item.maxWidth;

      for (let index = 0; index < Math.min(width, item.maxWidth); index += 1) {
        includeSignal(`${item.prefix}${index}`);
      }
    }
  }

  return signals;
}

function ProviderEdgeProperties({
  edge,
  labels,
  modes,
  onSetProviderMode,
  onSetProviderPin,
  onSetProviderPinPreset,
  pinOptions,
  resolvedChoice,
  resolved,
  signals,
  source
}: {
  edge: IntentProvidesEdge;
  labels: Map<string, string>;
  modes: ProviderModeOption[];
  onSetProviderMode: (edgeId: string, providerMode: string) => void;
  onSetProviderPin: (edgeId: string, signal: string, pin: string | undefined) => void;
  onSetProviderPinPreset: (edgeId: string, pinsBySignal: Record<string, string>) => void;
  pinOptions: ComponentPinOption[];
  resolvedChoice: ResolvedProject["resolvedChoices"][number] | undefined;
  resolved: ResolvedProject;
  signals: ProviderSignal[];
  source: ProjectSource;
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

      <ProviderRequirements edge={edge} labels={labels} mode={mode} resolved={resolved} source={source} />

      <SignalMapping
        edge={edge}
        mode={mode}
        onSetProviderPin={onSetProviderPin}
        onSetProviderPinPreset={onSetProviderPinPreset}
        pinOptions={pinOptions}
        resolvedChoice={resolvedChoice}
        signals={signals}
      />
    </>
  );
}

function ProviderRequirements({
  edge,
  labels,
  mode,
  resolved,
  source
}: {
  edge: IntentProvidesEdge;
  labels: Map<string, string>;
  mode: string;
  resolved: ResolvedProject;
  source: ProjectSource;
}) {
  const modeDefinition = providerModeDefinitionForEdge(source, edge, mode);
  const requirements = Object.entries(modeDefinition?.requires?.ports ?? {}).filter(([, requirement]) => !requirement.optional);

  if (requirements.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
      <div className="text-sm font-medium">Provider requirements</div>
      {requirements.map(([port, requirement]) => {
        const status = providerRequirementStatus(source, resolved, edge.from.node, port, requirement.contract);

        return (
          <div className="grid gap-1 rounded-md bg-muted px-2 py-2 text-xs" key={port}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="font-mono font-medium">{port}</span>
              <span className={requirementStatusClassName(status.state)}>{requirementStatusLabel(status.state)}</span>
            </div>
            <div className="text-muted-foreground">
              needs {acceptedContractsLabel(requirement.contract)}
              {status.edge ? ` via ${status.edge.label ?? status.edge.role ?? status.edge.id}` : ""}
            </div>
            {status.edge ? (
              <div className="font-mono text-muted-foreground">
                {endpointLabel(status.edge.from, labels)} {"->"} {endpointLabel(status.edge.to, labels)}
              </div>
            ) : (
              <div className="text-muted-foreground">Drag a compatible source component to this provider to add it.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type RequirementState = "missing" | "resolved" | "unresolved";

function providerRequirementStatus(
  source: ProjectSource,
  resolved: ResolvedProject,
  nodeId: string,
  port: string,
  contract: string | string[]
) {
  const acceptedContracts = Array.isArray(contract) ? contract : [contract];
  const matchingEdge = source.edges.find(
    (candidate): candidate is IntentConnectionEdge =>
      candidate.kind === "intent.connection" &&
      acceptedContracts.includes(candidate.contract) &&
      (endpointMatchesPort(candidate.from, nodeId, port) || endpointMatchesPort(candidate.to, nodeId, port))
  );

  if (!matchingEdge) {
    return { edge: undefined, state: "missing" as RequirementState };
  }

  return {
    edge: matchingEdge,
    state: resolved.resolvedChoices.some((choice) => choice.sourceEdge === matchingEdge.id)
      ? ("resolved" as RequirementState)
      : ("unresolved" as RequirementState)
  };
}

function endpointMatchesPort(endpoint: { node?: string; port?: string }, nodeId: string, port: string) {
  return endpoint.node === nodeId && endpoint.port === port;
}

function acceptedContractsLabel(contract: string | string[]) {
  const acceptedContracts = Array.isArray(contract) ? contract : [contract];

  return acceptedContracts.map((contractId) => contracts[contractId]?.label ?? contractId).join(" or ");
}

function requirementStatusLabel(state: RequirementState) {
  if (state === "resolved") {
    return "OK";
  }

  if (state === "unresolved") {
    return "BROKEN";
  }

  return "MISSING";
}

function requirementStatusClassName(state: RequirementState) {
  return cn(
    "inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold",
    state === "resolved" && "border-chart-2/40 bg-chart-2/10 text-foreground",
    state === "unresolved" && "border-chart-4/40 bg-chart-4/10 text-foreground",
    state === "missing" && "border-border bg-background text-muted-foreground"
  );
}

function SignalMapping({
  edge,
  mode,
  onSetProviderPin,
  onSetProviderPinPreset,
  pinOptions,
  resolvedChoice,
  signals
}: {
  edge: IntentProvidesEdge;
  mode: string;
  onSetProviderPin: (edgeId: string, signal: string, pin: string | undefined) => void;
  onSetProviderPinPreset: (edgeId: string, pinsBySignal: Record<string, string>) => void;
  pinOptions: ComponentPinOption[];
  resolvedChoice: ResolvedProject["resolvedChoices"][number] | undefined;
  signals: ProviderSignal[];
}) {
  const derivedPins = derivedPinsByProviderMode[mode] ?? {};
  const selectedPins = new Set(
    [
      ...Object.values(derivedPins),
      ...Object.values(resolvedChoice?.selected.bindings ?? {}).flatMap((binding) =>
        binding.from?.pin ? [binding.from.pin] : []
      ),
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
          const resolvedPin = resolvedChoice?.selected.bindings[signal.id]?.from?.pin;
          const selectedPin = sourcePin ?? "";
          const visiblePin = sourcePin ?? derivedPin ?? resolvedPin;
          const source = mappingSource({ derivedPin, mode, pinControl: signal.pinControl, resolvedPin, sourcePin });
          const editable = mode === "custom_gpio" || signal.pinControl === "always";

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
                    <option value="">
                      {derivedPin
                        ? `${pinLabel(derivedPin)} (mode)`
                        : resolvedPin
                          ? `${pinLabel(resolvedPin)} (auto)`
                          : "Unassigned"}
                    </option>
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

function mappingSource({
  derivedPin,
  mode,
  pinControl,
  resolvedPin,
  sourcePin
}: {
  derivedPin: string | undefined;
  mode: string;
  pinControl: ProviderSignal["pinControl"];
  resolvedPin: string | undefined;
  sourcePin: string | undefined;
}): MappingSource {
  if (sourcePin) {
    return "user";
  }

  if (derivedPin) {
    return "mode";
  }

  if (resolvedPin) {
    return "auto";
  }

  return mode === "custom_gpio" || pinControl === "always" ? "unassigned" : "auto";
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

function NodeHeading({ node }: { node: ProjectNode }) {
  return (
    <div className="grid gap-1">
      <div className="text-sm font-semibold">{node.label ?? node.role ?? "Node"}</div>
      <div className="text-xs text-muted-foreground">{node.kind}</div>
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

function endpointLabel(endpoint: { node?: string; pin?: string; port?: string } | undefined, labels: Map<string, string>) {
  if (!endpoint?.node) {
    return "unassigned";
  }

  return `${labels.get(endpoint.node) ?? endpoint.node}.${endpoint.pin ?? endpoint.port ?? "?"}`;
}

function providerModesForEdge(source: ProjectSource, edge: IntentProvidesEdge) {
  const providerNode = source.nodes.find((node) => node.id === edge.from.node);

  if (providerNode?.kind !== "component") {
    return defaultProviderModes;
  }

  const modeDefinitions =
    components[providerNode.component]?.ports[edge.from.port ?? ""]?.provides?.[edge.contract]?.modes;

  if (!modeDefinitions) {
    return defaultProviderModes;
  }

  return Object.entries(modeDefinitions).map(([value, definition]) => ({
    label: definition.label ?? humanModeLabel(value),
    value
  }));
}

function providerModeDefinitionForEdge(source: ProjectSource, edge: IntentProvidesEdge, mode: string) {
  const providerNode = source.nodes.find((node) => node.id === edge.from.node);

  if (providerNode?.kind !== "component") {
    return undefined;
  }

  const modeDefinitions = components[providerNode.component]?.ports[edge.from.port ?? ""]?.provides?.[edge.contract]?.modes;

  return modeDefinitions?.[mode] ?? (mode === "auto" ? Object.values(modeDefinitions ?? {})[0] : undefined);
}

function humanModeLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function providerSignalsForEdge(source: ProjectSource, edge: IntentProvidesEdge): ProviderSignal[] {
  const functionNode = source.nodes.find((node) => node.id === edge.to.node);

  if (functionNode?.kind !== "intent.function") {
    return [];
  }

  const definition = functions[functionNode.function];

  if (!definition) {
    return [];
  }

  return definition.signalGroups.flatMap((group) =>
    signalGroupEnabled(functionNode, group.include, group.include ? definition.include[group.include] : undefined)
      ? group.signals
      : []
  );
}

function signalGroupEnabled(
  node: FunctionNode,
  includeId: string | undefined,
  includeDefinition: FunctionIncludeDefinition | undefined
) {
  if (!includeId) {
    return true;
  }

  const value = node.include?.[includeId];

  if (typeof value === "boolean") {
    return value;
  }

  if (value === undefined && includeDefinition?.kind === "boolean") {
    return includeDefinition.default ?? false;
  }

  return Boolean(value);
}

function presetFitsOptions(preset: Record<string, string>, pinOptions: ComponentPinOption[]) {
  const availablePins = new Set(pinOptions.map((pin) => pin.id));

  return Object.values(preset).every((pin) => availablePins.has(pin));
}
