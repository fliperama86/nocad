import { projectSchematic } from "@nocad/editor-core";
import type {
  Point,
  SceneSourceReference,
  SchematicConnectionInput,
  SchematicNodeInput,
  SchematicPortInput,
  SchematicProjection
} from "@nocad/editor-core";

import type {
  EndpointRole,
  GeneratedObject,
  ProjectNode,
  ProjectSource,
  ResolvedNet,
  ResolvedProject
} from "./types";

export function buildSchematicProjection(
  source: ProjectSource,
  resolved: ResolvedProject
): SchematicProjection {
  const projectedSourceNodes = source.nodes.flatMap((node) =>
    node.kind === "intent.function" ? [] : [node]
  );
  const nodeIds = new Set([
    ...projectedSourceNodes.map(({ id }) => id),
    ...resolved.generated.map(({ id }) => id)
  ]);
  const sourceByNode = new Map<string, SceneSourceReference>([
    ...projectedSourceNodes.map(({ id }) => [id, { id, kind: "node" }] as const),
    ...resolved.generated.map(({ id, sourceEdge }) => [
      id,
      { id: sourceEdge, kind: "edge", path: ["generated", id] }
    ] as const)
  ]);
  const connections = resolved.nets
    .filter((net) => nodeIds.has(net.endpoints.from.node) && nodeIds.has(net.endpoints.to.node))
    .map(projectConnection);
  const positions = layoutNodes([...nodeIds].sort(), connections);
  const portsByNode = collectPorts(resolved.nets, sourceByNode);
  const nodes = [
    ...projectedSourceNodes.map((node) => projectSourceNode(node, portsByNode.get(node.id) ?? [], positions)),
    ...resolved.generated.map((node) => projectGeneratedNode(node, portsByNode.get(node.id) ?? [], positions))
  ];

  return projectSchematic({ connections, nodes });
}

function projectSourceNode(
  node: Exclude<ProjectNode, { kind: "intent.function" }>,
  ports: SchematicNodeInput["ports"],
  positions: ReadonlyMap<string, Point>
): SchematicNodeInput {
  return {
    id: node.id,
    label: node.label ?? node.refdesHint ?? (node.kind === "component" ? node.component : node.voltage),
    ports,
    position: positions.get(node.id),
    size: nodeSize(ports?.length ?? 0),
    source: { id: node.id, kind: "node" }
  };
}

function projectGeneratedNode(
  node: GeneratedObject,
  ports: SchematicNodeInput["ports"],
  positions: ReadonlyMap<string, Point>
): SchematicNodeInput {
  return {
    id: node.id,
    label: node.value ? `${node.component} ${node.value}` : node.component,
    ports,
    position: positions.get(node.id),
    size: nodeSize(ports?.length ?? 0),
    source: { id: node.sourceEdge, kind: "edge", path: ["generated", node.id] }
  };
}

function projectConnection(net: ResolvedNet): SchematicConnectionInput {
  return {
    from: { node: net.endpoints.from.node, port: portId(net, "from") },
    id: net.id,
    label: net.name,
    source: { id: net.sourceEdge, kind: "edge", path: ["nets", net.id] },
    to: { node: net.endpoints.to.node, port: portId(net, "to") }
  };
}

function collectPorts(
  nets: readonly ResolvedNet[],
  sourceByNode: ReadonlyMap<string, SceneSourceReference>
): Map<string, NonNullable<SchematicNodeInput["ports"]>> {
  const ports = new Map<string, SchematicPortInput[]>();

  for (const net of [...nets].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const role of ["from", "to"] as const) {
      const endpoint = net.endpoints[role];
      const nodeSource = sourceByNode.get(endpoint.node);
      if (!nodeSource) continue;
      const current = ports.get(endpoint.node) ?? [];
      const source: SceneSourceReference = {
        ...nodeSource,
        path: [
          ...(nodeSource.path ?? []),
          endpoint.pin ? "pins" : "ports",
          endpoint.pin ?? endpoint.port ?? role
        ]
      };
      current.push({
        id: portId(net, role),
        label: endpoint.pin ?? endpoint.port ?? net.sourceMap.signal,
        side: role === "from" ? "right" : "left",
        source
      });
      ports.set(endpoint.node, current);
    }
  }

  return ports;
}

function layoutNodes(
  nodeIds: readonly string[],
  connections: readonly SchematicConnectionInput[]
): ReadonlyMap<string, Point> {
  const outgoing = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  const incoming = new Map(nodeIds.map((id) => [id, 0]));

  for (const connection of connections) {
    if (connection.from.node === connection.to.node) continue;
    const targets = outgoing.get(connection.from.node);
    if (!targets || targets.has(connection.to.node)) continue;
    targets.add(connection.to.node);
    incoming.set(connection.to.node, (incoming.get(connection.to.node) ?? 0) + 1);
  }

  const layers = new Map<string, number>();
  let frontier = nodeIds.filter((id) => incoming.get(id) === 0);
  while (frontier.length > 0) {
    const next = new Set<string>();
    for (const id of frontier.sort()) {
      const layer = layers.get(id) ?? 0;
      layers.set(id, layer);
      for (const target of outgoing.get(id) ?? []) {
        layers.set(target, Math.max(layers.get(target) ?? 0, layer + 1));
        const remaining = (incoming.get(target) ?? 1) - 1;
        incoming.set(target, remaining);
        if (remaining === 0) next.add(target);
      }
    }
    frontier = [...next];
  }

  for (const id of nodeIds) {
    if (!layers.has(id)) layers.set(id, 0);
  }

  const byLayer = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    const current = byLayer.get(layer) ?? [];
    current.push(id);
    byLayer.set(layer, current);
  }

  return new Map(
    [...byLayer.entries()].flatMap(([layer, ids]) =>
      ids.sort().map((id, index) => [id, { x: 60 + layer * 360, y: 60 + index * 220 }] as const)
    )
  );
}

function nodeSize(portCount: number) {
  return { height: Math.max(100, 44 + portCount * 12), width: 200 };
}

function portId(net: ResolvedNet, role: EndpointRole) {
  return `${net.id}:${role}`;
}
