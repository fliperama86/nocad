import { contracts } from "@nocad/intent-core";
import type {
  ConnectionContract,
  ContractParamDefinition,
  ContractParams,
  ContractParamValue,
  ContractSignal,
  ProjectSource
} from "@nocad/intent-core";
import { useState } from "react";

import { cn } from "../../lib/utils";

export type ConnectionIntentOption = {
  contract: string;
  from: {
    node: string;
    port: string;
  };
  id: string;
  label: string;
  params?: ContractParams;
  to: {
    node: string;
    port: string;
  };
};

export type PendingConnectionIntent = {
  options: ConnectionIntentOption[];
  revision: number;
  sourceNode: string;
  targetNode: string;
};

export function ConnectionIntentDialog({
  onCancel,
  onCreate,
  pendingConnection,
  source
}: {
  onCancel: () => void;
  onCreate: (option: ConnectionIntentOption, params: ContractParams | undefined) => void;
  pendingConnection: PendingConnectionIntent | undefined;
  source: ProjectSource;
}) {
  if (!pendingConnection) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <ConnectionIntentDialogBody
        key={pendingConnectionKey(pendingConnection)}
        onCancel={onCancel}
        onCreate={onCreate}
        pendingConnection={pendingConnection}
        source={source}
      />
    </div>
  );
}

function ConnectionIntentDialogBody({
  onCancel,
  onCreate,
  pendingConnection,
  source
}: {
  onCancel: () => void;
  onCreate: (option: ConnectionIntentOption, params: ContractParams | undefined) => void;
  pendingConnection: PendingConnectionIntent;
  source: ProjectSource;
}) {
  const labels = nodeLabels(source);
  const firstOption = pendingConnection.options[0];
  const [selectedOptionId, setSelectedOptionId] = useState(firstOption?.id ?? "");
  const [params, setParams] = useState<ContractParams | undefined>(() =>
    firstOption ? mergeDefaultContractParams(firstOption.contract, firstOption.params) : undefined
  );
  const selectedOption =
    pendingConnection.options.find((option) => option.id === selectedOptionId) ?? pendingConnection.options[0];
  const contract = selectedOption ? contracts[selectedOption.contract] : undefined;
  const selectOption = (optionId: string) => {
    const option = pendingConnection.options.find((candidate) => candidate.id === optionId);

    setSelectedOptionId(optionId);
    setParams(option ? mergeDefaultContractParams(option.contract, option.params) : undefined);
  };

  return (
    <section
      aria-labelledby="connection-dialog-title"
      aria-modal="true"
      className="grid max-h-[90svh] w-full max-w-2xl gap-4 overflow-auto rounded-lg border border-border bg-card p-4 text-card-foreground shadow-2xl"
      role="dialog"
    >
      <div className="grid gap-1">
        <h2 className="text-base font-semibold" id="connection-dialog-title">
          Create connection
        </h2>
        <div className="text-xs text-muted-foreground">
          {labels.get(pendingConnection.sourceNode) ?? "Source"} {"->"} {labels.get(pendingConnection.targetNode) ?? "Target"}
        </div>
      </div>

      {!selectedOption ? (
        <>
          <EmptyState text="No compatible contracts were found between these components." />
          <DialogActions onCancel={onCancel} />
        </>
      ) : (
        <>
          <label className="grid gap-2 rounded-md border border-border bg-background px-3 py-3 text-sm">
            <span className="font-medium">Contract and ports</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              onChange={(event) => selectOption(event.target.value)}
              value={selectedOption.id}
            >
              {pendingConnection.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {connectionOptionLabel(option, labels)}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-3">
            <Field
              label="Contract"
              value={contract?.label ? `${contract.label} (${selectedOption.contract})` : selectedOption.contract}
            />
            <Field
              label="From port"
              value={`${labels.get(selectedOption.from.node) ?? selectedOption.from.node}.${selectedOption.from.port}`}
            />
            <Field
              label="To port"
              value={`${labels.get(selectedOption.to.node) ?? selectedOption.to.node}.${selectedOption.to.port}`}
            />
          </div>

          <ContractParamsEditor
            contract={contract}
            onApplyPreset={(nextParams) => setParams((current) => ({ ...(current ?? {}), ...nextParams }))}
            onSetParam={(param, value) => setParams((current) => ({ ...(current ?? {}), [param]: value }))}
            params={params}
          />

          <SignalPreview contract={contract} params={params} />

          <DialogActions
            onCancel={onCancel}
            onCreate={() => onCreate(selectedOption, params)}
          />
        </>
      )}
    </section>
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

      <div className="grid gap-2 sm:grid-cols-2">
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

function DialogActions({ onCancel, onCreate }: { onCancel: () => void; onCreate?: () => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" onClick={onCancel} type="button">
        Cancel
      </button>
      {onCreate ? (
        <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" onClick={onCreate} type="button">
          Create edge
        </button>
      ) : null}
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

function connectionOptionLabel(option: ConnectionIntentOption, labels: Map<string, string>) {
  const contract = contracts[option.contract];
  const contractLabel = contract?.label ?? option.contract;

  return `${contractLabel}: ${labels.get(option.from.node) ?? option.from.node}.${option.from.port} -> ${
    labels.get(option.to.node) ?? option.to.node
  }.${option.to.port}`;
}

function pendingConnectionKey(pendingConnection: PendingConnectionIntent) {
  return `${pendingConnection.revision}:${pendingConnection.sourceNode}->${pendingConnection.targetNode}:${pendingConnection.options
    .map((option) => option.id)
    .join("|")}`;
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

function nodeLabels(source: ProjectSource) {
  return new Map(source.nodes.map((node) => [node.id, node.label ?? node.role ?? "Node"]));
}
