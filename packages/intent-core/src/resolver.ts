import { components, contracts, functions, packageVersions } from "./fixtures";
import type {
  ComponentDefinition,
  ComponentNode,
  ConnectionContract,
  ContractParams,
  ContractSignal,
  Diagnostic,
  EndpointRef,
  IntentConnectionEdge,
  IntentExposesEdge,
  IntentProvidesEdge,
  FunctionIncludeDefinition,
  FunctionNode,
  PortContractMap,
  ProviderModeDefinition,
  ProjectEdge,
  ProjectNode,
  ProjectSource,
  PowerDomainNode,
  ResolvedDependency,
  ResolvedNet,
  ResolvedProject,
  SignalPinMap,
  SignalBindings
} from "./types";

const RESOLVER_VERSION = "0.1.0";
const HDMI_OUTPUT_CONTRACT = "@nocad/video:hdmi_output.v1";

type ComponentContext = {
  node: ComponentNode;
  definition: ComponentDefinition;
};

type ReservedPin = {
  node: string;
  pin: string;
  edge: string;
};

type BoundPort = {
  contract: string;
  edge: string;
};

type ResolvedConnection = {
  choice: ResolvedProject["resolvedChoices"][number];
  nets: ResolvedNet[];
};

type ResolvedProviderMode = {
  id: string;
  mode: ProviderModeDefinition;
};

type ResolutionContext = {
  authoredPorts: Map<string, BoundPort[]>;
  diagnostics: Diagnostic[];
  boundPorts: Map<string, BoundPort[]>;
  nodeById: Map<string, ProjectNode>;
  componentByNodeId: Map<string, ComponentContext>;
  reservedPins: Map<string, ReservedPin>;
};

export function resolveProject(source: ProjectSource): ResolvedProject {
  const diagnostics: Diagnostic[] = [];
  const nodeById = indexNodes(source.nodes, diagnostics);
  const componentByNodeId = indexComponentContexts(source.nodes, diagnostics);
  const reservedPins = collectInitialReservations(source.edges);
  const boundPorts = new Map<string, BoundPort[]>();
  const validEdges: ProjectEdge[] = [];
  const edgeIds = new Set<string>();
  const dependencies = createResolvedDependencies(source.dependencies);

  const context: ResolutionContext = {
    authoredPorts: new Map(),
    diagnostics,
    boundPorts,
    nodeById,
    componentByNodeId,
    reservedPins
  };

  const resolvedChoices: ResolvedProject["resolvedChoices"] = [];
  const nets: ResolvedNet[] = [];
  const generated: ResolvedProject["generated"] = [];

  for (const edge of source.edges) {
    if (edgeIds.has(edge.id)) {
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_EDGE_ID",
        message: `Edge id "${edge.id}" is used more than once.`,
        targets: [{ kind: "edge", id: edge.id }]
      });
      continue;
    }

    edgeIds.add(edge.id);
    validEdges.push(edge);
  }

  context.authoredPorts = collectAuthoredPortBindings(validEdges);

  const connectionEdges = validEdges.filter(
    (edge): edge is IntentConnectionEdge => edge.kind === "intent.connection"
  );

  for (const edge of sortIntentConnectionEdges(connectionEdges, context)) {
    const resolved = resolveIntentConnection(edge, context);

    if (!resolved) {
      continue;
    }

    resolvedChoices.push(resolved.choice);
    nets.push(...resolved.nets);

    reserveBindings(edge.id, resolved.choice.selected.bindings, context.reservedPins);
    recordBoundPort(edge.from, edge.contract, edge.id, context.boundPorts);
    recordBoundPort(edge.to, edge.contract, edge.id, context.boundPorts);

    if (edge.include?.pullups) {
      dependencies["@nocad/passives"] = {
        version: packageVersions["@nocad/passives"],
        hash: stablePackageHash("@nocad/passives", packageVersions["@nocad/passives"]),
        introducedBy: {
          edge: edge.id,
          feature: "pullups"
        }
      };

      const pullupRail = findPullupRail(source.nodes);

      if (!pullupRail) {
        diagnostics.push({
          severity: "error",
          code: "MISSING_POWER_DOMAIN",
          message: "I2C pullups require a 3.3V power domain.",
          targets: [{ kind: "edge", id: edge.id }]
        });
      } else {
        generated.push(
          createPullup("sda", edge.id, pullupRail.id),
          createPullup("scl", edge.id, pullupRail.id)
        );
      }
    }
  }

  const resolvedFunctions = resolveHdmiFunctions({ ...source, edges: validEdges }, context);
  resolvedChoices.push(...resolvedFunctions.choices);
  nets.push(...resolvedFunctions.nets);

  return {
    schema: "nocad.lock.v0",
    sourceSet: {
      hash: "sha256:fixture-source",
      files: [
        {
          role: "project",
          path: "project.nocad.json",
          hash: "sha256:fixture-project"
        }
      ]
    },
    resolver: {
      name: "nocad-resolver",
      version: RESOLVER_VERSION
    },
    dependencies,
    resolvedChoices,
    nets,
    generated,
    diagnostics
  };
}

