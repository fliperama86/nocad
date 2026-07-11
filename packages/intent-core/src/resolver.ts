import { components, contracts, functions, packageVersions } from "./fixtures";
import type {
  ComponentDefinition,
  ComponentNode,
  ConnectionContract,
  ConnectionTopologyRuleDefinition,
  ContractParams,
  ContractSignal,
  Diagnostic,
  EndpointRole,
  EndpointRef,
  FunctionDefinition,
  FunctionInlineRuleDefinition,
  IntentConnectionEdge,
  IntentExposesEdge,
  IntentProvidesEdge,
  FunctionIncludeDefinition,
  FunctionNode,
  PreferredPinGroupDefinition,
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

const RESOLVER_VERSION = "0.3.0";

type ComponentContext = {
  node: ComponentNode;
  definition: ComponentDefinition;
};

type ReservedPin = {
  node: string;
  pin: string;
  edge: string;
  kind: "net.binding" | "provider.claim" | "resolved";
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

type FunctionResolutionRequest = {
  connectorEdge: IntentExposesEdge;
  definition: FunctionDefinition;
  functionNode: FunctionNode;
  providerEdge: IntentProvidesEdge;
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
  const boundPorts = new Map<string, BoundPort[]>();
  const dependencies = createResolvedDependencies(source.dependencies);
  const validEdges = collectUniqueEdges(source.edges, diagnostics);
  const canonicalSource = { ...source, edges: validEdges };
  const functionRequests = collectFunctionResolutionRequests(canonicalSource, diagnostics);
  const reservedPins = collectInitialReservations(validEdges, functionRequests, componentByNodeId, diagnostics);
  const context: ResolutionContext = {
    authoredPorts: collectAuthoredPortBindings(validEdges),
    diagnostics,
    boundPorts,
    nodeById,
    componentByNodeId,
    reservedPins
  };
  const resolvedChoices: ResolvedProject["resolvedChoices"] = [];
  const nets: ResolvedNet[] = [];
  const generated: ResolvedProject["generated"] = [];

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

    applyConnectionTopologyRules(edge, resolved, source.nodes, dependencies, generated, context);
  }

  const resolvedFunctions = resolveFunctions(
    canonicalSource,
    functionRequests,
    dependencies,
    generated,
    context
  );
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

function applyConnectionTopologyRules(
  edge: IntentConnectionEdge,
  resolved: ResolvedConnection,
  nodes: ProjectNode[],
  dependencies: Record<string, ResolvedDependency>,
  generated: ResolvedProject["generated"],
  context: ResolutionContext
) {
  const contract = contracts[edge.contract];
  const activeSignals = new Set(resolved.nets.map((net) => net.sourceMap.signal));

  for (const rule of contract?.topologyRules ?? []) {
    if (!edge.include?.[rule.include]) {
      continue;
    }

    recordGeneratedDependency(dependencies, rule.dependency, edge.id, rule.id);

    const rail = findPowerDomain(nodes, rule.rail);

    if (!rail) {
      context.diagnostics.push({
        severity: "error",
        code: rule.diagnostics.missingRail.code,
        message: rule.diagnostics.missingRail.message,
        targets: [{ kind: "edge", id: edge.id }]
      });
      continue;
    }

    for (const signal of rule.signals.filter((candidate) => activeSignals.has(candidate))) {
      generated.push(createConnectionTopologyComponent(edge.id, signal, rail.id, rule));
    }
  }
}

function recordGeneratedDependency(
  dependencies: Record<string, ResolvedDependency>,
  dependency: string,
  edge: string,
  feature: string
) {
  const dependencyVersion = packageVersions[dependency];
  const introducedBy = { edge, feature };
  const previousIntroduction = dependencies[dependency]?.introducedBy;

  dependencies[dependency] = {
    version: dependencyVersion,
    hash: stablePackageHash(dependency, dependencyVersion),
    introducedBy:
      !previousIntroduction || compareDependencyIntroduction(introducedBy, previousIntroduction) < 0
        ? introducedBy
        : previousIntroduction
  };
}

function compareDependencyIntroduction(
  left: NonNullable<ResolvedDependency["introducedBy"]>,
  right: NonNullable<ResolvedDependency["introducedBy"]>
) {
  return compareStableText(left.edge, right.edge) || compareStableText(left.feature, right.feature);
}

function createConnectionTopologyComponent(
  edgeId: string,
  signal: string,
  railId: string,
  rule: ConnectionTopologyRuleDefinition
): ResolvedProject["generated"][number] {
  return {
    id: `${rule.generatedIdPrefix}_${edgeId}_${signal}`,
    kind: "component",
    component: rule.component,
    value: rule.value,
    connects: [createNetId(edgeId, signal), railId],
    sourceEdge: edgeId,
    sourceMap: {
      edge: edgeId,
      feature: rule.id,
      signal
    }
  };
}

function sortIntentConnectionEdges(edges: IntentConnectionEdge[], context: ResolutionContext): IntentConnectionEdge[] {
  return edges
    .map((edge) => ({
      edge,
      score: connectionPinFlexibilityScore(edge, context)
    }))
    .sort(
      (left, right) =>
        left.score - right.score || compareStableText(left.edge.id, right.edge.id)
    )
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

  return Object.keys(signals).reduce((score, signal) => {
    const fromOverride = edge.bindings?.[signal]?.from;
    const toOverride = edge.bindings?.[signal]?.to;

    return (
      score +
      signalMapFlexibility(edge.from.node, from.definition, fromMap.signalMap[signal], fromOverride, context) +
      signalMapFlexibility(edge.to.node, to.definition, toMap.signalMap[signal], toOverride, context)
    );
  }, 0);
}

function signalMapFlexibility(
  nodeId: string,
  definition: ComponentDefinition,
  signalMap: SignalPinMap | undefined,
  override: EndpointRef | undefined,
  context: ResolutionContext
) {
  if (!signalMap) {
    return Number.MAX_SAFE_INTEGER / 4;
  }

  if (override?.pin) {
    return 1;
  }

  if ("pin" in signalMap) {
    return pinAvailableForAllocation(nodeId, signalMap.pin, context) ? 1 : 0;
  }

  return Object.entries(definition.pins).filter(
    ([pinId, pin]) =>
      signalMap.pinSelector.capabilities.every((capability) => pin.capabilities.includes(capability)) &&
      pinAvailableForAllocation(nodeId, pinId, context)
  ).length;
}

function pinAvailableForAllocation(nodeId: string, pin: string, context: ResolutionContext) {
  return !context.reservedPins.has(`${nodeId}.${pin}`);
}

function resolveFunctions(
  source: ProjectSource,
  functionRequests: FunctionResolutionRequest[],
  dependencies: Record<string, ResolvedDependency>,
  generated: ResolvedProject["generated"],
  context: ResolutionContext
): { choices: ResolvedProject["resolvedChoices"]; nets: ResolvedNet[] } {
  const choices: ResolvedProject["resolvedChoices"] = [];
  const nets: ResolvedNet[] = [];
  const requests = functionRequests
    .map((request) => ({
      request,
      score: functionProviderPinFlexibilityScore(request, context)
    }))
    .sort(
      (left, right) =>
        left.score - right.score || compareStableText(left.request.providerEdge.id, right.request.providerEdge.id)
    )
    .map(({ request }) => request);

  for (const { connectorEdge, definition, functionNode, providerEdge } of requests) {
    const resolvedProvider = resolveFunctionProvider(
      functionNode,
      definition,
      providerEdge,
      connectorEdge,
      context
    );

    if (resolvedProvider) {
      choices.push(resolvedProvider.choice);
      nets.push(
        ...applyFunctionInlineRules(
          functionNode,
          definition,
          providerEdge,
          resolvedProvider.nets,
          dependencies,
          generated,
          context
        )
      );
      reserveBindings(providerEdge.id, resolvedProvider.choice.selected.bindings, context.reservedPins);
    }

    nets.push(...resolveFunctionGeneratedNets(functionNode, definition, connectorEdge, source.nodes, context));
  }

  return { choices, nets };
}

function applyFunctionInlineRules(
  functionNode: FunctionNode,
  definition: FunctionDefinition,
  providerEdge: IntentProvidesEdge,
  resolvedNets: ResolvedNet[],
  dependencies: Record<string, ResolvedDependency>,
  generated: ResolvedProject["generated"],
  context: ResolutionContext
): ResolvedNet[] {
  const activeRules = (definition.topology.inlineRules ?? []).filter((rule) =>
    functionInlineRuleEnabled(functionNode, definition, rule)
  );
  const rulesBySignal = new Map<string, FunctionInlineRuleDefinition[]>();

  for (const rule of activeRules) {
    const inlineComponent = components[rule.component];

    if (!inlineComponent) {
      context.diagnostics.push({
        severity: "error",
        code: "INLINE_COMPONENT_NOT_FOUND",
        message: `Inline topology rule "${rule.id}" references unknown component "${rule.component}".`,
        targets: [{ kind: "edge", id: providerEdge.id }]
      });
      continue;
    }

    if (
      rule.pins.provider === rule.pins.connector ||
      !inlineComponent.pins[rule.pins.provider] ||
      !inlineComponent.pins[rule.pins.connector]
    ) {
      context.diagnostics.push({
        severity: "error",
        code: "INLINE_COMPONENT_TERMINALS_INVALID",
        message: `Inline topology rule "${rule.id}" requires distinct existing provider and connector pins on ${rule.component}.`,
        targets: [{ kind: "edge", id: providerEdge.id }]
      });
      continue;
    }

    const group = definition.signalGroups.find((candidate) => candidate.id === rule.signals.group);

    if (!group) {
      context.diagnostics.push({
        severity: "error",
        code: "INLINE_SIGNAL_GROUP_NOT_FOUND",
        message: `Inline topology rule "${rule.id}" references unknown signal group "${rule.signals.group}" on ${definition.id}.`,
        targets: [{ kind: "edge", id: providerEdge.id }]
      });
      continue;
    }

    for (const signal of group.signals) {
      const rules = rulesBySignal.get(signal.id) ?? [];
      rules.push(rule);
      rulesBySignal.set(signal.id, rules);
    }
  }

  const appliedRuleIds = new Set<string>();

  return resolvedNets.flatMap((net) => {
    const matchingRules = rulesBySignal.get(net.sourceMap.signal) ?? [];

    if (matchingRules.length === 0) {
      return [net];
    }

    if (matchingRules.length > 1) {
      context.diagnostics.push({
        severity: "error",
        code: "MULTIPLE_INLINE_INTERPOSERS",
        message: `Signal "${net.sourceMap.signal}" on edge "${providerEdge.id}" matches multiple inline topology rules: ${matchingRules.map((rule) => rule.id).join(", ")}.`,
        targets: [{ kind: "edge", id: providerEdge.id }]
      });
      return [net];
    }

    const rule = matchingRules[0];

    if (!rule) {
      return [net];
    }

    if (!appliedRuleIds.has(rule.id)) {
      recordGeneratedDependency(dependencies, rule.dependency, providerEdge.id, rule.id);
      appliedRuleIds.add(rule.id);
    }

    const componentId = `${rule.generatedIdPrefix}_${providerEdge.id}_${net.sourceMap.signal}`;
    const providerNetId = `${net.id}_provider`;
    const connectorNetId = `${net.id}_connector`;
    const providerNet: ResolvedNet = {
      ...net,
      id: providerNetId,
      name: `${net.name}_PROVIDER`,
      endpoints: {
        from: net.endpoints.from,
        to: { node: componentId, pin: rule.pins.provider }
      },
      sourceMap: {
        ...net.sourceMap,
        feature: rule.id,
        segment: "provider"
      }
    };
    const connectorNet: ResolvedNet = {
      ...net,
      id: connectorNetId,
      name: `${net.name}_CONNECTOR`,
      endpoints: {
        from: { node: componentId, pin: rule.pins.connector },
        to: net.endpoints.to
      },
      sourceMap: {
        ...net.sourceMap,
        feature: rule.id,
        segment: "connector"
      }
    };

    generated.push({
      id: componentId,
      kind: "component",
      component: rule.component,
      value: functionInlineRuleValue(functionNode, rule),
      connects: [providerNetId, connectorNetId],
      sourceEdge: providerEdge.id,
      placementHint: rule.placement
        ? {
            edge: providerEdge.id,
            near: rule.placement.near
          }
        : undefined,
      sourceMap: {
        edge: providerEdge.id,
        feature: rule.id,
        signal: net.sourceMap.signal
      }
    });

    return [providerNet, connectorNet];
  });
}

function functionInlineRuleEnabled(
  functionNode: FunctionNode,
  definition: FunctionDefinition,
  rule: FunctionInlineRuleDefinition
) {
  const includeValue = functionNode.include?.[rule.include];

  if (includeValue !== undefined && !isUnknownRecord(includeValue)) {
    return false;
  }

  const includeDefinition = definition.include[rule.include];
  const authoredValue = isUnknownRecord(includeValue)
    ? includeValue[rule.enabledWhen.field]
    : undefined;
  const defaultValue =
    includeDefinition?.kind === "object"
      ? includeDefinition.fields[rule.enabledWhen.field]?.default
      : undefined;
  const value = authoredValue ?? defaultValue;

  return rule.enabledWhen.values.some((candidate) => candidate === value);
}

function functionInlineRuleValue(functionNode: FunctionNode, rule: FunctionInlineRuleDefinition) {
  const includeValue = functionNode.include?.[rule.include];
  const authoredValue =
    isUnknownRecord(includeValue) && rule.value.includeField
      ? includeValue[rule.value.includeField]
      : undefined;

  return typeof authoredValue === "string" ? authoredValue : rule.value.default;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectFunctionResolutionRequests(
  source: ProjectSource,
  diagnostics: Diagnostic[]
): FunctionResolutionRequest[] {
  const requests: FunctionResolutionRequest[] = [];

  for (const functionNode of source.nodes) {
    if (functionNode.kind !== "intent.function") {
      continue;
    }

    const definition = functions[functionNode.function];

    if (!definition) {
      continue;
    }

    const contractId = definition.topology.contract;
    const providerEdges = source.edges.filter(
      (edge): edge is IntentProvidesEdge =>
        edge.kind === "intent.provides" && edge.to.node === functionNode.id && edge.contract === contractId
    );
    const connectorEdges = source.edges.filter(
      (edge): edge is IntentExposesEdge =>
        edge.kind === "intent.exposes" && edge.from.node === functionNode.id && edge.contract === contractId
    );

    if (providerEdges.length > 1) {
      diagnostics.push({
        severity: "error",
        code: "AMBIGUOUS_FUNCTION_PROVIDER",
        message: `Function "${functionNode.id}" has multiple providers for ${contractId}.`,
        targets: [
          { kind: "node", id: functionNode.id },
          ...providerEdges.map((edge) => ({ kind: "edge" as const, id: edge.id }))
        ]
      });
    }

    if (connectorEdges.length > 1) {
      diagnostics.push({
        severity: "error",
        code: "AMBIGUOUS_FUNCTION_EXPOSURE",
        message: `Function "${functionNode.id}" has multiple exposed endpoints for ${contractId}.`,
        targets: [
          { kind: "node", id: functionNode.id },
          ...connectorEdges.map((edge) => ({ kind: "edge" as const, id: edge.id }))
        ]
      });
    }

    const providerEdge = providerEdges.length === 1 ? providerEdges[0] : undefined;
    const connectorEdge = connectorEdges.length === 1 ? connectorEdges[0] : undefined;

    if (providerEdge && connectorEdge) {
      requests.push({ connectorEdge, definition, functionNode, providerEdge });
    }
  }

  return requests;
}

function functionProviderPinFlexibilityScore(
  request: FunctionResolutionRequest,
  context: ResolutionContext
): number {
  const { connectorEdge, definition, functionNode, providerEdge } = request;
  const provider = context.componentByNodeId.get(providerEdge.from.node);
  const connector = context.componentByNodeId.get(connectorEdge.to.node);

  if (!provider || !connector) {
    return Number.MAX_SAFE_INTEGER;
  }

  const mode = selectProviderMode(providerEdge, provider, definition);
  const connectorMap = connector.definition.ports[connectorEdge.to.port ?? ""]?.contractMaps?.[
    definition.topology.contract
  ];

  if (!mode || !connectorMap) {
    return Number.MAX_SAFE_INTEGER;
  }

  return functionSignalsForDefinition(functionNode, definition).reduce((score, signal) => {
    return (
      score +
      signalMapFlexibility(
        providerEdge.from.node,
        provider.definition,
        mode.mode.signalMap[signal],
        providerEdge.bindings?.[signal]?.from,
        context
      ) +
      signalMapFlexibility(
        connectorEdge.to.node,
        connector.definition,
        connectorMap.signalMap[signal],
        providerEdge.bindings?.[signal]?.to,
        context
      )
    );
  }, 0);
}

function collectValidatedFunctionPinClaims(
  request: FunctionResolutionRequest,
  componentByNodeId: Map<string, ComponentContext>
): EndpointRef[] {
  const { connectorEdge, definition, functionNode, providerEdge } = request;
  const provider = componentByNodeId.get(providerEdge.from.node);
  const connector = componentByNodeId.get(connectorEdge.to.node);

  if (!provider || !connector) {
    return [];
  }

  const mode = selectProviderMode(providerEdge, provider, definition);
  const connectorMap = connector.definition.ports[connectorEdge.to.port ?? ""]?.contractMaps?.[
    definition.topology.contract
  ];

  if (!mode || !connectorMap || connectorMap.role !== "to") {
    return [];
  }

  const claims: EndpointRef[] = [];
  const claimedPins = new Set<string>();

  for (const signal of functionSignalsForDefinition(functionNode, definition)) {
    const providerMap = mode.mode.signalMap[signal];
    const exposedMap = connectorMap.signalMap[signal];

    if (!providerMap || !exposedMap) {
      return [];
    }

    const providerClaim = validatedHardMappedEndpoint(
      providerEdge.from.node,
      provider.definition,
      providerMap,
      providerEdge.bindings?.[signal]?.from
    );
    const exposedClaim = validatedHardMappedEndpoint(
      connectorEdge.to.node,
      connector.definition,
      exposedMap,
      providerEdge.bindings?.[signal]?.to
    );

    if (!providerClaim.valid || !exposedClaim.valid) {
      return [];
    }

    for (const endpoint of [providerClaim.endpoint, exposedClaim.endpoint]) {
      if (!endpoint?.pin) {
        continue;
      }

      const key = pinKey(endpoint);

      if (claimedPins.has(key)) {
        return [];
      }

      claimedPins.add(key);
      claims.push(endpoint);
    }
  }

  return claims;
}

function validatedHardMappedEndpoint(
  nodeId: string,
  definition: ComponentDefinition,
  signalMap: SignalPinMap,
  override: EndpointRef | undefined
): { valid: boolean; endpoint?: EndpointRef } {
  if (override && override.node !== nodeId) {
    return { valid: false };
  }

  if ("pin" in signalMap && override?.pin && override.pin !== signalMap.pin) {
    return { valid: false };
  }

  const selectedPin = "pin" in signalMap ? signalMap.pin : override?.pin;

  if (!selectedPin) {
    return { valid: true };
  }

  if (!definition.pins[selectedPin]) {
    return { valid: false };
  }

  if (
    "pinSelector" in signalMap &&
    !pinSatisfiesCapabilities(definition, selectedPin, signalMap.pinSelector.capabilities)
  ) {
    return { valid: false };
  }

  return { valid: true, endpoint: { node: nodeId, pin: selectedPin } };
}

function resolveFunctionProvider(
  functionNode: FunctionNode,
  definition: FunctionDefinition,
  providerEdge: IntentProvidesEdge,
  connectorEdge: IntentExposesEdge,
  context: ResolutionContext
): ResolvedConnection | null {
  const provider = resolveComponentEndpoint(providerEdge.id, providerEdge.from, context);
  const connector = resolveComponentEndpoint(connectorEdge.id, connectorEdge.to, context);

  if (!provider || !connector) {
    return null;
  }

  const contractId = definition.topology.contract;
  const connectorMap = connector.definition.ports[connectorEdge.to.port ?? ""]?.contractMaps?.[contractId];
  const providerModeChoice = resolveProviderMode(providerEdge, provider, definition, context);

  if (!providerModeChoice) {
    return null;
  }

  if (!connectorMap || connectorMap.role !== "to") {
    context.diagnostics.push({
      severity: "error",
      code: "PORT_CONTRACT_MISMATCH",
      message: `${connectorEdge.to.node}.${connectorEdge.to.port ?? ""} does not support ${contractId} as the exposed endpoint.`,
      targets: [{ kind: "edge", id: connectorEdge.id }]
    });
    return null;
  }

  if (!checkProviderModeRequirements(providerEdge, providerModeChoice.mode, context)) {
    return null;
  }

  const signals = functionSignalsForDefinition(functionNode, definition);
  const localReservedPins = new Set<string>();
  const bindings: SignalBindings = {};

  for (const signal of signals) {
    const connectorSignalMap = connectorMap.signalMap[signal];
    const providerSignalMap = providerModeChoice.mode.signalMap[signal];

    if (!connectorSignalMap || !providerSignalMap) {
      context.diagnostics.push({
        severity: "error",
        code: "PORT_CONTRACT_MISMATCH",
        message: `${contractId} signal "${signal}" is not mapped by the selected provider or exposed port.`,
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
      reason: `Resolved enabled ${definition.id} signals using provider mode "${providerModeChoice.id}" and exposed pins.`
    },
    nets: Object.keys(bindings).map((signal) => createContractNet(contractId, signal, bindings, providerEdge.id))
  };
}

function resolveProviderMode(
  providerEdge: IntentProvidesEdge,
  provider: ComponentContext,
  functionDefinition: FunctionDefinition,
  context: ResolutionContext
): ResolvedProviderMode | null {
  const port = provider.definition.ports[providerEdge.from.port ?? ""];
  const provides = port?.provides?.[providerEdge.contract];
  const requestedMode = providerEdge.strategy?.providerMode ?? "auto";
  const selectedMode = selectProviderMode(providerEdge, provider, functionDefinition);

  if (selectedMode) {
    return selectedMode;
  }

  if (!provides || provides.role !== "provider") {
    context.diagnostics.push({
      severity: "error",
      code: "PORT_CONTRACT_MISMATCH",
      message: `${providerEdge.from.node}.${providerEdge.from.port ?? ""} does not provide ${providerEdge.contract}.`,
      targets: [{ kind: "edge", id: providerEdge.id }]
    });
    return null;
  }

  context.diagnostics.push({
    severity: "error",
    code: "PROVIDER_MODE_NOT_FOUND",
    message: `${providerEdge.from.node}.${providerEdge.from.port ?? ""} does not expose provider mode "${requestedMode}" for ${providerEdge.contract}.`,
    targets: [{ kind: "edge", id: providerEdge.id }]
  });
  return null;
}

function selectProviderMode(
  providerEdge: IntentProvidesEdge,
  provider: ComponentContext,
  functionDefinition: FunctionDefinition
): ResolvedProviderMode | null {
  const port = provider.definition.ports[providerEdge.from.port ?? ""];
  const provides = port?.provides?.[providerEdge.contract];
  const genericProvider = functionDefinition.topology.genericProvider;
  const requestedMode = providerEdge.strategy?.providerMode ?? "auto";

  if (
    !provides &&
    port?.kind === "pin_pool" &&
    providerEdge.contract === functionDefinition.topology.contract &&
    genericProvider &&
    genericProvider.pinCapabilities.every((capability) => port.pinCapabilities?.includes(capability)) &&
    (requestedMode === "auto" || requestedMode === genericProvider.modeId)
  ) {
    const signalMap = Object.fromEntries(
      functionDefinition.signalGroups.flatMap((group) =>
        group.signals.map((signal) => [
          signal.id,
          { pinSelector: { capabilities: genericProvider.pinCapabilities } }
        ])
      )
    );

    return {
      id: genericProvider.modeId,
      mode: {
        label: genericProvider.label,
        signalMap
      }
    };
  }

  if (!provides || provides.role !== "provider") {
    return null;
  }

  const fallbackMode = requestedMode === "auto" ? Object.entries(provides.modes)[0] : undefined;
  const modeEntry = provides.modes[requestedMode]
    ? ([requestedMode, provides.modes[requestedMode]] as const)
    : fallbackMode;

  return modeEntry ? { id: modeEntry[0], mode: modeEntry[1] } : null;
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

function resolveFunctionGeneratedNets(
  functionNode: FunctionNode,
  definition: FunctionDefinition,
  connectorEdge: IntentExposesEdge,
  nodes: ProjectNode[],
  context: ResolutionContext
): ResolvedNet[] {
  const nets: ResolvedNet[] = [];

  for (const generatedNet of definition.topology.generatedNets ?? []) {
    if (
      generatedNet.include &&
      !functionSignalGroupEnabled(functionNode, generatedNet.include, definition.include[generatedNet.include])
    ) {
      continue;
    }

    const from = findPowerDomain(nodes, generatedNet.from);

    if (!from) {
      context.diagnostics.push({
        severity: "error",
        code: generatedNet.diagnostics.missingFrom.code,
        message: generatedNet.diagnostics.missingFrom.message,
        targets: [{ kind: "node", id: functionNode.id }]
      });
      continue;
    }

    const exposedComponent = context.componentByNodeId.get(connectorEdge.to.node);

    if (!exposedComponent?.definition.pins[generatedNet.to.pin]) {
      context.diagnostics.push({
        severity: "error",
        code: generatedNet.diagnostics.missingTo.code,
        message: generatedNet.diagnostics.missingTo.message,
        targets: [{ kind: "edge", id: connectorEdge.id }]
      });
      continue;
    }

    nets.push({
      id: `net_${functionNode.id}_${generatedNet.id}`,
      name: generatedNet.name,
      endpoints: {
        from: { node: from.id },
        to: { node: connectorEdge.to.node, pin: generatedNet.to.pin }
      },
      direction: generatedNet.direction,
      sourceEdge: connectorEdge.id,
      sourceMap: {
        edge: connectorEdge.id,
        signal: generatedNet.id
      }
    });
  }

  return nets;
}

function findPowerDomain(
  nodes: ProjectNode[],
  selector: { role?: string; voltage?: string }
): PowerDomainNode | null {
  return (
    nodes.find(
      (node): node is PowerDomainNode =>
        node.kind === "powerDomain" &&
        Boolean(
          (selector.role && node.role === selector.role) ||
          (selector.voltage && node.voltage === selector.voltage)
        )
    ) ?? null
  );
}

function functionSignalsForDefinition(functionNode: FunctionNode, definition: FunctionDefinition) {
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
  const pin = Object.entries(definition.pins)
    .filter(
      ([pinId, candidate]) =>
        capabilities.every((capability) => candidate.capabilities.includes(capability)) &&
        !context.reservedPins.has(`${nodeId}.${pinId}`) &&
        !localReservedPins.has(`${nodeId}.${pinId}`)
    )
    .map(([pinId, candidate]) => ({
      id: pinId,
      scarcityPenalty: pinScarcityPenalty(definition, candidate.capabilities, capabilities)
    }))
    .sort(
      (left, right) =>
        left.scarcityPenalty - right.scarcityPenalty || compareStableText(left.id, right.id)
    )[0];

  return pin?.id;
}

function pinScarcityPenalty(
  definition: ComponentDefinition,
  candidateCapabilities: string[],
  requiredCapabilities: string[]
) {
  const required = new Set(requiredCapabilities);

  return [...new Set(candidateCapabilities)]
    .filter((capability) => !required.has(capability))
    .reduce((penalty, capability) => {
      const compatiblePinCount = Object.values(definition.pins).filter((pin) =>
        pin.capabilities.includes(capability)
      ).length;

      return penalty + Math.ceil(1_000_000 / Math.max(compatiblePinCount, 1));
    }, 0);
}

function compareStableText(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  const leftParts = left.match(/\d+|\D+/g) ?? [left];
  const rightParts = right.match(/\d+|\D+/g) ?? [right];
  const length = Math.min(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "";
    const rightPart = rightParts[index] ?? "";

    if (leftPart === rightPart) {
      continue;
    }

    const leftIsNumber = /^\d+$/.test(leftPart);
    const rightIsNumber = /^\d+$/.test(rightPart);

    if (leftIsNumber && rightIsNumber) {
      const leftNumber = leftPart.replace(/^0+(?=\d)/, "");
      const rightNumber = rightPart.replace(/^0+(?=\d)/, "");

      if (leftNumber.length !== rightNumber.length) {
        return leftNumber.length - rightNumber.length;
      }

      if (leftNumber !== rightNumber) {
        return leftNumber < rightNumber ? -1 : 1;
      }
    }

    return leftPart < rightPart ? -1 : 1;
  }

  return leftParts.length - rightParts.length || (left < right ? -1 : 1);
}

function resolveMappedEndpoint(
  edgeId: string,
  signal: string,
  nodeId: string,
  definition: ComponentDefinition,
  signalMap: SignalPinMap,
  override: EndpointRef | undefined,
  context: ResolutionContext,
  localReservedPins: Set<string>,
  suggestions?: Diagnostic["suggestions"]
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
      suggestions
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
      ],
      suggestions
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
      ],
      suggestions
    });
    return null;
  }

  const endpoint = { node: nodeId, pin: selectedPin };
  const endpointKey = pinKey(endpoint);
  const reserved = context.reservedPins.get(endpointKey);

  if (reserved && reserved.edge !== edgeId) {
    context.diagnostics.push({
      severity: "error",
      code: "PIN_CONFLICT",
      message: `${reserved.node}.${reserved.pin} is already reserved by ${reserved.edge}.`,
      targets: [
        { kind: "edge", id: edgeId },
        { kind: "pin", node: reserved.node, pin: reserved.pin }
      ],
      suggestions
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
      ],
      suggestions
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
  const prefix = contracts[contractId]?.netNamePrefix;

  return `${prefix ?? contractId.replaceAll(/[^A-Z0-9]+/gi, "_").toUpperCase()}_${signal.toUpperCase()}`;
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
  const preferredBindings = resolvePreferredPinGroupBindings(
    edge,
    signals,
    from,
    to,
    fromMap,
    toMap,
    context.reservedPins
  );

  if (preferredBindings !== undefined) {
    return preferredBindings;
  }

  const fromSuggestions = createPreferredPinGroupSuggestions(
    edge,
    signals,
    "from",
    from,
    fromMap,
    context.reservedPins
  );
  const toSuggestions = createPreferredPinGroupSuggestions(
    edge,
    signals,
    "to",
    to,
    toMap,
    context.reservedPins
  );
  const localReservedPins = new Set<string>();
  const allocatedBindings: SignalBindings = {};
  const signalIds = Object.keys(signals);
  const signalsByConstraint = signalIds
    .map((signal) => ({
      signal,
      score:
        signalMapFlexibility(
          edge.from.node,
          from.definition,
          fromMap.signalMap[signal],
          edge.bindings?.[signal]?.from,
          context
        ) +
        signalMapFlexibility(
          edge.to.node,
          to.definition,
          toMap.signalMap[signal],
          edge.bindings?.[signal]?.to,
          context
        )
    }))
    .sort(
      (left, right) =>
        left.score - right.score || compareStableText(left.signal, right.signal)
    );

  for (const { signal } of signalsByConstraint) {
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
      localReservedPins,
      fromSuggestions
    );
    const toEndpoint = resolveMappedEndpoint(
      edge.id,
      signal,
      edge.to.node,
      to.definition,
      toSignalMap,
      edge.bindings?.[signal]?.to,
      context,
      localReservedPins,
      toSuggestions
    );

    if (!fromEndpoint || !toEndpoint) {
      return null;
    }

    allocatedBindings[signal] = {
      from: fromEndpoint,
      to: toEndpoint
    };
  }

  return Object.fromEntries(signalIds.map((signal) => [signal, allocatedBindings[signal]]));
}

function resolvePreferredPinGroupBindings(
  edge: IntentConnectionEdge,
  signals: Record<string, ContractSignal>,
  from: ComponentContext,
  to: ComponentContext,
  fromMap: PortContractMap,
  toMap: PortContractMap,
  reservedPins: Map<string, ReservedPin>
): SignalBindings | undefined {
  const groups = matchingPreferredPinGroups(from.definition, edge.contract, edge.from.port);

  if (edge.strategy?.pinAssignment === "manual" || edge.bindings || groups.length === 0) {
    return undefined;
  }

  for (const group of groups) {
    const bindings = createPreferredPinGroupBindings(edge, signals, group, from, to, fromMap, toMap);

    if (!bindings) {
      continue;
    }

    if (bindingPinsAvailable(bindings, reservedPins)) {
      return bindings;
    }
  }

  return undefined;
}

function createPreferredPinGroupSuggestions(
  edge: IntentConnectionEdge,
  signals: Record<string, ContractSignal>,
  role: EndpointRole,
  component: ComponentContext,
  portMap: PortContractMap,
  reservedPins: Map<string, ReservedPin>
): Diagnostic["suggestions"] {
  const endpoint = edge[role];
  const groups = matchingPreferredPinGroups(component.definition, edge.contract, endpoint.port);
  const suggestions = groups.flatMap((group) => {
    if (!group.suggestion) {
      return [];
    }

    const bindings: SignalBindings = Object.fromEntries(
      Object.entries(edge.bindings ?? {}).map(([signal, binding]) => [signal, { ...binding }])
    );

    for (const signal of Object.keys(signals)) {
      const pin = group.pins[signal];
      const signalMap = portMap.signalMap[signal];

      if (!pin || !signalMap || !pinSatisfiesSignalMap(component.definition, pin, signalMap)) {
        return [];
      }

      bindings[signal] = {
        ...bindings[signal],
        [role]: { node: endpoint.node, pin }
      };
    }

    if (!bindingPinsAvailable(bindings, reservedPins)) {
      return [];
    }

    return [
      {
        title: group.suggestion.title,
        patch: {
          op: "setEdgeBindings" as const,
          edge: edge.id,
          value: bindings
        }
      }
    ];
  });

  return suggestions.length > 0 ? suggestions : undefined;
}

function matchingPreferredPinGroups(
  definition: ComponentDefinition,
  contract: string,
  port: string | undefined
) {
  return (definition.preferredPinGroups ?? []).filter(
    (group) => group.contract === contract && (group.port === undefined || group.port === port)
  );
}

function pinSatisfiesSignalMap(definition: ComponentDefinition, pin: string, signalMap: SignalPinMap) {
  return "pin" in signalMap
    ? definition.pins[pin] !== undefined && signalMap.pin === pin
    : pinSatisfiesCapabilities(definition, pin, signalMap.pinSelector.capabilities);
}

function createPreferredPinGroupBindings(
  edge: IntentConnectionEdge,
  signals: Record<string, ContractSignal>,
  group: PreferredPinGroupDefinition,
  from: ComponentContext,
  to: ComponentContext,
  fromMap: PortContractMap,
  toMap: PortContractMap
): SignalBindings | null {
  const bindings: SignalBindings = {};

  for (const signal of Object.keys(signals)) {
    const fromPin = group.pins[signal];
    const fromSignalMap = fromMap.signalMap[signal];
    const toSignalMap = toMap.signalMap[signal];
    const toPin = toSignalMap && "pin" in toSignalMap ? toSignalMap.pin : undefined;

    if (
      !fromPin ||
      !toPin ||
      !from.definition.pins[fromPin] ||
      !to.definition.pins[toPin] ||
      !fromSignalMap ||
      !("pinSelector" in fromSignalMap) ||
      !pinSatisfiesCapabilities(from.definition, fromPin, fromSignalMap.pinSelector.capabilities)
    ) {
      return null;
    }

    bindings[signal] = {
      from: { node: edge.from.node, pin: fromPin },
      to: { node: edge.to.node, pin: toPin }
    };
  }

  return bindings;
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

function collectUniqueEdges(edges: ProjectEdge[], diagnostics: Diagnostic[]): ProjectEdge[] {
  const edgesById = new Map<string, ProjectEdge[]>();

  for (const edge of edges) {
    const matches = edgesById.get(edge.id) ?? [];
    matches.push(edge);
    edgesById.set(edge.id, matches);
  }

  const validEdges: ProjectEdge[] = [];

  for (const [edgeId, matches] of [...edgesById.entries()].sort(([left], [right]) => compareStableText(left, right))) {
    if (matches.length > 1) {
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_EDGE_ID",
        message: `Edge id "${edgeId}" is used more than once; all occurrences were ignored.`,
        targets: [{ kind: "edge", id: edgeId }]
      });
      continue;
    }

    const edge = matches[0];

    if (edge) {
      validEdges.push(edge);
    }
  }

  return validEdges;
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

function collectInitialReservations(
  edges: ProjectEdge[],
  functionRequests: FunctionResolutionRequest[],
  componentByNodeId: Map<string, ComponentContext>,
  diagnostics: Diagnostic[]
): Map<string, ReservedPin> {
  const reservedPins = new Map<string, ReservedPin>();

  for (const edge of edges) {
    if (edge.kind === "net.binding") {
      for (const binding of Object.values(edge.bindings)) {
        for (const endpoint of Object.values(binding)) {
          if (!endpoint?.pin) {
            continue;
          }

          const key = pinKey(endpoint);
          const reserved = reservedPins.get(key);

          if (reserved && reserved.edge !== edge.id) {
            diagnostics.push({
              severity: "error",
              code: "PIN_RESERVATION_CONFLICT",
              message: `${endpoint.node}.${endpoint.pin} is reserved by both ${reserved.edge} and ${edge.id}; ${reserved.edge} keeps deterministic priority.`,
              targets: [
                { kind: "edge", id: reserved.edge },
                { kind: "edge", id: edge.id },
                { kind: "pin", node: endpoint.node, pin: endpoint.pin }
              ]
            });
            continue;
          }

          reservedPins.set(key, {
            node: endpoint.node,
            pin: endpoint.pin,
            edge: edge.id,
            kind: "net.binding"
          });
        }
      }
    }
  }

  for (const request of [...functionRequests].sort((left, right) =>
    compareStableText(left.providerEdge.id, right.providerEdge.id)
  )) {
    const claims = collectValidatedFunctionPinClaims(request, componentByNodeId);

    for (const endpoint of claims) {
      if (!endpoint.pin) {
        continue;
      }

      const key = pinKey(endpoint);
      const reserved = reservedPins.get(key);

      if (reserved) {
        if (reserved.kind === "provider.claim" && reserved.edge !== request.providerEdge.id) {
          diagnostics.push({
            severity: "error",
            code: "PIN_PROVIDER_CLAIM_CONFLICT",
            message: `${endpoint.node}.${endpoint.pin} is claimed by both ${reserved.edge} and ${request.providerEdge.id}; ${reserved.edge} keeps deterministic priority.`,
            targets: [
              { kind: "edge", id: reserved.edge },
              { kind: "edge", id: request.providerEdge.id },
              { kind: "pin", node: endpoint.node, pin: endpoint.pin }
            ]
          });
        }
        continue;
      }

      reservedPins.set(key, {
        node: endpoint.node,
        pin: endpoint.pin,
        edge: request.providerEdge.id,
        kind: "provider.claim"
      });
    }
  }

  return reservedPins;
}

function reserveBindings(
  edgeId: string,
  bindings: SignalBindings,
  reservedPins: Map<string, ReservedPin>
) {
  for (const binding of Object.values(bindings)) {
    for (const endpoint of Object.values(binding)) {
      if (!endpoint?.pin) {
        continue;
      }

      const key = pinKey(endpoint);

      reservedPins.set(key, {
        node: endpoint.node,
        pin: endpoint.pin,
        edge: edgeId,
        kind: "resolved"
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
