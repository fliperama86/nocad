import type {
  AuthoredNetEdge,
  ComponentDefinition,
  ComponentNode,
  ConnectionContract,
  ConnectionTopologyRuleDefinition,
  ContractParams,
  ContractSignal,
  Diagnostic,
  DiagnosticTarget,
  EndpointRole,
  EndpointRef,
  FunctionDefinition,
  FunctionInlineRuleDefinition,
  IntentConnectionEdge,
  IntentExposesEdge,
  IntentProvidesEdge,
  FunctionIncludeDefinition,
  FunctionNode,
  NetRealizationRef,
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
  ResolutionEnvironment,
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
  kind: "net.authored" | "net.binding" | "provider.claim" | "resolved";
  realizes?: NetRealizationRef;
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
  environment: ResolutionEnvironment;
  reservedPins: Map<string, ReservedPin>;
};

export function resolveProject(source: ProjectSource, environment: ResolutionEnvironment): ResolvedProject {
  const diagnostics: Diagnostic[] = [];
  const nodeById = indexNodes(source.nodes, diagnostics);
  const componentByNodeId = indexComponentContexts(
    source.nodes,
    environment.catalog.components,
    diagnostics
  );
  const boundPorts = new Map<string, BoundPort[]>();
  const dependencies = createResolvedDependencies(source.dependencies, environment, diagnostics);
  const validEdges = collectUniqueEdges(source.edges, diagnostics);
  const canonicalSource = { ...source, edges: validEdges };
  const functionRequests = collectFunctionResolutionRequests(
    canonicalSource,
    environment.catalog.functions,
    diagnostics
  );
  const authoredNets = resolveAuthoredNets(validEdges, nodeById, componentByNodeId, diagnostics);
  const reservedPins = collectInitialReservations(
    validEdges,
    functionRequests,
    componentByNodeId,
    diagnostics,
    authoredNets.reservations
  );
  const context: ResolutionContext = {
    authoredPorts: collectAuthoredPortBindings(validEdges),
    diagnostics,
    boundPorts,
    nodeById,
    componentByNodeId,
    environment,
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
  const substitutedGenerated = substituteGeneratedComponents(
    validEdges,
    componentByNodeId,
    nets,
    generated,
    diagnostics
  );
  const reconciledNets = reconcileAuthoredNetRealizations(
    authoredNets.nets,
    substitutedGenerated.nets,
    diagnostics
  );

  return {
    schema: "nocad.lock.v0",
    sourceSet: environment.sourceSet(source),
    resolver: {
      name: "nocad-resolver",
      version: RESOLVER_VERSION
    },
    dependencies,
    resolvedChoices,
    nets: reconciledNets.nets,
    generated: substitutedGenerated.generated.map((object) => ({
      ...object,
      connects: object.connects.map((connection) => reconciledNets.replacements.get(connection) ?? connection)
    })),
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
  const contract = context.environment.catalog.contracts[edge.contract];
  const activeSignals = new Set(resolved.nets.map((net) => net.sourceMap.signal));

  for (const rule of contract?.topologyRules ?? []) {
    if (!edge.include?.[rule.include]) {
      continue;
    }

    if (!recordGeneratedDependency(dependencies, rule.dependency, edge.id, rule.id, context)) {
      continue;
    }

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
  feature: string,
  context: ResolutionContext
) {
  const resolved = dependencies[dependency] ?? context.environment.resolveDependency(dependency);

  if (!resolved) {
    context.diagnostics.push({
      severity: "error",
      code: "GENERATED_DEPENDENCY_NOT_FOUND",
      message: `Generated topology feature "${feature}" requires unavailable dependency "${dependency}".`,
      targets: [{ kind: "edge", id: edge }]
    });
    return false;
  }

  const introducedBy = { edge, feature };
  const previousIntroduction = dependencies[dependency]?.introducedBy;

  dependencies[dependency] = {
    version: resolved.version,
    hash: resolved.hash,
    introducedBy:
      !previousIntroduction || compareDependencyIntroduction(introducedBy, previousIntroduction) < 0
        ? introducedBy
        : previousIntroduction
  };

  return true;
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
  const contract = context.environment.catalog.contracts[edge.contract];
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
      signalMapFlexibility(edge.from.node, from.definition, fromMap.signalMap[signal], fromOverride, context, {
        edge: edge.id,
        signal
      }) +
      signalMapFlexibility(edge.to.node, to.definition, toMap.signalMap[signal], toOverride, context, {
        edge: edge.id,
        signal
      })
    );
  }, 0);
}