function createPullup(signal: "sda" | "scl", edgeId: string, railId: string): ResolvedProject["generated"][number] {
  return {
    id: `pullup_${edgeId}_${signal}`,
    kind: "component",
    component: "@nocad/passives:RESISTOR",
    value: "4.7k",
    connects: [createNetId(edgeId, signal), railId],
    sourceEdge: edgeId,
    sourceMap: {
      edge: edgeId,
      feature: "pullups",
      signal
    }
  };
}

function findPullupRail(nodes: ProjectNode[]): PowerDomainNode | null {
  return (
    nodes.find(
      (node): node is PowerDomainNode =>
        node.kind === "powerDomain" && (node.role === "power_3v3" || node.voltage === "3.3V")
    ) ?? null
  );
}

function sortIntentConnectionEdges(edges: IntentConnectionEdge[], context: ResolutionContext): IntentConnectionEdge[] {
  return edges
    .map((edge, index) => ({
      edge,
      index,
      score: connectionPinFlexibilityScore(edge, context)
    }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ edge }) => edge);
}

function connectionPinFlexibilityScore(edge: IntentConnectionEdge, context: ResolutionContext) {
  const contract = contracts[edge.contract];
  const from = context.componentByNodeId.get(edge.from.node);
  const to = context.componentByNodeId.get(edge.to.node);
  const fromMap = from?.definition.ports[edge.from.port ?? ""]?.contractMaps?.[edge.contract];
  const toMap = to?.definition.ports[edge.to.port ?? ""]?.contractMaps?.[edge.contract];

  if (!contract || !from || !to || !fromMap || !toMap) {
    return Number.MAX_SAFE_INTEGER;
  }

  const params = defaultContractParams(contract, edge.params);
  const signals = contractSignals(contract, params);

  return Object.keys(signals).reduce(
    (score, signal) =>
      score +
      signalMapFlexibility(from.definition, fromMap.signalMap[signal]) +
      signalMapFlexibility(to.definition, toMap.signalMap[signal]),
    0
  );
}

function signalMapFlexibility(definition: ComponentDefinition, signalMap: SignalPinMap | undefined) {
  if (!signalMap) {
    return Number.MAX_SAFE_INTEGER / 4;
  }

  if ("pin" in signalMap) {
    return 0;
  }

  return Object.values(definition.pins).filter((pin) =>
    signalMap.pinSelector.capabilities.every((capability) => pin.capabilities.includes(capability))
  ).length;
}

function resolveHdmiFunctions(
  source: ProjectSource,
  context: ResolutionContext
): { choices: ResolvedProject["resolvedChoices"]; nets: ResolvedNet[] } {
  const choices: ResolvedProject["resolvedChoices"] = [];
  const nets: ResolvedNet[] = [];

  for (const node of source.nodes) {
    if (node.kind !== "intent.function" || node.function !== HDMI_OUTPUT_CONTRACT) {
      continue;
    }

    const providerEdge = source.edges.find(
      (edge): edge is IntentProvidesEdge =>
        edge.kind === "intent.provides" && edge.to.node === node.id && edge.contract === HDMI_OUTPUT_CONTRACT
    );
    const connectorEdge = source.edges.find(
      (edge): edge is IntentExposesEdge =>
        edge.kind === "intent.exposes" && edge.from.node === node.id && edge.contract === HDMI_OUTPUT_CONTRACT
    );

    if (!providerEdge || !connectorEdge) {
      continue;
    }

    const resolvedProvider = resolveHdmiProvider(node, providerEdge, connectorEdge, context);

    if (resolvedProvider) {
      choices.push(resolvedProvider.choice);
      nets.push(...resolvedProvider.nets);
      reserveBindings(providerEdge.id, resolvedProvider.choice.selected.bindings, context.reservedPins);
    }

    const source5vNet = resolveHdmiSource5v(node, connectorEdge, source.nodes, context);

    if (source5vNet) {
      nets.push(source5vNet);
    }
  }

  return { choices, nets };
}

