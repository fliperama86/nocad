import { components, functions } from "@nocad/intent-core";
import type {
  IntentProvidesEdge,
  ProjectSource,
  ProviderModeDefinition,
  SignalBindings,
  SignalPinMap
} from "@nocad/intent-core";

export type ProviderModeOption = {
  label: string;
  value: string;
};

export function providerModesForEdge(source: ProjectSource, edge: IntentProvidesEdge): ProviderModeOption[] {
  const definitions = declaredProviderModes(source, edge);

  if (definitions) {
    return Object.entries(definitions).map(([value, definition]) => ({
      label: definition.label ?? humanModeLabel(value),
      value
    }));
  }

  const genericMode = genericProviderModeForEdge(source, edge);

  if (genericMode) {
    return [
      {
        label: genericMode.definition.label ?? humanModeLabel(genericMode.id),
        value: genericMode.id
      }
    ];
  }

  const currentMode = edge.strategy?.providerMode ?? "auto";

  return [{ label: humanModeLabel(currentMode), value: currentMode }];
}

export function providerModeDefinitionForEdge(
  source: ProjectSource,
  edge: IntentProvidesEdge,
  mode: string
): ProviderModeDefinition | undefined {
  const definitions = declaredProviderModes(source, edge);
  const declaredMode = definitions?.[mode] ?? (mode === "auto" ? Object.values(definitions ?? {})[0] : undefined);

  if (declaredMode) {
    return declaredMode;
  }

  const genericMode = genericProviderModeForEdge(source, edge);

  return genericMode?.id === mode ? genericMode.definition : undefined;
}

export function fixedProviderPinsForEdge(source: ProjectSource, edge: IntentProvidesEdge, mode: string) {
  const definition = providerModeDefinitionForEdge(source, edge, mode);

  return Object.fromEntries(
    Object.entries(definition?.signalMap ?? {}).flatMap(([signal, signalMap]) =>
      "pin" in signalMap ? [[signal, signalMap.pin]] : []
    )
  );
}

export function providerSignalIsEditable(
  source: ProjectSource,
  edge: IntentProvidesEdge,
  mode: string,
  signal: string
) {
  const signalMap = providerModeDefinitionForEdge(source, edge, mode)?.signalMap[signal];

  return Boolean(signalMap && "pinSelector" in signalMap);
}

export function bindingsForProviderMode(
  source: ProjectSource,
  edge: IntentProvidesEdge,
  mode: string
): SignalBindings | undefined {
  if (!edge.bindings) {
    return undefined;
  }

  const signalMap = providerModeDefinitionForEdge(source, edge, mode)?.signalMap ?? {};
  const bindings: SignalBindings = Object.fromEntries(
    Object.entries(edge.bindings).flatMap(([signal, binding]) => {
      const mapping = signalMap[signal];

      if (!mapping || "pinSelector" in mapping || !binding.from) {
        return [[signal, binding]];
      }

      const { from: _fixedProviderBinding, ...remainingRoles } = binding;

      return Object.keys(remainingRoles).length > 0 ? [[signal, remainingRoles]] : [];
    })
  );

  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

function declaredProviderModes(source: ProjectSource, edge: IntentProvidesEdge) {
  const providerNode = source.nodes.find((node) => node.id === edge.from.node);

  if (providerNode?.kind !== "component") {
    return undefined;
  }

  return components[providerNode.component]?.ports[edge.from.port ?? ""]?.provides?.[edge.contract]?.modes;
}

function genericProviderModeForEdge(
  source: ProjectSource,
  edge: IntentProvidesEdge
): { definition: ProviderModeDefinition; id: string } | undefined {
  const providerNode = source.nodes.find((node) => node.id === edge.from.node);
  const functionNode = source.nodes.find((node) => node.id === edge.to.node);

  if (providerNode?.kind !== "component" || functionNode?.kind !== "intent.function") {
    return undefined;
  }

  const providerPort = components[providerNode.component]?.ports[edge.from.port ?? ""];
  const functionDefinition = functions[functionNode.function];
  const genericProvider = functionDefinition?.topology.genericProvider;

  if (
    !genericProvider ||
    edge.contract !== functionDefinition.topology.contract ||
    providerPort?.kind !== "pin_pool" ||
    !genericProvider.pinCapabilities.every((capability) => providerPort.pinCapabilities?.includes(capability))
  ) {
    return undefined;
  }

  const signalMap: Record<string, SignalPinMap> = Object.fromEntries(
    functionDefinition.signalGroups.flatMap((group) =>
      group.signals.map((signal) => [
        signal.id,
        { pinSelector: { capabilities: genericProvider.pinCapabilities } }
      ])
    )
  );

  return {
    definition: {
      label: genericProvider.label,
      signalMap
    },
    id: genericProvider.modeId
  };
}

function humanModeLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
