import { boundingRect } from "./geometry";
import type { Point, Rect, Size } from "./geometry";
import type {
  CircleScenePrimitive,
  PolylineScenePrimitive,
  RectScenePrimitive,
  Scene,
  ScenePrimitive,
  SceneSourceReference,
  TextScenePrimitive
} from "./scene";

export type SchematicPortSide = "bottom" | "left" | "right" | "top";

export type SchematicPortInput = Readonly<{
  id: string;
  label?: string;
  side?: SchematicPortSide;
  source?: SceneSourceReference;
}>;

export type SchematicNodeInput = Readonly<{
  id: string;
  label?: string;
  ports?: readonly SchematicPortInput[];
  position?: Point;
  size?: Size;
  source?: SceneSourceReference;
}>;

export type SchematicEndpoint = Readonly<{
  node: string;
  port: string;
}>;

export type SchematicConnectionInput = Readonly<{
  from: SchematicEndpoint;
  id: string;
  label?: string;
  source?: SceneSourceReference;
  to: SchematicEndpoint;
}>;

export type SchematicProjectionInput = Readonly<{
  connections: readonly SchematicConnectionInput[];
  nodes: readonly SchematicNodeInput[];
}>;

export type SchematicProjectionOptions = Readonly<{
  columns?: number;
  gap?: Size;
  nodeSize?: Size;
  origin?: Point;
  portRadius?: number;
}>;

export type SchematicPortProjection = Readonly<{
  id: string;
  node: string;
  position: Point;
  side: SchematicPortSide;
  source: SceneSourceReference;
}>;

export type SchematicNodeProjection = Readonly<{
  bounds: Rect;
  id: string;
  ports: readonly SchematicPortProjection[];
  source: SceneSourceReference;
}>;

export type SchematicConnectionProjection = Readonly<{
  from: SchematicPortProjection;
  id: string;
  points: readonly Point[];
  source: SceneSourceReference;
  to: SchematicPortProjection;
}>;

export type SchematicProjectionDiagnostic = Readonly<{
  code:
    | "DUPLICATE_CONNECTION_ID"
    | "DUPLICATE_NODE_ID"
    | "DUPLICATE_PORT_ID"
    | "MISSING_ENDPOINT";
  id: string;
  message: string;
}>;

export type SchematicProjection = Readonly<{
  connections: readonly SchematicConnectionProjection[];
  diagnostics: readonly SchematicProjectionDiagnostic[];
  nodes: readonly SchematicNodeProjection[];
  scene: Scene;
}>;

const defaultOptions: Required<SchematicProjectionOptions> = {
  columns: 4,
  gap: { height: 100, width: 140 },
  nodeSize: { height: 100, width: 180 },
  origin: { x: 40, y: 40 },
  portRadius: 5
};

export function projectSchematic(
  input: SchematicProjectionInput,
  options: SchematicProjectionOptions = {}
): SchematicProjection {
  const configuration = normalizeOptions(options);
  const diagnostics: SchematicProjectionDiagnostic[] = [];
  const nodes = projectNodes(input.nodes, configuration, diagnostics);
  const ports = new Map(
    nodes.flatMap((node) => node.ports.map((port) => [endpointKey(node.id, port.id), port] as const))
  );
  const connections = projectConnections(input.connections, ports, diagnostics);
  const primitives = createPrimitives(input, nodes, connections, configuration.portRadius);
  const sceneBounds = boundingRect(primitives.flatMap(primitiveBoundsPoints));

  return {
    connections,
    diagnostics: [...diagnostics].sort(compareDiagnostic),
    nodes,
    scene: {
      ...(sceneBounds ? { bounds: sceneBounds } : {}),
      primitives: [...primitives].sort(comparePrimitive)
    }
  };
}

function projectNodes(
  inputs: readonly SchematicNodeInput[],
  options: Required<SchematicProjectionOptions>,
  diagnostics: SchematicProjectionDiagnostic[]
): SchematicNodeProjection[] {
  const uniqueNodes = uniqueById(inputs, "DUPLICATE_NODE_ID", "node", diagnostics);
  const maximumWidth = Math.max(options.nodeSize.width, ...uniqueNodes.map((node) => node.size?.width ?? 0));
  const maximumHeight = Math.max(options.nodeSize.height, ...uniqueNodes.map((node) => node.size?.height ?? 0));

  return uniqueNodes.map((node, index) => {
    const size = node.size ?? options.nodeSize;
    const position = node.position ?? {
      x: options.origin.x + (index % options.columns) * (maximumWidth + options.gap.width),
      y: options.origin.y + Math.floor(index / options.columns) * (maximumHeight + options.gap.height)
    };
    const bounds = { ...position, ...size };
    const source = node.source ?? { kind: "node", id: node.id };
    const ports = projectPorts(node, bounds, source, diagnostics);

    return { bounds, id: node.id, ports, source };
  });
}