function resolveHdmiProvider(
  functionNode: FunctionNode,
  providerEdge: IntentProvidesEdge,
  connectorEdge: IntentExposesEdge,
  context: ResolutionContext
): ResolvedConnection | null {
  const provider = resolveComponentEndpoint(providerEdge.id, providerEdge.from, context);
  const connector = resolveComponentEndpoint(connectorEdge.id, connectorEdge.to, context);

  if (!provider || !connector) {
    return null;
  }

  const connectorMap = connector.definition.ports[connectorEdge.to.port ?? ""]?.contractMaps?.[HDMI_OUTPUT_CONTRACT];
  const providerModeChoice = resolveProviderMode(providerEdge, provider, context);

  if (!providerModeChoice) {
    return null;
  }

  if (!connectorMap || connectorMap.role !== "to") {
    context.diagnostics.push({
      severity: "error",
      code: "PORT_CONTRACT_MISMATCH",
      message: `${connectorEdge.to.node}.${connectorEdge.to.port ?? ""} does not support ${HDMI_OUTPUT_CONTRACT} as the connector endpoint.`,
      targets: [{ kind: "edge", id: connectorEdge.id }]
    });
    return null;
  }

  if (!checkProviderModeRequirements(providerEdge, providerModeChoice.mode, context)) {
    return null;
  }

  const signals = hdmiSignalsForFunction(functionNode);
  const localReservedPins = new Set<string>();
  const bindings: SignalBindings = {};

  for (const signal of signals) {
    const connectorSignalMap = connectorMap.signalMap[signal];
    const providerSignalMap = providerModeChoice.mode.signalMap[signal];

    if (!connectorSignalMap || !providerSignalMap) {
      context.diagnostics.push({
        severity: "error",
        code: "PORT_CONTRACT_MISMATCH",
        message: `${HDMI_OUTPUT_CONTRACT} signal "${signal}" is not mapped by the selected provider or connector port.`,
        targets: [{ kind: "edge", id: providerEdge.id }]
      });
      return null;
    }

    const sourceEndpoint = resolveMappedEndpoint(
      providerEdge.id,
      signal,
      providerEdge.from.node,
      provider.definition,
      providerSignalMap,
      providerEdge.bindings?.[signal]?.from,
      context,
      localReservedPins
    );
    const connectorEndpoint = resolveMappedEndpoint(
      providerEdge.id,
      signal,
      connectorEdge.to.node,
      connector.definition,
      connectorSignalMap,
      providerEdge.bindings?.[signal]?.to,
      context,
      localReservedPins
    );

    if (!sourceEndpoint || !connectorEndpoint) {
      return null;
    }

    bindings[signal] = {
      from: sourceEndpoint,
      to: connectorEndpoint
    };
  }

  return {
    choice: {
      id: `${providerEdge.id}.pinAssignment`,
      sourceEdge: providerEdge.id,
      strategy: providerEdge.bindings ? "manual" : "auto",
      selected: {
        bindings,
        providerMode: providerModeChoice.id
      },
      reason: `Resolved enabled HDMI output features using provider mode "${providerModeChoice.id}" and connector pins.`
    },
    nets: Object.keys(bindings).map((signal) => createHdmiNet(signal, bindings, providerEdge.id))
  };
}

function resolveProviderMode(
  providerEdge: IntentProvidesEdge,
  provider: ComponentContext,
  context: ResolutionContext
): ResolvedProviderMode | null {
  const port = provider.definition.ports[providerEdge.from.port ?? ""];
  const provides = port?.provides?.[providerEdge.contract];

  if (!provides || provides.role !== "provider") {
    context.diagnostics.push({
      severity: "error",
      code: "PORT_CONTRACT_MISMATCH",
      message: `${providerEdge.from.node}.${providerEdge.from.port ?? ""} does not provide ${providerEdge.contract}.`,
      targets: [{ kind: "edge", id: providerEdge.id }]
    });
    return null;
  }

  const requestedMode = providerEdge.strategy?.providerMode ?? "auto";
  const fallbackMode = requestedMode === "auto" ? Object.entries(provides.modes)[0] : undefined;
  const modeEntry = provides.modes[requestedMode]
    ? ([requestedMode, provides.modes[requestedMode]] as const)
    : fallbackMode;

  if (!modeEntry) {
    context.diagnostics.push({
      severity: "error",
      code: "PROVIDER_MODE_NOT_FOUND",
      message: `${providerEdge.from.node}.${providerEdge.from.port ?? ""} does not expose provider mode "${requestedMode}" for ${providerEdge.contract}.`,
      targets: [{ kind: "edge", id: providerEdge.id }]
    });
    return null;
  }

  return {
    id: modeEntry[0],
    mode: modeEntry[1]
  };
}

function checkProviderModeRequirements(
  providerEdge: IntentProvidesEdge,
  providerMode: ProviderModeDefinition,
  context: ResolutionContext
): boolean {
  const portRequirements = providerMode.requires?.ports ?? {};

  for (const [port, requirement] of Object.entries(portRequirements)) {
    if (requirement.optional) {
      continue;
    }

    const acceptedContracts = Array.isArray(requirement.contract) ? requirement.contract : [requirement.contract];
    const bindings = context.boundPorts.get(portKey(providerEdge.from.node, port)) ?? [];
    const authoredBindings = context.authoredPorts.get(portKey(providerEdge.from.node, port)) ?? [];
    const matched = bindings.find((binding) => acceptedContracts.includes(binding.contract));

    if (!matched) {
      const authoredMatch = authoredBindings.find((binding) => acceptedContracts.includes(binding.contract));

      if (authoredMatch) {
        return false;
      }

      context.diagnostics.push({
        severity: "error",
        code: "PROVIDER_REQUIREMENT_UNSATISFIED",
        message: `${providerEdge.from.node}.${providerEdge.from.port ?? ""} requires ${providerEdge.from.node}.${port} to be bound to ${acceptedContracts.join(" or ")}.`,
        targets: [
          { kind: "edge", id: providerEdge.id },
          { kind: "node", id: providerEdge.from.node }
        ]
      });
      return false;
    }
  }

  return true;
}