function signalMapFlexibility(
  nodeId: string,
  definition: ComponentDefinition,
  signalMap: SignalPinMap | undefined,
  override: EndpointRef | undefined,
  context: ResolutionContext,
  owner: NetRealizationRef
) {
  if (!signalMap) {
    return Number.MAX_SAFE_INTEGER / 4;
  }

  if (override?.pin) {
    return 1;
  }

  if ("pin" in signalMap) {
    return pinAvailableForAllocation(nodeId, signalMap.pin, context, owner) ? 1 : 0;
  }

  return Object.entries(definition.pins).filter(
    ([pinId, pin]) =>
      signalMap.pinSelector.capabilities.every((capability) => pin.capabilities.includes(capability)) &&
      pinAvailableForAllocation(nodeId, pinId, context, owner)
  ).length;
}

function pinAvailableForAllocation(
  nodeId: string,
  pin: string,
  context: ResolutionContext,
  owner: NetRealizationRef
) {
  const reservation = context.reservedPins.get(`${nodeId}.${pin}`);
  return !reservation || reservationMatchesRealization(reservation, owner.edge, owner.signal);
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
    const inlineComponent = context.environment.catalog.components[rule.component];

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
      if (!recordGeneratedDependency(
        dependencies,
        rule.dependency,
        providerEdge.id,
        rule.id,
        context
      )) {
        return [net];
      }
      appliedRuleIds.add(rule.id);
    }

    const componentId = `${rule.generatedIdPrefix}_${providerEdge.id}_${net.sourceMap.signal}`;
    const providerNetId = `${net.id}_provider`;
    const connectorNetId = `${net.id}_connector`;
    const providerNet: ResolvedNet = {
      ...net,
      id: providerNetId,
      name: `${net.name}_PROVIDER`,
      endpoints: [requiredEndpoint(net, 0), { node: componentId, pin: rule.pins.provider }],
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
      endpoints: [{ node: componentId, pin: rule.pins.connector }, requiredEndpoint(net, 1)],
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
  functionDefinitions: ResolutionEnvironment["catalog"]["functions"],
  diagnostics: Diagnostic[]
): FunctionResolutionRequest[] {
  const requests: FunctionResolutionRequest[] = [];

  for (const functionNode of source.nodes) {
    if (functionNode.kind !== "intent.function") {
      continue;
    }

    const definition = functionDefinitions[functionNode.function];

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
        context,
        { edge: providerEdge.id, signal }
      ) +
      signalMapFlexibility(
        connectorEdge.to.node,
        connector.definition,
        connectorMap.signalMap[signal],
        providerEdge.bindings?.[signal]?.to,
        context,
        { edge: providerEdge.id, signal }
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
  const contract = context.environment.catalog.contracts[contractId];
  const connectorMap = connector.definition.ports[connectorEdge.to.port ?? ""]?.contractMaps?.[contractId];
  const providerModeChoice = resolveProviderMode(providerEdge, provider, definition, context);

  if (!contract || !providerModeChoice) {
    if (!contract) {
      context.diagnostics.push({
        severity: "error",
        code: "UNKNOWN_CONTRACT",
        message: `Unknown contract "${contractId}".`,
        targets: [{ kind: "edge", id: providerEdge.id }]
      });
    }
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
    nets: Object.keys(bindings).map((signal) => createContractNet(contract, signal, bindings, providerEdge.id))
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
      boardKind: generatedNet.boardKind,
      id: `net_${functionNode.id}_${generatedNet.id}`,
      name: generatedNet.name,
      endpoints: [{ node: from.id }, { node: connectorEdge.to.node, pin: generatedNet.to.pin }],
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
  localReservedPins: Set<string>,
  owner: NetRealizationRef
) {
  const pin = Object.entries(definition.pins)
    .filter(
      ([pinId, candidate]) =>
        capabilities.every((capability) => candidate.capabilities.includes(capability)) &&
        pinAvailableForAllocation(nodeId, pinId, context, owner) &&
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
        chooseAvailablePin(
          nodeId,
          definition,
          signalMap.pinSelector.capabilities,
          context,
          localReservedPins,
          { edge: edgeId, signal }
        ));

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

  if (reserved && reserved.edge !== edgeId && !reservationMatchesRealization(reserved, edgeId, signal)) {
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

function createContractNet(
  contract: ConnectionContract,
  signal: string,
  bindings: SignalBindings,
  edgeId: string
): ResolvedNet {
  const binding = bindings[signal];
  const from = binding?.from;
  const to = binding?.to;
  const contractSignal = contract.signals[signal] as ContractSignal | undefined;

  if (!from?.pin || !to?.pin || !contractSignal) {
    throw new Error(`Resolved ${contract.id} ${signal} binding is incomplete.`);
  }

  return {
    boardKind: contractSignal.boardKind,
    id: createNetId(edgeId, signal),
    name: formatNetName(contract, signal),
    endpoints: [from, to],
    direction: contractSignal.direction,
    sourceEdge: edgeId,
    sourceMap: {
      edge: edgeId,
      signal
    }
  };
}

function formatNetName(contract: ConnectionContract, signal: string): string {
  const prefix = contract.netNamePrefix;

  return `${prefix ?? contract.id.replaceAll(/[^A-Z0-9]+/gi, "_").toUpperCase()}_${signal.toUpperCase()}`;
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

  const contract = context.environment.catalog.contracts[edge.contract];

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
    nets: Object.keys(signals).map((signal) => createContractNet(contract, signal, bindings, edge.id))
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
          context,
          { edge: edge.id, signal }
        ) +
        signalMapFlexibility(
          edge.to.node,
          to.definition,
          toMap.signalMap[signal],
          edge.bindings?.[signal]?.to,
          context,
          { edge: edge.id, signal }
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

    if (bindingPinsAvailable(bindings, reservedPins, edge.id)) {
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

    if (!bindingPinsAvailable(bindings, reservedPins, edge.id)) {
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

function bindingPinsAvailable(
  bindings: SignalBindings,
  reservedPins: Map<string, ReservedPin>,
  edgeId: string
): boolean {
  const localReservedPins = new Set<string>();

  for (const [signal, binding] of Object.entries(bindings)) {
    for (const endpoint of Object.values(binding)) {
      if (!endpoint?.pin) {
        continue;
      }

      const key = pinKey(endpoint);

      const reservation = reservedPins.get(key);
      if ((reservation && !reservationMatchesRealization(reservation, edgeId, signal)) || localReservedPins.has(key)) {
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

function requiredEndpoint(net: ResolvedNet, index: number): EndpointRef {
  const endpoint = net.endpoints[index];
  if (!endpoint) throw new Error(`Resolved net "${net.id}" is missing endpoint ${index}.`);
  return endpoint;
}

function resolveAuthoredNets(
  edges: ProjectEdge[],
  nodeById: Map<string, ProjectNode>,
  componentByNodeId: Map<string, ComponentContext>,
  diagnostics: Diagnostic[]
): { nets: ResolvedNet[]; reservations: Map<string, ReservedPin> } {
  const candidates: Array<{ edge: AuthoredNetEdge; endpoints: EndpointRef[] }> = [];

  for (const edge of edges) {
    if (edge.kind !== "net.authored") continue;

    if (typeof edge.name !== "string" || edge.name.trim().length === 0) {
      diagnostics.push({
        severity: "error",
        code: "AUTHORED_NET_NAME_INVALID",
        message: `Authored net "${edge.id}" requires a non-empty name.`,
        targets: [{ kind: "edge", id: edge.id }]
      });
      continue;
    }

    if (!Array.isArray(edge.endpoints) || edge.endpoints.length < 2) {
      diagnostics.push({
        severity: "error",
        code: "AUTHORED_NET_ENDPOINT_COUNT_INVALID",
        message: `Authored net "${edge.id}" requires at least two endpoints.`,
        targets: [{ kind: "edge", id: edge.id }]
      });
      continue;
    }

    if (
      edge.realizes !== undefined &&
      (typeof edge.realizes !== "object" ||
        typeof edge.realizes.edge !== "string" ||
        edge.realizes.edge.length === 0 ||
        typeof edge.realizes.signal !== "string" ||
        edge.realizes.signal.length === 0 ||
        (edge.realizes.feature !== undefined &&
          (typeof edge.realizes.feature !== "string" || edge.realizes.feature.length === 0)) ||
        (edge.realizes.segment !== undefined &&
          edge.realizes.segment !== "connector" &&
          edge.realizes.segment !== "provider"))
    ) {
      diagnostics.push({
        severity: "error",
        code: "AUTHORED_NET_REALIZATION_INVALID",
        message: `Authored net "${edge.id}" has an invalid realization link.`,
        targets: [{ kind: "edge", id: edge.id }]
      });
      continue;
    }

    if (edge.realizes) {
      const realizedEdge = edges.find(({ id }) => id === edge.realizes?.edge);
      if (
        !realizedEdge ||
        (realizedEdge.kind !== "intent.connection" &&
          realizedEdge.kind !== "intent.provides" &&
          realizedEdge.kind !== "intent.exposes")
      ) {
        diagnostics.push({
          severity: "error",
          code: "AUTHORED_NET_REALIZATION_INVALID",
          message: `Authored net "${edge.id}" realizes missing or unsupported intent edge "${edge.realizes.edge}".`,
          targets: [{ kind: "edge", id: edge.id }, { kind: "edge", id: edge.realizes.edge }]
        });
        continue;
      }
    }

    const endpoints = [...edge.endpoints].sort(compareEndpoint);
    const duplicate = endpoints.find((endpoint, index) => index > 0 && endpointKey(endpoint) === endpointKey(endpoints[index - 1]!));
    if (duplicate) {
      diagnostics.push({
        severity: "error",
        code: "AUTHORED_NET_ENDPOINT_DUPLICATE",
        message: `Authored net "${edge.id}" repeats endpoint "${formatEndpoint(duplicate)}".`,
        targets: [
          { kind: "edge", id: edge.id },
          ...(duplicate.pin ? [{ kind: "pin" as const, node: duplicate.node, pin: duplicate.pin }] : [])
        ]
      });
      continue;
    }

    let valid = true;
    for (const endpoint of endpoints) {
      const node = nodeById.get(endpoint.node);
      if (!node) {
        diagnostics.push({
          severity: "error",
          code: "AUTHORED_NET_NODE_NOT_FOUND",
          message: `Authored net "${edge.id}" references missing node "${endpoint.node}".`,
          targets: [{ kind: "edge", id: edge.id }, { kind: "node", id: endpoint.node }]
        });
        valid = false;
        continue;
      }

      if (node.kind === "powerDomain") {
        if (endpoint.pin !== undefined || endpoint.port !== undefined) {
          diagnostics.push({
            severity: "error",
            code: "AUTHORED_NET_ENDPOINT_INVALID",
            message: `Power-domain endpoint "${endpoint.node}" on authored net "${edge.id}" must not select a pin or port.`,
            targets: [{ kind: "edge", id: edge.id }, { kind: "node", id: endpoint.node }]
          });
          valid = false;
        }
        continue;
      }

      if (node.kind !== "component" || endpoint.port !== undefined || !endpoint.pin) {
        diagnostics.push({
          severity: "error",
          code: "AUTHORED_NET_ENDPOINT_INVALID",
          message: `Authored net "${edge.id}" must connect component nodes by pin or a bare power-domain node.`,
          targets: [{ kind: "edge", id: edge.id }, { kind: "node", id: endpoint.node }]
        });
        valid = false;
        continue;
      }

      const component = componentByNodeId.get(endpoint.node);
      if (!component?.definition.pins[endpoint.pin]) {
        diagnostics.push({
          severity: "error",
          code: "AUTHORED_NET_PIN_NOT_FOUND",
          message: `Authored net "${edge.id}" references missing pin "${endpoint.node}.${endpoint.pin}".`,
          targets: [
            { kind: "edge", id: edge.id },
            { kind: "pin", node: endpoint.node, pin: endpoint.pin }
          ]
        });
        valid = false;
      }
    }

    if (valid) candidates.push({ edge, endpoints });
  }

  const ownersByPin = new Map<string, Array<{ edge: AuthoredNetEdge; endpoint: EndpointRef }>>();
  for (const candidate of candidates) {
    for (const endpoint of candidate.endpoints) {
      if (!endpoint.pin) continue;
      const key = pinKey(endpoint);
      const owners = ownersByPin.get(key) ?? [];
      owners.push({ edge: candidate.edge, endpoint });
      ownersByPin.set(key, owners);
    }
  }

  const conflictedEdges = new Set<string>();
  for (const [, owners] of [...ownersByPin.entries()].sort(([left], [right]) => compareStableText(left, right))) {
    const edgeIds = [...new Set(owners.map(({ edge }) => edge.id))].sort(compareStableText);
    if (edgeIds.length < 2) continue;
    const endpoint = owners[0]?.endpoint;
    if (!endpoint?.pin) continue;
    edgeIds.forEach((edgeId) => conflictedEdges.add(edgeId));
    diagnostics.push({
      severity: "error",
      code: "AUTHORED_NET_PIN_CONFLICT",
      message: `${endpoint.node}.${endpoint.pin} belongs to multiple authored nets: ${edgeIds.join(", ")}; all conflicting nets were ignored.`,
      targets: [
        ...edgeIds.map((id) => ({ kind: "edge" as const, id })),
        { kind: "pin", node: endpoint.node, pin: endpoint.pin }
      ]
    });
  }

  const accepted = candidates.filter(({ edge }) => !conflictedEdges.has(edge.id));
  const reservations = new Map<string, ReservedPin>();
  for (const { edge, endpoints } of accepted) {
    for (const endpoint of endpoints) {
      if (!endpoint.pin) continue;
      reservations.set(pinKey(endpoint), {
        edge: edge.id,
        kind: "net.authored",
        node: endpoint.node,
        pin: endpoint.pin,
        realizes: edge.realizes
      });
    }
  }

  return {
    nets: accepted.map(({ edge, endpoints }) => ({
      boardKind: edge.boardKind,
      direction: "bidirectional",
      endpoints,
      id: `net_${edge.id}`,
      name: edge.name,
      realizes: edge.realizes,
      sourceEdge: edge.id,
      sourceMap: { edge: edge.id, signal: edge.id }
    })),
    reservations
  };
}

function substituteGeneratedComponents(
  edges: ProjectEdge[],
  componentByNodeId: Map<string, ComponentContext>,
  nets: ResolvedNet[],
  generated: ResolvedProject["generated"],
  diagnostics: Diagnostic[]
): { generated: ResolvedProject["generated"]; nets: ResolvedNet[] } {
  type Substitution = {
    authoredNode: string;
    generated: ResolvedProject["generated"][number];
    ownerEdge: string;
    terminals: Record<string, string>;
  };
  const substitutionsByGeneratedId = new Map<string, Substitution[]>();

  for (const edge of edges) {
    if (edge.kind === "net.authored" || edge.kind === "net.binding") continue;
    const realizations = Array.isArray(edge.generatedRealizations)
      ? [...edge.generatedRealizations].sort((left, right) =>
          compareStableText(left.feature, right.feature) ||
          compareStableText(left.signal ?? "", right.signal ?? "") ||
          compareStableText(left.node, right.node)
        )
      : [];
    for (const realization of realizations) {
      const component = componentByNodeId.get(realization.node);
      if (!component) {
        diagnostics.push({
          severity: "error",
          code: "GENERATED_REALIZATION_NODE_INVALID",
          message: `Generated realization on edge "${edge.id}" requires component node "${realization.node}".`,
          targets: [{ kind: "edge", id: edge.id }, { kind: "node", id: realization.node }]
        });
        continue;
      }
      const matches = generated.filter((object) =>
        object.sourceMap.edge === edge.id &&
        object.sourceMap.feature === realization.feature &&
        (realization.signal === undefined || object.sourceMap.signal === realization.signal)
      );
      if (matches.length === 0) {
        diagnostics.push({
          severity: "error",
          code: "GENERATED_REALIZATION_NOT_FOUND",
          message: `Edge "${edge.id}" did not generate feature "${realization.feature}"${realization.signal ? ` signal "${realization.signal}"` : ""}.`,
          targets: [{ kind: "edge", id: edge.id }, { kind: "node", id: realization.node }]
        });
        continue;
      }
      if (matches.length > 1) {
        diagnostics.push({
          severity: "error",
          code: "GENERATED_REALIZATION_AMBIGUOUS",
          message: `Generated realization on edge "${edge.id}" matches multiple "${realization.feature}" objects; add a signal selector.`,
          targets: [{ kind: "edge", id: edge.id }, { kind: "node", id: realization.node }]
        });
        continue;
      }
      const generatedObject = matches[0]!;
      const claims = substitutionsByGeneratedId.get(generatedObject.id) ?? [];
      claims.push({
        authoredNode: realization.node,
        generated: generatedObject,
        ownerEdge: edge.id,
        terminals: realization.terminals ?? {}
      });
      substitutionsByGeneratedId.set(generatedObject.id, claims);
    }
  }

  const substitutions = new Map<string, Substitution>();
  for (const [generatedId, claims] of [...substitutionsByGeneratedId.entries()]
    .sort(([left], [right]) => compareStableText(left, right))) {
    if (claims.length > 1) {
      const targets = claims
        .map(({ authoredNode }) => authoredNode)
        .sort(compareStableText)
        .map((id) => ({ kind: "node" as const, id }));
      diagnostics.push({
        severity: "error",
        code: "GENERATED_REALIZATION_CONFLICT",
        message: `Generated component "${generatedId}" is realized by multiple authored components.`,
        targets
      });
      continue;
    }
    const substitution = claims[0];
    if (!substitution) continue;
    const component = componentByNodeId.get(substitution.authoredNode);
    const usedEndpoints = nets.flatMap((net) =>
      net.endpoints.filter(({ node }) => node === generatedId)
    );
    if (usedEndpoints.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "GENERATED_REALIZATION_TERMINALS_NOT_FOUND",
        message: `Generated component "${generatedId}" has no resolved terminal endpoints that can be substituted.`,
        targets: [
          { kind: "edge", id: substitution.ownerEdge },
          { kind: "node", id: substitution.authoredNode }
        ]
      });
      continue;
    }
    const invalidEndpoint = usedEndpoints.find((endpoint) => {
      if (!endpoint.pin) return true;
      const authoredPin = substitution.terminals[endpoint.pin] ?? endpoint.pin;
      return !component?.definition.pins[authoredPin];
    });
    if (invalidEndpoint) {
      const generatedPin = invalidEndpoint.pin ?? "";
      const authoredPin = substitution.terminals[generatedPin] ?? generatedPin;
      diagnostics.push({
        severity: "error",
        code: "GENERATED_REALIZATION_TERMINAL_INVALID",
        message: `Generated terminal "${generatedId}.${generatedPin}" cannot map to "${substitution.authoredNode}.${authoredPin}".`,
        targets: [
          { kind: "edge", id: substitution.ownerEdge },
          { kind: "node", id: substitution.authoredNode }
        ]
      });
      continue;
    }
    substitutions.set(generatedId, substitution);
  }

  return {
    generated: generated.filter(({ id }) => !substitutions.has(id)),
    nets: nets.map((net) => ({
      ...net,
      endpoints: net.endpoints.map((endpoint) => {
        const substitution = substitutions.get(endpoint.node);
        if (!substitution) return endpoint;
        const pin = endpoint.pin ? substitution.terminals[endpoint.pin] ?? endpoint.pin : endpoint.pin;
        return { ...endpoint, node: substitution.authoredNode, pin };
      })
    }))
  };
}

function reconcileAuthoredNetRealizations(
  authoredNets: ResolvedNet[],
  semanticNets: ResolvedNet[],
  diagnostics: Diagnostic[]
): { nets: ResolvedNet[]; replacements: Map<string, string> } {
  const semanticByRealization = new Map<string, ResolvedNet[]>();
  for (const net of semanticNets) {
    const key = realizationKey(net.sourceMap);
    const matches = semanticByRealization.get(key) ?? [];
    matches.push(net);
    semanticByRealization.set(key, matches);
  }

  const consumedSemanticNets = new Set<string>();
  const replacements = new Map<string, string>();
  const resolvedAuthoredNets = authoredNets.map((authoredNet): ResolvedNet | undefined => {
    if (!authoredNet.realizes) return authoredNet;
    const matches = [...(semanticByRealization.get(realizationKey(authoredNet.realizes)) ?? [])]
      .filter((semanticNet) => realizationMatchesNet(authoredNet.realizes!, semanticNet))
      .sort((left, right) => compareStableText(left.id, right.id));

    if (matches.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "AUTHORED_NET_REALIZATION_NOT_FOUND",
        message: `Authored net "${authoredNet.sourceEdge}" could not realize ${authoredNet.realizes.edge}.${authoredNet.realizes.signal} because that semantic net did not resolve.`,
        targets: [
          { kind: "edge", id: authoredNet.sourceEdge },
          { kind: "edge", id: authoredNet.realizes.edge }
        ]
      });
      return authoredNet;
    }

    if (matches.length > 1) {
      diagnostics.push({
        severity: "error",
        code: "AUTHORED_NET_REALIZATION_AMBIGUOUS",
        message: `Authored net "${authoredNet.sourceEdge}" matches multiple physical segments for ${authoredNet.realizes.edge}.${authoredNet.realizes.signal}.`,
        targets: [
          { kind: "edge", id: authoredNet.sourceEdge },
          { kind: "edge", id: authoredNet.realizes.edge }
        ]
      });
      return undefined;
    }

    const semanticNet = matches[0]!;
    const authoredEndpointKeys = new Set(authoredNet.endpoints.map(endpointKey));
    const missingEndpoints = semanticNet.endpoints.filter((endpoint) => !authoredEndpointKeys.has(endpointKey(endpoint)));

    if (missingEndpoints.length > 0) {
      diagnostics.push({
        severity: "error",
        code: "AUTHORED_NET_REALIZATION_MISMATCH",
        message: `Authored net "${authoredNet.sourceEdge}" does not contain every resolved endpoint of ${authoredNet.realizes.edge}.${authoredNet.realizes.signal}.`,
        targets: [
          { kind: "edge", id: authoredNet.sourceEdge },
          { kind: "edge", id: authoredNet.realizes.edge },
          ...missingEndpoints.map((endpoint): DiagnosticTarget => endpoint.pin
            ? { kind: "pin", node: endpoint.node, pin: endpoint.pin }
            : { kind: "node", id: endpoint.node })
        ]
      });
      return undefined;
    }

    consumedSemanticNets.add(semanticNet.id);
    replacements.set(semanticNet.id, authoredNet.id);
    return {
      ...authoredNet,
      boardKind: authoredNet.boardKind ?? semanticNet.boardKind,
      direction: semanticNet.direction
    };
  }).filter((net): net is ResolvedNet => net !== undefined);

  const remainingSemanticNets = semanticNets.filter((semanticNet) => {
    if (consumedSemanticNets.has(semanticNet.id)) return false;
    const conflictingAuthoredNet = resolvedAuthoredNets.find(
      (authoredNet) => sharedPhysicalPins(authoredNet, semanticNet).length > 0
    );
    if (!conflictingAuthoredNet) return true;
    const overlap = sharedPhysicalPins(conflictingAuthoredNet, semanticNet)[0]!;
    diagnostics.push({
      severity: "error",
      code: "AUTHORED_NET_OWNERSHIP_CONFLICT",
      message: `${overlap.node}.${overlap.pin} is owned by authored net "${conflictingAuthoredNet.sourceEdge}" and cannot also belong to semantic net "${semanticNet.id}".`,
      targets: [
        { kind: "edge", id: conflictingAuthoredNet.sourceEdge },
        { kind: "edge", id: semanticNet.sourceEdge },
        { kind: "pin", node: overlap.node, pin: overlap.pin! }
      ]
    });
    return false;
  });

  return { nets: [...resolvedAuthoredNets, ...remainingSemanticNets], replacements };
}

function reservationMatchesRealization(reservation: ReservedPin, edge: string, signal: string): boolean {
  return reservation.kind === "net.authored" &&
    reservation.realizes?.edge === edge &&
    reservation.realizes.signal === signal;
}

function realizationKey(realization: NetRealizationRef): string {
  return `${realization.edge}\u0000${realization.signal}`;
}

function realizationMatchesNet(realization: NetRealizationRef, net: ResolvedNet): boolean {
  return realization.edge === net.sourceMap.edge &&
    realization.signal === net.sourceMap.signal &&
    (realization.feature === undefined || realization.feature === net.sourceMap.feature) &&
    (realization.segment === undefined || realization.segment === net.sourceMap.segment);
}

function sharedPhysicalPins(left: ResolvedNet, right: ResolvedNet): EndpointRef[] {
  const rightPins = new Set(right.endpoints.filter(({ pin }) => pin).map(pinKey));
  return left.endpoints.filter((endpoint) => endpoint.pin && rightPins.has(pinKey(endpoint)));
}

function compareEndpoint(left: EndpointRef, right: EndpointRef): number {
  return (
    compareStableText(left.node, right.node) ||
    compareStableText(left.pin ?? "", right.pin ?? "") ||
    compareStableText(left.port ?? "", right.port ?? "")
  );
}

function endpointKey(endpoint: EndpointRef): string {
  return `${endpoint.node}\u0000${endpoint.pin ?? ""}\u0000${endpoint.port ?? ""}`;
}

function formatEndpoint(endpoint: EndpointRef): string {
  return [endpoint.node, endpoint.pin, endpoint.port].filter(Boolean).join(".");
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

function indexComponentContexts(
  nodes: ProjectNode[],
  componentDefinitions: ResolutionEnvironment["catalog"]["components"],
  diagnostics: Diagnostic[]
): Map<string, ComponentContext> {
  const componentByNodeId = new Map<string, ComponentContext>();

  for (const node of nodes) {
    if (node.kind !== "component") {
      continue;
    }

    const definition = componentDefinitions[node.component];

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
  diagnostics: Diagnostic[],
  initialReservations: ReadonlyMap<string, ReservedPin>
): Map<string, ReservedPin> {
  const reservedPins = new Map<string, ReservedPin>(initialReservations);

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

function createResolvedDependencies(
  dependencies: Record<string, string>,
  environment: ResolutionEnvironment,
  diagnostics: Diagnostic[]
): Record<string, ResolvedDependency> {
  return Object.fromEntries(
    Object.entries(dependencies).flatMap(([name, requestedVersion]) => {
      const resolved = environment.resolveDependency(name, requestedVersion);

      if (!resolved || resolved.version !== requestedVersion) {
        diagnostics.push({
          severity: "error",
          code: "DEPENDENCY_NOT_FOUND",
          message: `Dependency "${name}" at version "${requestedVersion}" is unavailable.`,
          targets: []
        });
        return [];
      }

      return [[name, resolved]];
    })
  );
}
