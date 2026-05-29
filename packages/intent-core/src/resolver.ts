import { components, contracts, packageVersions } from "./fixtures";
import type {
  ComponentDefinition,
  ComponentNode,
  Diagnostic,
  EndpointRef,
  IntentConnectionEdge,
  ProjectEdge,
  ProjectNode,
  ProjectSource,
  PowerDomainNode,
  ResolvedDependency,
  ResolvedNet,
  ResolvedProject,
  SignalBindings
} from "./types";

const RESOLVER_VERSION = "0.1.0";

type ComponentContext = {
  node: ComponentNode;
  definition: ComponentDefinition;
};

type ReservedPin = {
  node: string;
  pin: string;
  edge: string;
};

type ResolvedConnection = {
  choice: ResolvedProject["resolvedChoices"][number];
  nets: ResolvedNet[];
};

type ResolutionContext = {
  diagnostics: Diagnostic[];
  nodeById: Map<string, ProjectNode>;
  componentByNodeId: Map<string, ComponentContext>;
  reservedPins: Map<string, ReservedPin>;
};

export function resolveProject(source: ProjectSource): ResolvedProject {
  const diagnostics: Diagnostic[] = [];
  const nodeById = indexNodes(source.nodes, diagnostics);
  const componentByNodeId = indexComponentContexts(source.nodes, diagnostics);
  const reservedPins = collectInitialReservations(source.edges);
  const edgeIds = new Set<string>();
  const dependencies = createResolvedDependencies(source.dependencies);

  const context: ResolutionContext = {
    diagnostics,
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

    if (edge.kind !== "intent.connection") {
      continue;
    }

    const resolved = resolveIntentConnection(edge, context);

    if (!resolved) {
      continue;
    }

    resolvedChoices.push(resolved.choice);
    nets.push(...resolved.nets);

    reserveBindings(edge.id, resolved.choice.selected.bindings, context.reservedPins);

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
          {
            id: "pullup_sda",
            kind: "component",
            component: "@nocad/passives:RESISTOR",
            value: "4.7k",
            connects: ["I2C_SDA", pullupRail.id],
            sourceEdge: edge.id,
            sourceMap: {
              edge: edge.id,
              feature: "pullups"
            }
          },
          {
            id: "pullup_scl",
            kind: "component",
            component: "@nocad/passives:RESISTOR",
            value: "4.7k",
            connects: ["I2C_SCL", pullupRail.id],
            sourceEdge: edge.id,
            sourceMap: {
              edge: edge.id,
              feature: "pullups"
            }
          }
        );
      }
    }
  }

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

function findPullupRail(nodes: ProjectNode[]): PowerDomainNode | null {
  return (
    nodes.find(
      (node): node is PowerDomainNode =>
        node.kind === "powerDomain" && (node.role === "power_3v3" || node.voltage === "3.3V")
    ) ?? null
  );
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

  const bindings =
    edge.strategy?.pinAssignment === "manual" && edge.bindings
      ? completeManualBindings(edge, to.definition)
      : chooseAutoI2cBindings(edge, from, to, context);

  if (!bindings) {
    return null;
  }

  const hasConflict = findBindingConflict(bindings, context.reservedPins);

  if (hasConflict) {
    context.diagnostics.push({
      severity: "error",
      code: "PIN_CONFLICT",
      message: `${hasConflict.node}.${hasConflict.pin} is already reserved by ${hasConflict.edge}.`,
      targets: [
        { kind: "edge", id: edge.id },
        { kind: "pin", node: hasConflict.node, pin: hasConflict.pin }
      ]
    });
    return null;
  }

  return {
    choice: {
      id: `${edge.id}.pinAssignment`,
      sourceEdge: edge.id,
      strategy: edge.strategy?.pinAssignment === "manual" ? "manual" : "auto",
      selected: {
        bindings
      },
      reason:
        edge.strategy?.pinAssignment === "manual"
          ? "Used source-provided I2C pin bindings."
          : "Selected first available I2C-capable RP2350 pin pair."
    },
    nets: [
      createNet("sda", "I2C_SDA", bindings, edge.id),
      createNet("scl", "I2C_SCL", bindings, edge.id)
    ]
  };
}