function projectPorts(
  node: SchematicNodeInput,
  bounds: Rect,
  nodeSource: SceneSourceReference,
  diagnostics: SchematicProjectionDiagnostic[]
): SchematicPortProjection[] {
  const ports = uniqueById(node.ports ?? [], "DUPLICATE_PORT_ID", `port on ${node.id}`, diagnostics);
  const bySide = new Map<SchematicPortSide, SchematicPortInput[]>();

  for (const port of ports) {
    const side = port.side ?? "right";
    const current = bySide.get(side) ?? [];
    current.push(port);
    bySide.set(side, current);
  }

  return [...bySide.entries()]
    .flatMap(([side, sidePorts]) =>
      sidePorts.map((port, index) => ({
        id: port.id,
        node: node.id,
        position: portPosition(bounds, side, index, sidePorts.length),
        side,
        source: port.source ?? {
          ...nodeSource,
          path: [...(nodeSource.path ?? []), "ports", port.id]
        }
      }))
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function projectConnections(
  inputs: readonly SchematicConnectionInput[],
  ports: ReadonlyMap<string, SchematicPortProjection>,
  diagnostics: SchematicProjectionDiagnostic[]
): SchematicConnectionProjection[] {
  const connections = uniqueById(inputs, "DUPLICATE_CONNECTION_ID", "connection", diagnostics);

  return connections.flatMap((connection) => {
    const from = ports.get(endpointKey(connection.from.node, connection.from.port));
    const to = ports.get(endpointKey(connection.to.node, connection.to.port));

    if (!from || !to) {
      diagnostics.push({
        code: "MISSING_ENDPOINT",
        id: connection.id,
        message: `Connection "${connection.id}" references a missing node port.`
      });
      return [];
    }

    return [{
      from,
      id: connection.id,
      points: orthogonalRoute(from.position, to.position),
      source: connection.source ?? { kind: "connection", id: connection.id },
      to
    }];
  });
}

function createPrimitives(
  input: SchematicProjectionInput,
  nodes: readonly SchematicNodeProjection[],
  connections: readonly SchematicConnectionProjection[],
  portRadius: number
): ScenePrimitive[] {
  const nodeInputs = new Map(input.nodes.map((node) => [node.id, node]));
  const connectionInputs = new Map(input.connections.map((connection) => [connection.id, connection]));
  const connectionPrimitives: PolylineScenePrimitive[] = connections.map((connection) => ({
    id: `connection/${encodeURIComponent(connection.id)}`,
    kind: "polyline",
    layer: "connections",
    points: connection.points,
    source: connection.source,
    strokeWidth: 2,
    zIndex: 0
  }));
  const nodePrimitives = nodes.flatMap((node): ScenePrimitive[] => {
    const inputNode = nodeInputs.get(node.id);
    const body: RectScenePrimitive = {
      bounds: node.bounds,
      id: `node/${encodeURIComponent(node.id)}/body`,
      kind: "rect",
      layer: "nodes",
      source: node.source,
      zIndex: 10
    };
    const label = inputNode?.label;
    const labelPrimitive: TextScenePrimitive[] = label
      ? [{
          anchor: { x: node.bounds.x + 12, y: node.bounds.y + 24 },
          bounds: {
            x: node.bounds.x + 8,
            y: node.bounds.y + 8,
            width: Math.max(0, node.bounds.width - 16),
            height: 24
          },
          id: `node/${encodeURIComponent(node.id)}/label`,
          interactive: false,
          kind: "text",
          layer: "labels",
          source: node.source,
          text: label,
          zIndex: 20
        }]
      : [];
    const portPrimitives: CircleScenePrimitive[] = node.ports.map((port) => ({
      center: port.position,
      id: `node/${encodeURIComponent(node.id)}/port/${encodeURIComponent(port.id)}`,
      kind: "circle",
      layer: "ports",
      radius: portRadius,
      source: port.source,
      zIndex: 30
    }));

    return [body, ...labelPrimitive, ...portPrimitives];
  });
  const connectionLabels: TextScenePrimitive[] = connections.flatMap((connection) => {
    const label = connectionInputs.get(connection.id)?.label;
    const center = connection.points[Math.floor(connection.points.length / 2)];

    return label && center
      ? [{
          anchor: center,
          bounds: { x: center.x - 60, y: center.y - 12, width: 120, height: 24 },
          id: `connection/${encodeURIComponent(connection.id)}/label`,
          interactive: false,
          kind: "text",
          layer: "labels",
          source: connection.source,
          text: label,
          zIndex: 5
        }]
      : [];
  });

  return [...connectionPrimitives, ...connectionLabels, ...nodePrimitives];
}

function uniqueById<T extends { id: string }>(
  values: readonly T[],
  code: SchematicProjectionDiagnostic["code"],
  noun: string,
  diagnostics: SchematicProjectionDiagnostic[]
): T[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
  }

  for (const [id, count] of [...counts.entries()].sort(compareTextEntry)) {
    if (count > 1) {
      diagnostics.push({
        code,
        id,
        message: `Duplicate ${noun} id "${id}"; all occurrences were ignored.`
      });
    }
  }

  return values
    .filter((value) => counts.get(value.id) === 1)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function portPosition(
  bounds: Rect,
  side: SchematicPortSide,
  index: number,
  count: number
): Point {
  const fraction = (index + 1) / (count + 1);

  if (side === "left" || side === "right") {
    return {
      x: side === "left" ? bounds.x : bounds.x + bounds.width,
      y: bounds.y + bounds.height * fraction
    };
  }

  return {
    x: bounds.x + bounds.width * fraction,
    y: side === "top" ? bounds.y : bounds.y + bounds.height
  };
}

function orthogonalRoute(from: Point, to: Point): Point[] {
  const middleX = (from.x + to.x) / 2;
  const candidates = [from, { x: middleX, y: from.y }, { x: middleX, y: to.y }, to];

  return candidates.filter(
    (point, index) => index === 0 || point.x !== candidates[index - 1]?.x || point.y !== candidates[index - 1]?.y
  );
}

function primitiveBoundsPoints(primitive: ScenePrimitive): Point[] {
  if (primitive.kind === "line") {
    return [primitive.start, primitive.end];
  }

  if (primitive.kind === "polyline") {
    return [...primitive.points];
  }

  if (primitive.kind === "circle") {
    return [
      { x: primitive.center.x - primitive.radius, y: primitive.center.y - primitive.radius },
      { x: primitive.center.x + primitive.radius, y: primitive.center.y + primitive.radius }
    ];
  }

  return [
    { x: primitive.bounds.x, y: primitive.bounds.y },
    {
      x: primitive.bounds.x + primitive.bounds.width,
      y: primitive.bounds.y + primitive.bounds.height
    }
  ];
}

function normalizeOptions(options: SchematicProjectionOptions): Required<SchematicProjectionOptions> {
  const normalized = {
    columns: options.columns ?? defaultOptions.columns,
    gap: options.gap ?? defaultOptions.gap,
    nodeSize: options.nodeSize ?? defaultOptions.nodeSize,
    origin: options.origin ?? defaultOptions.origin,
    portRadius: options.portRadius ?? defaultOptions.portRadius
  };

  if (!Number.isInteger(normalized.columns) || normalized.columns <= 0) {
    throw new RangeError("Schematic projection columns must be a positive integer.");
  }

  if (normalized.nodeSize.width <= 0 || normalized.nodeSize.height <= 0 || normalized.portRadius < 0) {
    throw new RangeError("Schematic node dimensions must be positive and port radius cannot be negative.");
  }
  if (
    !Number.isFinite(normalized.origin.x) ||
    !Number.isFinite(normalized.origin.y) ||
    !Number.isFinite(normalized.gap.width) ||
    !Number.isFinite(normalized.gap.height) ||
    !Number.isFinite(normalized.nodeSize.width) ||
    !Number.isFinite(normalized.nodeSize.height) ||
    !Number.isFinite(normalized.portRadius) ||
    normalized.gap.width < 0 ||
    normalized.gap.height < 0
  ) {
    throw new RangeError("Schematic projection geometry must be finite and gaps cannot be negative.");
  }

  return normalized;
}

function endpointKey(node: string, port: string): string {
  return `${node}\u0000${port}`;
}

function comparePrimitive(left: ScenePrimitive, right: ScenePrimitive): number {
  return left.zIndex - right.zIndex || left.id.localeCompare(right.id);
}

function compareDiagnostic(
  left: SchematicProjectionDiagnostic,
  right: SchematicProjectionDiagnostic
): number {
  return left.code.localeCompare(right.code) || left.id.localeCompare(right.id);
}

function compareTextEntry(left: readonly [string, number], right: readonly [string, number]): number {
  return left[0].localeCompare(right[0]);
}
