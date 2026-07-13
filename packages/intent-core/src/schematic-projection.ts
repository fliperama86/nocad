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
  const connections = resolved.nets.flatMap((net) => projectConnections(net, nodeIds));
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

function projectConnections(
  net: ResolvedNet,
  nodeIds: ReadonlySet<string>
): SchematicConnectionInput[] {
  const endpoints = net.endpoints
    .map((endpoint, index) => ({ endpoint, index }))
    .filter(({ endpoint }) => nodeIds.has(endpoint.node));
  const root = endpoints[0];
  if (!root) return [];

  return endpoints.slice(1).map(({ endpoint, index }, segmentIndex) => ({
    from: { node: root.endpoint.node, port: portId(net, root.index) },
    id: endpoints.length === 2
      ? net.id
      : `view/net/${encodeURIComponent(net.id)}/branch/${encodeURIComponent(endpointIdentity(endpoint))}`,
    ...(segmentIndex === 0 ? { label: net.name } : {}),
    source: { id: net.sourceEdge, kind: "edge", path: ["nets", net.id] },
    to: { node: endpoint.node, port: portId(net, index) }
  }));
}

function endpointIdentity(endpoint: ResolvedNet["endpoints"][number]) {
  return `${endpoint.node}\u0000${endpoint.pin ?? ""}\u0000${endpoint.port ?? ""}`;
}

function collectPorts(
  nets: readonly ResolvedNet[],
  sourceByNode: ReadonlyMap<string, SceneSourceReference>
): Map<string, NonNullable<SchematicNodeInput["ports"]>> {
  const ports = new Map<string, SchematicPortInput[]>();

  for (const net of [...nets].sort((left, right) => left.id.localeCompare(right.id))) {
    for (const [index, endpoint] of net.endpoints.entries()) {
      const nodeSource = sourceByNode.get(endpoint.node);
      if (!nodeSource) continue;
      const current = ports.get(endpoint.node) ?? [];
      const source: SceneSourceReference = {
        ...nodeSource,
        path: [
          ...(nodeSource.path ?? []),
          endpoint.pin ? "pins" : "ports",
          endpoint.pin ?? endpoint.port ?? String(index)
        ]
      };
      current.push({
        id: portId(net, index),
        label: endpoint.pin ?? endpoint.port ?? net.sourceMap.signal,
        side: index === 0 ? "right" : "left",
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

function portId(net: ResolvedNet, index: number) {
  return `${net.id}:${index}`;
}