function resolveHdmiSource5v(
  functionNode: FunctionNode,
  connectorEdge: IntentExposesEdge,
  nodes: ProjectNode[],
  context: ResolutionContext
): ResolvedNet | null {
  if (!functionNode.include?.source5v) {
    return null;
  }

  const rail = findSource5vRail(nodes);

  if (!rail) {
    context.diagnostics.push({
      severity: "error",
      code: "MISSING_HDMI_5V_POWER",
      message: "HDMI source power requires a 5V power domain.",
      targets: [{ kind: "node", id: functionNode.id }]
    });
    return null;
  }

  const connector = context.componentByNodeId.get(connectorEdge.to.node);
  const source5vPin = connector?.definition.pins.source_5v ? "source_5v" : undefined;

  if (!source5vPin) {
    context.diagnostics.push({
      severity: "error",
      code: "PORT_CONTRACT_MISMATCH",
      message: `${connectorEdge.to.node} does not expose an HDMI +5V pin.`,
      targets: [{ kind: "edge", id: connectorEdge.id }]
    });
    return null;
  }

  return {
    id: `net_${functionNode.id}_source5v`,
    name: "HDMI_5V",
    endpoints: {
      from: { node: rail.id },
      to: { node: connectorEdge.to.node, pin: source5vPin }
    },
    direction: "from_to_to",
    sourceEdge: connectorEdge.id,
    sourceMap: {
      edge: connectorEdge.id,
      signal: "source5v"
    }
  };
}

function findSource5vRail(nodes: ProjectNode[]): PowerDomainNode | null {
  return (
    nodes.find(
      (node): node is PowerDomainNode =>
        node.kind === "powerDomain" && (node.role === "power_5v" || node.voltage === "5V")
    ) ?? null
  );
}

function hdmiSignalsForFunction(functionNode: FunctionNode) {
  const definition = functions[functionNode.function];

  if (!definition) {
    return [];
  }

  return definition.signalGroups.flatMap((group) =>
    functionSignalGroupEnabled(functionNode, group.include, group.include ? definition.include[group.include] : undefined)
      ? group.signals.map((signal) => signal.id)
      : []
  );
}

