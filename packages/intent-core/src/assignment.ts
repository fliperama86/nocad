import type {
  ComponentDefinition,
  DefinitionCatalog,
  EndpointRole,
  IntentConnectionEdge,
  ProjectSource,
  SignalPinMap
} from "./types";

export type PreferredPinGroupOption = {
  endpointRole: EndpointRole;
  id: string;
  label: string;
  node: string;
  pins: Record<string, string>;
};

export type ComponentPinOption = {
  capabilities: string[];
  id: string;
  name: string;
};

export function getPreferredPinGroupOptions(
  source: ProjectSource,
  edgeId: string,
  catalog: DefinitionCatalog
): PreferredPinGroupOption[] {
  const edge = source.edges.find(
    (candidate): candidate is IntentConnectionEdge =>
      candidate.id === edgeId && candidate.kind === "intent.connection"
  );

  if (!edge) {
    return [];
  }

  return (["from", "to"] as const).flatMap((endpointRole) =>
    preferredOptionsForEndpoint(source, edge, endpointRole, catalog)
  );
}

export function getComponentPinOptions(
  source: ProjectSource,
  nodeId: string,
  catalog: DefinitionCatalog,
  capabilities: string | string[] = []
): ComponentPinOption[] {
  const node = source.nodes.find((candidate) => candidate.id === nodeId);

  if (!node || node.kind !== "component") {
    return [];
  }

  const definition = catalog.components[node.component];
  const required = Array.isArray(capabilities) ? capabilities : [capabilities];

  if (!definition) {
    return [];
  }

  return Object.entries(definition.pins)
    .filter(([, pin]) => required.every((capability) => pin.capabilities.includes(capability)))
    .map(([id, pin]) => ({
      capabilities: pin.capabilities,
      id,
      name: pin.name
    }));
}

function preferredOptionsForEndpoint(
  source: ProjectSource,
  edge: IntentConnectionEdge,
  endpointRole: EndpointRole,
  catalog: DefinitionCatalog
): PreferredPinGroupOption[] {
  const endpoint = edge[endpointRole];
  const node = source.nodes.find((candidate) => candidate.id === endpoint.node);

  if (!node || node.kind !== "component") {
    return [];
  }

  const definition = catalog.components[node.component];

  if (!definition) {
    return [];
  }

  return (definition.preferredPinGroups ?? [])
    .filter(
      (group) =>
        group.contract === edge.contract &&
        (group.port === undefined || group.port === endpoint.port) &&
        preferredPinsAreValid(definition, endpoint.port, edge.contract, endpointRole, group.pins, catalog)
    )
    .map((group, index) => ({
      endpointRole,
      id: `${endpointRole}:${group.port ?? "pins"}:${index}`,
      label: group.suggestion?.title ?? Object.entries(group.pins).map(([signal, pin]) => `${signal}: ${pin}`).join(", "),
      node: node.id,
      pins: { ...group.pins }
    }));
}

function preferredPinsAreValid(
  definition: ComponentDefinition,
  portId: string | undefined,
  contractId: string,
  endpointRole: EndpointRole,
  pins: Record<string, string>,
  catalog: DefinitionCatalog
): boolean {
  const contract = catalog.contracts[contractId];

  if (!contract || Object.keys(pins).length === 0) {
    return false;
  }

  const contractMap = portId ? definition.ports[portId]?.contractMaps?.[contractId] : undefined;

  if (portId && !contractMap) {
    return false;
  }

  if (contractMap && contractMap.role !== endpointRole) {
    return false;
  }

  return Object.entries(pins).every(([signal, pin]) => {
    if (!contract.signals[signal] || !definition.pins[pin]) {
      return false;
    }

    const signalMap = contractMap?.signalMap[signal];
    return !signalMap || pinMatchesSignalMap(definition, pin, signalMap);
  });
}

function pinMatchesSignalMap(definition: ComponentDefinition, pin: string, signalMap: SignalPinMap): boolean {
  if ("pin" in signalMap) {
    return signalMap.pin === pin;
  }

  const candidate = definition.pins[pin];
  return signalMap.pinSelector.capabilities.every(
    (capability) => candidate?.capabilities.includes(capability) === true
  );
}