function resolveEndpoint(
  edge: IntentConnectionEdge,
  role: "from" | "to",
  context: ResolutionContext
): ComponentContext | null {
  const endpoint = edge[role];
  const node = context.nodeById.get(endpoint.node);

  if (!node) {
    context.diagnostics.push({
      severity: "error",
      code: "UNKNOWN_NODE",
      message: `Edge "${edge.id}" references missing node "${endpoint.node}".`,
      targets: [{ kind: "edge", id: edge.id }]
    });
    return null;
  }

  if (node.kind !== "component") {
    context.diagnostics.push({
      severity: "error",
      code: "INVALID_ENDPOINT_NODE",
      message: `Edge "${edge.id}" endpoint "${endpoint.node}" is not a component.`,
      targets: [
        { kind: "edge", id: edge.id },
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
        { kind: "edge", id: edge.id },
        { kind: "node", id: endpoint.node }
      ]
    });
    return null;
  }

  return component;
}

function completeManualBindings(edge: IntentConnectionEdge, toDefinition: ComponentDefinition): SignalBindings {
  const sensorI2cMap = toDefinition.ports[edge.to.port ?? ""]?.contractMaps?.[edge.contract]?.signalMap ?? {};

  return Object.fromEntries(
    Object.entries(edge.bindings ?? {}).map(([signal, binding]) => {
      const signalMap = sensorI2cMap[signal];
      const toPin = signalMap && "pin" in signalMap ? signalMap.pin : signal;

      return [
        signal,
        {
          ...binding,
          to: binding.to ?? { node: edge.to.node, pin: toPin }
        }
      ];
    })
  );
}

function chooseAutoI2cBindings(
  edge: IntentConnectionEdge,
  from: ComponentContext,
  to: ComponentContext,
  context: ResolutionContext
): SignalBindings | null {
  for (const pair of from.definition.preferredI2cPairs ?? []) {
    const bindings: SignalBindings = {
      sda: {
        from: { node: edge.from.node, pin: pair.sda },
        to: { node: edge.to.node, pin: "sda" }
      },
      scl: {
        from: { node: edge.from.node, pin: pair.scl },
        to: { node: edge.to.node, pin: "scl" }
      }
    };

    if (!findBindingConflict(bindings, context.reservedPins) && pinsSatisfyI2cPair(pair, from.definition)) {
      return bindings;
    }
  }

  context.diagnostics.push({
    severity: "error",
    code: "NO_AVAILABLE_PIN_PAIR",
    message: `No available I2C pin pair could satisfy edge "${edge.id}".`,
    targets: [{ kind: "edge", id: edge.id }],
    suggestions: [
      {
        title: "Move I2C to GPIO8/GPIO9",
        patch: {
          op: "setEdgeBindings",
          edge: edge.id,
          value: {
            sda: { from: { node: edge.from.node, pin: "gpio8" } },
            scl: { from: { node: edge.from.node, pin: "gpio9" } }
          }
        }
      }
    ]
  });

  return null;
}

function pinsSatisfyI2cPair(pair: { sda: string; scl: string }, definition: ComponentDefinition): boolean {
  return (
    definition.pins[pair.sda]?.capabilities.includes("i2c.sda") === true &&
    definition.pins[pair.scl]?.capabilities.includes("i2c.scl") === true
  );
}

function createNet(signal: "sda" | "scl", name: string, bindings: SignalBindings, edgeId: string): ResolvedNet {
  const binding = bindings[signal];
  const from = binding?.from;
  const to = binding?.to;

  if (!from?.pin || !to?.pin) {
    throw new Error(`Resolved ${signal} binding is incomplete.`);
  }

  return {
    id: `net_i2c_${signal}`,
    name,
    endpoints: {
      from,
      to
    },
    direction: "bidirectional",
    sourceEdge: edgeId,
    sourceMap: {
      edge: edgeId,
      signal
    }
  };
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

function findBindingConflict(bindings: SignalBindings, reservedPins: Map<string, ReservedPin>): ReservedPin | null {
  for (const binding of Object.values(bindings)) {
    for (const endpoint of Object.values(binding)) {
      if (!endpoint?.pin) {
        continue;
      }

      const reserved = reservedPins.get(pinKey(endpoint));

      if (reserved) {
        return reserved;
      }
    }
  }

  return null;
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