function functionSignalGroupEnabled(
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

function chooseAvailablePin(
  nodeId: string,
  definition: ComponentDefinition,
  capabilities: string[],
  context: ResolutionContext,
  localReservedPins: Set<string>
) {
  const pin = Object.entries(definition.pins).find(
    ([pinId, candidate]) =>
      capabilities.every((capability) => candidate.capabilities.includes(capability)) &&
      !context.reservedPins.has(`${nodeId}.${pinId}`) &&
      !localReservedPins.has(`${nodeId}.${pinId}`)
  );

  return pin?.[0];
}

function resolveMappedEndpoint(
  edgeId: string,
  signal: string,
  nodeId: string,
  definition: ComponentDefinition,
  signalMap: SignalPinMap,
  override: EndpointRef | undefined,
  context: ResolutionContext,
  localReservedPins: Set<string>
): EndpointRef | null {
  if (override?.node && override.node !== nodeId) {
    context.diagnostics.push({
      severity: "error",
      code: "INVALID_ENDPOINT_NODE",
      message: `Signal "${signal}" on edge "${edgeId}" cannot bind ${nodeId} through node "${override.node}".`,
      targets: [{ kind: "edge", id: edgeId }]
    });
    return null;
  }

  if ("pin" in signalMap && override?.pin && override.pin !== signalMap.pin) {
    context.diagnostics.push({
      severity: "error",
      code: "PIN_BINDING_MISMATCH",
      message: `${nodeId}.${override.pin} cannot override fixed mapping for signal "${signal}", expected ${nodeId}.${signalMap.pin}.`,
      targets: [
        { kind: "edge", id: edgeId },
        { kind: "pin", node: nodeId, pin: override.pin }
      ]
    });
    return null;
  }

  const selectedPin =
    "pin" in signalMap
      ? signalMap.pin
      : (override?.pin ??
        chooseAvailablePin(nodeId, definition, signalMap.pinSelector.capabilities, context, localReservedPins));

  if (!selectedPin) {
    context.diagnostics.push({
      severity: "error",
      code: "NO_AVAILABLE_PIN",
      message: `No available pin could satisfy signal "${signal}" on edge "${edgeId}".`,
      targets: [{ kind: "edge", id: edgeId }],
      suggestions: i2cPinSuggestion(edgeId, nodeId, definition, signal)
    });
    return null;
  }

  if (!definition.pins[selectedPin]) {
    context.diagnostics.push({
      severity: "error",
      code: "UNKNOWN_PIN",
      message: `${nodeId}.${selectedPin} does not exist.`,
      targets: [
        { kind: "edge", id: edgeId },
        { kind: "pin", node: nodeId, pin: selectedPin }
      ]
    });
    return null;
  }

  if ("pinSelector" in signalMap && !pinSatisfiesCapabilities(definition, selectedPin, signalMap.pinSelector.capabilities)) {
    context.diagnostics.push({
      severity: "error",
      code: "PIN_CAPABILITY_MISMATCH",
      message: `${nodeId}.${selectedPin} cannot satisfy signal "${signal}".`,
      targets: [
        { kind: "edge", id: edgeId },
        { kind: "pin", node: nodeId, pin: selectedPin }
      ]
    });
    return null;
  }

  const endpoint = { node: nodeId, pin: selectedPin };
  const endpointKey = pinKey(endpoint);
  const reserved = context.reservedPins.get(endpointKey);

  if (reserved) {
    context.diagnostics.push({
      severity: "error",
      code: "PIN_CONFLICT",
      message: `${reserved.node}.${reserved.pin} is already reserved by ${reserved.edge}.`,
      targets: [
        { kind: "edge", id: edgeId },
        { kind: "pin", node: reserved.node, pin: reserved.pin }
      ]
    });
    return null;
  }

  if (localReservedPins.has(endpointKey)) {
    context.diagnostics.push({
      severity: "error",
      code: "PIN_CONFLICT",
      message: `${endpoint.node}.${endpoint.pin} is assigned to more than one signal on edge "${edgeId}".`,
      targets: [
        { kind: "edge", id: edgeId },
        { kind: "pin", node: endpoint.node, pin: endpoint.pin }
      ]
    });
    return null;
  }

  localReservedPins.add(endpointKey);
  return endpoint;
}

function pinSatisfiesCapabilities(definition: ComponentDefinition, pin: string, capabilities: string[]) {
  const candidate = definition.pins[pin];

  return Boolean(candidate && capabilities.every((capability) => candidate.capabilities.includes(capability)));
}

function i2cPinSuggestion(
  edgeId: string,
  nodeId: string,
  definition: ComponentDefinition,
  signal: string
): Diagnostic["suggestions"] {
  if ((signal !== "sda" && signal !== "scl") || !definition.pins.gpio8 || !definition.pins.gpio9) {
    return undefined;
  }

  return [
    {
      title: "Move I2C to GPIO8/GPIO9",
      patch: {
        op: "setEdgeBindings",
        edge: edgeId,
        value: {
          sda: { from: { node: nodeId, pin: "gpio8" } },
          scl: { from: { node: nodeId, pin: "gpio9" } }
        }
      }
    }
  ];
}

function createHdmiNet(signal: string, bindings: SignalBindings, edgeId: string): ResolvedNet {
  const binding = bindings[signal];
  const from = binding?.from;
  const to = binding?.to;
  const contractSignal = contracts[HDMI_OUTPUT_CONTRACT]?.signals[signal] as ContractSignal | undefined;

  if (!from?.pin || !to?.pin || !contractSignal) {
    throw new Error(`Resolved HDMI ${signal} binding is incomplete.`);
  }

  return {
    id: `net_${edgeId}_${signal}`,
    name: `HDMI_${signal.toUpperCase()}`,
    endpoints: {
      from,
      to
    },
    direction: contractSignal.direction,
    sourceEdge: edgeId,
    sourceMap: {
      edge: edgeId,
      signal
    }
  };
}

function createContractNet(contractId: string, signal: string, bindings: SignalBindings, edgeId: string): ResolvedNet {
  const binding = bindings[signal];
  const from = binding?.from;
  const to = binding?.to;
  const contractSignal = contracts[contractId]?.signals[signal] as ContractSignal | undefined;

  if (!from?.pin || !to?.pin || !contractSignal) {
    throw new Error(`Resolved ${contractId} ${signal} binding is incomplete.`);
  }

  return {
    id: createNetId(edgeId, signal),
    name: formatNetName(contractId, signal),
    endpoints: {
      from,
      to
    },
    direction: contractSignal.direction,
    sourceEdge: edgeId,
    sourceMap: {
      edge: edgeId,
      signal
    }
  };
}

function formatNetName(contractId: string, signal: string): string {
  if (contractId === "builtin:i2c.v1") {
    return `I2C_${signal.toUpperCase()}`;
  }

  if (contractId === "@nocad/video:pixel_stream.v1" || contractId === "builtin:dpi.v1") {
    return `PIXEL_${signal.toUpperCase()}`;
  }

  return `${contractId.replaceAll(/[^A-Z0-9]+/gi, "_").toUpperCase()}_${signal.toUpperCase()}`;
}

function normalizeContractParams(
  contract: ConnectionContract,
  edge: IntentConnectionEdge,
  context: ResolutionContext
): ContractParams | null {
  const params = defaultContractParams(contract, edge.params);

  for (const [paramId, definition] of Object.entries(contract.params ?? {})) {
    const value = params[paramId];

    if (definition.kind === "boolean" && typeof value !== "boolean") {
      pushContractParamDiagnostic(edge.id, paramId, "expected a boolean value", context);
      return null;
    }

    if (definition.kind === "enum") {
      const validValues = new Set(definition.options.map((option) => option.value));

      if (typeof value !== "string" || !validValues.has(value)) {
        pushContractParamDiagnostic(edge.id, paramId, `expected one of ${[...validValues].join(", ")}`, context);
        return null;
      }
    }

    if (definition.kind === "integer") {
      const validValues = definition.options ? new Set(definition.options.map((option) => option.value)) : undefined;

      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        (definition.min !== undefined && value < definition.min) ||
        (definition.max !== undefined && value > definition.max) ||
        (validValues && !validValues.has(value))
      ) {
        pushContractParamDiagnostic(
          edge.id,
          paramId,
          validValues ? `expected one of ${[...validValues].join(", ")}` : "expected an integer value",
          context
        );
        return null;
      }
    }
  }

  return params;
}

function defaultContractParams(contract: ConnectionContract, authoredParams: ContractParams | undefined): ContractParams {
  const params: ContractParams = {};

  for (const [paramId, definition] of Object.entries(contract.params ?? {})) {
    if (definition.default !== undefined) {
      params[paramId] = definition.default;
    }
  }

  return {
    ...params,
    ...(authoredParams ?? {})
  };
}

function pushContractParamDiagnostic(
  edgeId: string,
  paramId: string,
  detail: string,
  context: ResolutionContext
) {
  context.diagnostics.push({
    severity: "error",
    code: "CONTRACT_PARAM_INVALID",
    message: `Contract parameter "${paramId}" on edge "${edgeId}" is invalid: ${detail}.`,
    targets: [{ kind: "edge", id: edgeId }]
  });
}

function contractSignals(contract: ConnectionContract, params: ContractParams): Record<string, ContractSignal> {
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
      if (params[item.param]) {
        includeSignal(item.signal);
      }
    } else {
      const paramValue = params[item.widthParam];
      const width = typeof paramValue === "number" ? paramValue : item.maxWidth;

      for (let index = 0; index < Math.min(width, item.maxWidth); index += 1) {
        includeSignal(`${item.prefix}${index}`);
      }
    }
  }

  return signals;
}

function resolveIntentConnection(
  edge: IntentConnectionEdge,
  context: ResolutionContext
): ResolvedConnection | null {
  const from = resolveEndpoint(edge, "from", context);
  const to = resolveEndpoint(edge, "to", context);

  if (!from || !to) {
    return null;
  }

  const contract = contracts[edge.contract];

  if (!contract) {
    context.diagnostics.push({
      severity: "error",
      code: "UNKNOWN_CONTRACT",
      message: `Unknown contract "${edge.contract}".`,
      targets: [{ kind: "edge", id: edge.id }]
    });
    return null;
  }

  const fromMap = from.definition.ports[edge.from.port ?? ""]?.contractMaps?.[edge.contract];
  const toMap = to.definition.ports[edge.to.port ?? ""]?.contractMaps?.[edge.contract];

  if (!fromMap || fromMap.role !== "from") {
    context.diagnostics.push({
      severity: "error",
      code: "PORT_CONTRACT_MISMATCH",
      message: `${edge.from.node}.${edge.from.port ?? ""} does not support ${edge.contract} as the from endpoint.`,
      targets: [{ kind: "edge", id: edge.id }]
    });
    return null;
  }

  if (!toMap || toMap.role !== "to") {
    context.diagnostics.push({
      severity: "error",
      code: "PORT_CONTRACT_MISMATCH",
      message: `${edge.to.node}.${edge.to.port ?? ""} does not support ${edge.contract} as the to endpoint.`,
      targets: [{ kind: "edge", id: edge.id }]
    });
    return null;
  }

  const params = normalizeContractParams(contract, edge, context);

  if (!params) {
    return null;
  }

  const signals = contractSignals(contract, params);
  const bindings = resolveContractBindings(edge, signals, from, to, fromMap, toMap, context);

  if (!bindings) {
    return null;
  }

  return {
    choice: {
      id: `${edge.id}.pinAssignment`,
      sourceEdge: edge.id,
      strategy: edge.strategy?.pinAssignment === "manual" ? "manual" : "auto",
      selected: {
        bindings,
        params: Object.keys(params).length > 0 ? params : undefined
      },
      reason:
        edge.strategy?.pinAssignment === "manual"
          ? `Used source-provided bindings for ${edge.contract}.`
          : `Resolved ${edge.contract} against endpoint signal maps.`
    },
    nets: Object.keys(signals).map((signal) => createContractNet(edge.contract, signal, bindings, edge.id))
  };
}

function resolveContractBindings(
  edge: IntentConnectionEdge,
  signals: Record<string, ContractSignal>,
  from: ComponentContext,
  to: ComponentContext,
  fromMap: PortContractMap,
  toMap: PortContractMap,
  context: ResolutionContext
): SignalBindings | null {
  const preferredI2cBindings = resolvePreferredI2cPairBindings(
    edge,
    from,
    to,
    fromMap,
    toMap,
    context.reservedPins
  );

  if (preferredI2cBindings !== undefined) {
    return preferredI2cBindings;
  }

  const localReservedPins = new Set<string>();
  const bindings: SignalBindings = {};

  for (const signal of Object.keys(signals)) {
    const fromSignalMap = fromMap.signalMap[signal];
    const toSignalMap = toMap.signalMap[signal];

    if (!fromSignalMap || !toSignalMap) {
      context.diagnostics.push({
        severity: "error",
        code: "PORT_CONTRACT_MISMATCH",
        message: `${edge.contract} signal "${signal}" is not mapped by both endpoint ports.`,
        targets: [{ kind: "edge", id: edge.id }]
      });
      return null;
    }

    const fromEndpoint = resolveMappedEndpoint(
      edge.id,
      signal,
      edge.from.node,
      from.definition,
      fromSignalMap,
      edge.bindings?.[signal]?.from,
      context,
      localReservedPins
    );
    const toEndpoint = resolveMappedEndpoint(
      edge.id,
      signal,
      edge.to.node,
      to.definition,
      toSignalMap,
      edge.bindings?.[signal]?.to,
      context,
      localReservedPins
    );

    if (!fromEndpoint || !toEndpoint) {
      return null;
    }

    bindings[signal] = {
      from: fromEndpoint,
      to: toEndpoint
    };
  }

  return bindings;
}

function resolvePreferredI2cPairBindings(
  edge: IntentConnectionEdge,
  from: ComponentContext,
  to: ComponentContext,
  fromMap: PortContractMap,
  toMap: PortContractMap,
  reservedPins: Map<string, ReservedPin>
): SignalBindings | undefined {
  const pairs = from.definition.preferredI2cPairs ?? [];

  if (edge.contract !== "builtin:i2c.v1" || edge.strategy?.pinAssignment === "manual" || pairs.length === 0) {
    return undefined;
  }

  for (const pair of pairs) {
    const sda = createPreferredI2cEndpoint(edge, "sda", pair.sda, from, to, fromMap, toMap);
    const scl = createPreferredI2cEndpoint(edge, "scl", pair.scl, from, to, fromMap, toMap);

    if (!sda || !scl) {
      continue;
    }

    const bindings: SignalBindings = {
      sda,
      scl
    };

    if (bindingPinsAvailable(bindings, reservedPins)) {
      return bindings;
    }
  }

  return undefined;
}

function createPreferredI2cEndpoint(
  edge: IntentConnectionEdge,
  signal: "sda" | "scl",
  fromPin: string,
  from: ComponentContext,
  to: ComponentContext,
  fromMap: PortContractMap,
  toMap: PortContractMap
): Partial<Record<"from" | "to", EndpointRef>> | null {
  const fromSignalMap = fromMap.signalMap[signal];
  const toSignalMap = toMap.signalMap[signal];
  const toPin = toSignalMap && "pin" in toSignalMap ? toSignalMap.pin : undefined;

  if (
    !toPin ||
    !from.definition.pins[fromPin] ||
    !to.definition.pins[toPin] ||
    !fromSignalMap ||
    !("pinSelector" in fromSignalMap) ||
    !pinSatisfiesCapabilities(from.definition, fromPin, fromSignalMap.pinSelector.capabilities)
  ) {
    return null;
  }

  return {
    from: { node: edge.from.node, pin: fromPin },
    to: { node: edge.to.node, pin: toPin }
  };
}

function bindingPinsAvailable(bindings: SignalBindings, reservedPins: Map<string, ReservedPin>): boolean {
  const localReservedPins = new Set<string>();

  for (const binding of Object.values(bindings)) {
    for (const endpoint of Object.values(binding)) {
      if (!endpoint?.pin) {
        continue;
      }

      const key = pinKey(endpoint);

      if (reservedPins.has(key) || localReservedPins.has(key)) {
        return false;
      }

      localReservedPins.add(key);
    }
  }

  return true;
}

function resolveEndpoint(
  edge: IntentConnectionEdge,
  role: "from" | "to",
  context: ResolutionContext
): ComponentContext | null {
  const endpoint = edge[role];
  return resolveComponentEndpoint(edge.id, endpoint, context);
}

function resolveComponentEndpoint(
  edgeId: string,
  endpoint: EndpointRef,
  context: ResolutionContext
): ComponentContext | null {
  const node = context.nodeById.get(endpoint.node);

  if (!node) {
    context.diagnostics.push({
      severity: "error",
      code: "UNKNOWN_NODE",
      message: `Edge "${edgeId}" references missing node "${endpoint.node}".`,
      targets: [{ kind: "edge", id: edgeId }]
    });
    return null;
  }

  if (node.kind !== "component") {
    context.diagnostics.push({
      severity: "error",
      code: "INVALID_ENDPOINT_NODE",
      message: `Edge "${edgeId}" endpoint "${endpoint.node}" is not a component.`,
      targets: [
        { kind: "edge", id: edgeId },
        { kind: "node", id: endpoint.node }
      ]
    });
    return null;
  }

  const component = context.componentByNodeId.get(endpoint.node);

  if (!component) {
    return null;
  }

  if (!endpoint.port || !component.definition.ports[endpoint.port]) {
    context.diagnostics.push({
      severity: "error",
      code: "UNKNOWN_PORT",
      message: `Node "${endpoint.node}" does not expose port "${endpoint.port ?? ""}".`,
      targets: [
        { kind: "edge", id: edgeId },
        { kind: "node", id: endpoint.node }
      ]
    });
    return null;
  }

  return component;
}

function createNetId(edgeId: string, signal: string) {
  return `net_${edgeId}_${signal}`;
}

function indexNodes(nodes: ProjectNode[], diagnostics: Diagnostic[]): Map<string, ProjectNode> {
  const nodeById = new Map<string, ProjectNode>();

  for (const node of nodes) {
    if (nodeById.has(node.id)) {
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_NODE_ID",
        message: `Node id "${node.id}" is used more than once.`,
        targets: [{ kind: "node", id: node.id }]
      });
      continue;
    }

    nodeById.set(node.id, node);
  }

  return nodeById;
}

function indexComponentContexts(nodes: ProjectNode[], diagnostics: Diagnostic[]): Map<string, ComponentContext> {
  const componentByNodeId = new Map<string, ComponentContext>();

  for (const node of nodes) {
    if (node.kind !== "component") {
      continue;
    }

    const definition = components[node.component];

    if (!definition) {
      diagnostics.push({
        severity: "error",
        code: "UNKNOWN_COMPONENT",
        message: `Unknown component "${node.component}".`,
        targets: [{ kind: "node", id: node.id }]
      });
      continue;
    }

    componentByNodeId.set(node.id, {
      node,
      definition
    });
  }

  return componentByNodeId;
}

function collectInitialReservations(edges: ProjectEdge[]): Map<string, ReservedPin> {
  const reservedPins = new Map<string, ReservedPin>();

  for (const edge of edges) {
    if (edge.kind !== "net.binding") {
      continue;
    }

    reserveBindings(edge.id, edge.bindings, reservedPins);
  }

  return reservedPins;
}

function reserveBindings(edgeId: string, bindings: SignalBindings, reservedPins: Map<string, ReservedPin>) {
  for (const binding of Object.values(bindings)) {
    for (const endpoint of Object.values(binding)) {
      if (!endpoint?.pin) {
        continue;
      }

      reservedPins.set(pinKey(endpoint), {
        node: endpoint.node,
        pin: endpoint.pin,
        edge: edgeId
      });
    }
  }
}

function recordBoundPort(endpoint: EndpointRef, contract: string, edgeId: string, boundPorts: Map<string, BoundPort[]>) {
  if (!endpoint.port) {
    return;
  }

  const key = portKey(endpoint.node, endpoint.port);
  const bindings = boundPorts.get(key) ?? [];
  bindings.push({
    contract,
    edge: edgeId
  });
  boundPorts.set(key, bindings);
}

function collectAuthoredPortBindings(edges: ProjectEdge[]): Map<string, BoundPort[]> {
  const authoredPorts = new Map<string, BoundPort[]>();

  for (const edge of edges) {
    if (edge.kind !== "intent.connection") {
      continue;
    }

    recordBoundPort(edge.from, edge.contract, edge.id, authoredPorts);
    recordBoundPort(edge.to, edge.contract, edge.id, authoredPorts);
  }

  return authoredPorts;
}

function portKey(node: string, port: string): string {
  return `${node}.${port}`;
}

function pinKey(endpoint: EndpointRef): string {
  return `${endpoint.node}.${endpoint.pin ?? ""}`;
}

function createResolvedDependencies(dependencies: Record<string, string>): Record<string, ResolvedDependency> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => [
      name,
      {
        version,
        hash: stablePackageHash(name, version)
      }
    ])
  );
}

function stablePackageHash(name: string, version: string): string {
  return `sha256:fixture:${name}@${version}`;
}
