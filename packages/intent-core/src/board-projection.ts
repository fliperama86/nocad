import { components } from "./fixtures";
import type { ProjectNode, ProjectSource, ResolvedNet, ResolvedProject } from "./types";

export type BoardProjection = {
  board: {
    id: string;
    layers: number;
    widthMm: number;
    heightMm: number;
  };
  components: BoardComponentProjection[];
  drcViolations: BoardDrcViolation[];
  obligations: BoardObligation[];
  ratsnest: BoardRatsnestEdge[];
  stats: {
    drcViolations: number;
    placedComponents: number;
    totalComponents: number;
    unroutedNets: number;
  };
};

export type BoardComponentProjection = {
  id: string;
  component: string;
  heightMm: number;
  label: string;
  package?: string;
  placed: boolean;
  refdesHint?: string;
  role?: string;
  rotationDeg: number;
  violations: string[];
  widthMm: number;
  xMm: number;
  yMm: number;
};

export type BoardRatsnestEdge = {
  contract?: string;
  from: BoardPoint;
  fromNode: string;
  id: string;
  kind: "highSpeed" | "power" | "signal";
  name: string;
  signal: string;
  sourceEdge: string;
  to: BoardPoint;
  toNode: string;
};

export type BoardPoint = {
  xMm: number;
  yMm: number;
};

export type BoardComponentPlacement = {
  rotationDeg: number;
  xMm: number;
  yMm: number;
};

export type BoardDrcViolation = {
  componentIds: [string, string];
  id: string;
  kind: "courtyard_overlap";
  message: string;
  severity: "error";
  target: {
    id: string;
    kind: "component";
  };
};

export type BoardObligation = {
  id: string;
  kind: "drc" | "placement" | "routing";
  message: string;
  severity: "error" | "info" | "warning";
  sourceId: string;
  target: {
    id: string;
    kind: "component" | "ratsnest";
  };
};

type PlacementHint = {
  edge?: string;
  orientation?: string;
  region?: string;
  rotation?: number | string;
  x?: number | string;
  y?: number | string;
};

const defaultBoard = {
  id: "main_board",
  layers: 2,
  widthMm: 50,
  heightMm: 30
};

export function buildBoardProjection(source: ProjectSource, resolved: ResolvedProject): BoardProjection {
  const board = {
    id: source.board?.id ?? source.layout?.board ?? defaultBoard.id,
    layers: source.board?.layers ?? defaultBoard.layers,
    widthMm: parseLengthMm(source.board?.size.width) ?? defaultBoard.widthMm,
    heightMm: parseLengthMm(source.board?.size.height) ?? defaultBoard.heightMm
  };
  const componentNodes = source.nodes.filter((node): node is ProjectNode & { kind: "component" } => node.kind === "component");
  const componentsById = new Map<string, BoardComponentProjection>();
  const projectedComponents = componentNodes.map((node, index) => {
    const projected = projectComponent(node, index, componentNodes.length, board, source.layout?.placements[node.id]);

    componentsById.set(node.id, projected);
    return projected;
  });
  const ratsnest = resolved.nets.flatMap((net) => projectRatsnest(net, source, componentsById));

  return completeBoardProjection(board, projectedComponents, ratsnest);
}

export function applyBoardComponentPlacement(
  projection: BoardProjection,
  componentId: string,
  placement: BoardComponentPlacement
): BoardProjection {
  const components = projection.components.map((component) =>
    component.id === componentId
      ? {
          ...component,
          placed: true,
          rotationDeg: normalizeRotation(placement.rotationDeg),
          xMm: clampCenter(placement.xMm, component.widthMm, projection.board.widthMm),
          yMm: clampCenter(placement.yMm, component.heightMm, projection.board.heightMm)
        }
      : component
  );
  const movedComponent = components.find((component) => component.id === componentId);
  const ratsnest = projection.ratsnest.map((edge) => ({
    ...edge,
    from: edge.fromNode === componentId && movedComponent
      ? { xMm: movedComponent.xMm, yMm: movedComponent.yMm }
      : edge.from,
    to: edge.toNode === componentId && movedComponent ? { xMm: movedComponent.xMm, yMm: movedComponent.yMm } : edge.to
  }));

  return completeBoardProjection(projection.board, components, ratsnest);
}

function completeBoardProjection(
  board: BoardProjection["board"],
  components: BoardComponentProjection[],
  ratsnest: BoardRatsnestEdge[]
): BoardProjection {
  const drcViolations = findCourtyardOverlaps(components);
  const violationsByComponent = new Map<string, string[]>();

  for (const violation of drcViolations) {
    for (const componentId of violation.componentIds) {
      const violations = violationsByComponent.get(componentId) ?? [];
      violations.push(violation.id);
      violationsByComponent.set(componentId, violations);
    }
  }

  const componentsWithViolations = components.map((component) => ({
    ...component,
    violations: violationsByComponent.get(component.id) ?? []
  }));
  const placementObligations = componentsWithViolations.flatMap((component) =>
    component.placed
      ? []
      : [
          {
            id: `place_${component.id}`,
            kind: "placement" as const,
            message: `Place ${component.label}`,
            severity: "warning" as const,
            sourceId: component.id,
            target: {
              id: component.id,
              kind: "component" as const
            }
          }
        ]
  );
  const drcObligations = drcViolations.map((violation) => ({
    id: violation.id,
    kind: "drc" as const,
    message: violation.message,
    severity: violation.severity,
    sourceId: violation.componentIds.join("+"),
    target: violation.target
  }));
  const routingObligations = ratsnest.map((edge) => ({
    id: `route_${edge.id}`,
    kind: "routing" as const,
    message: `Route ${edge.name}`,
    severity: "warning" as const,
    sourceId: edge.sourceEdge,
    target: {
      id: edge.id,
      kind: "ratsnest" as const
    }
  }));

  return {
    board,
    components: componentsWithViolations,
    drcViolations,
    obligations: [...drcObligations, ...placementObligations, ...routingObligations],
    ratsnest,
    stats: {
      drcViolations: drcViolations.length,
      placedComponents: componentsWithViolations.filter((component) => component.placed).length,
      totalComponents: componentsWithViolations.length,
      unroutedNets: ratsnest.length
    }
  };
}

function projectComponent(
  node: ProjectNode & { kind: "component" },
  index: number,
  componentCount: number,
  board: BoardProjection["board"],
  placement: unknown
): BoardComponentProjection {
  const footprint = footprintEnvelope(node);
  const authored = authoredPlacement(placement);
  const hinted = authored ? undefined : hintedPlacement(node, index, componentCount, board, footprint);
  const xMm = clampCenter(authored?.xMm ?? hinted?.xMm ?? board.widthMm / 2, footprint.widthMm, board.widthMm);
  const yMm = clampCenter(authored?.yMm ?? hinted?.yMm ?? board.heightMm / 2, footprint.heightMm, board.heightMm);

  return {
    id: node.id,
    component: node.component,
    heightMm: footprint.heightMm,
    label: node.label ?? componentLabel(node.component),
    package: node.package,
    placed: Boolean(authored),
    refdesHint: node.refdesHint,
    role: node.role,
    rotationDeg: authored?.rotationDeg ?? hinted?.rotationDeg ?? 0,
    violations: [],
    widthMm: footprint.widthMm,
    xMm,
    yMm
  };
}

function authoredPlacement(placement: unknown) {
  if (!isPlacementHint(placement)) {
    return undefined;
  }

  const xMm = parseLengthMm(placement.x);
  const yMm = parseLengthMm(placement.y);

  if (xMm === undefined || yMm === undefined) {
    return undefined;
  }

  return {
    rotationDeg: parseAngleDeg(placement.rotation) ?? 0,
    xMm,
    yMm
  };
}

function hintedPlacement(
  node: ProjectNode & { kind: "component" },
  index: number,
  componentCount: number,
  board: BoardProjection["board"],
  footprint: { heightMm: number; widthMm: number }
) {
  if (node.role === "hdmi_port" || node.component.includes("CONNECTOR")) {
    return {
      rotationDeg: 0,
      xMm: board.widthMm - footprint.widthMm / 2 - 1.5,
      yMm: board.heightMm / 2
    };
  }

  if (node.role === "hdmi_tx") {
    return {
      rotationDeg: 0,
      xMm: board.widthMm * 0.62,
      yMm: board.heightMm / 2
    };
  }

  if (node.role === "mcu" || node.role === "video_source") {
    return {
      rotationDeg: 0,
      xMm: board.widthMm * 0.28,
      yMm: board.heightMm / 2
    };
  }

  if (node.role?.includes("sensor") === true) {
    return {
      rotationDeg: 0,
      xMm: board.widthMm * 0.52,
      yMm: board.heightMm * 0.7
    };
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(componentCount)));
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    rotationDeg: 0,
    xMm: ((column + 1) / (columns + 1)) * board.widthMm,
    yMm: board.heightMm * (0.25 + row * 0.25)
  };
}

function projectRatsnest(
  net: ResolvedNet,
  source: ProjectSource,
  componentsById: Map<string, BoardComponentProjection>
): BoardRatsnestEdge[] {
  const from = componentsById.get(net.endpoints.from.node);
  const to = componentsById.get(net.endpoints.to.node);

  if (!from || !to) {
    return [];
  }

  return [
    {
      contract: contractForEdge(source, net.sourceEdge),
      from: { xMm: from.xMm, yMm: from.yMm },
      fromNode: from.id,
      id: net.id,
      kind: ratsnestKind(net),
      name: net.name,
      signal: net.sourceMap.signal,
      sourceEdge: net.sourceEdge,
      to: { xMm: to.xMm, yMm: to.yMm },
      toNode: to.id
    }
  ];
}

function contractForEdge(source: ProjectSource, edgeId: string) {
  const edge = source.edges.find((candidate) => candidate.id === edgeId);

  return edge && (edge.kind === "intent.connection" || edge.kind === "intent.exposes" || edge.kind === "intent.provides")
    ? edge.contract
    : undefined;
}

function ratsnestKind(net: ResolvedNet): BoardRatsnestEdge["kind"] {
  if (net.sourceMap.signal === "source5v" || net.name.includes("5v")) {
    return "power";
  }

  if (
    net.sourceMap.signal.startsWith("tmds") ||
    net.sourceMap.signal.startsWith("clock") ||
    net.name.includes("pixel")
  ) {
    return "highSpeed";
  }

  return "signal";
}

function footprintEnvelope(node: ProjectNode & { kind: "component" }) {
  if (node.role === "hdmi_port" || node.component.includes("HDMI_TYPE_A")) {
    return { widthMm: 14, heightMm: 12 };
  }

  if (node.component.includes("RP2350")) {
    return { widthMm: 10, heightMm: 10 };
  }

  if (node.component.includes("GENERIC_FPGA")) {
    return { widthMm: 16, heightMm: 16 };
  }

  if (node.component.includes("IT66121")) {
    return { widthMm: 9, heightMm: 9 };
  }

  if (node.component.includes("TEMP_SENSOR")) {
    return { widthMm: 3, heightMm: 3 };
  }

  const pinCount = Object.keys(components[node.component]?.pins ?? {}).length;
  const side = Math.max(3, Math.min(14, Math.sqrt(Math.max(pinCount, 4)) * 1.4));

  return { widthMm: side, heightMm: side };
}

function findCourtyardOverlaps(components: BoardComponentProjection[]): BoardDrcViolation[] {
  const placedComponents = components.filter((component) => component.placed);
  const violations: BoardDrcViolation[] = [];

  for (let leftIndex = 0; leftIndex < placedComponents.length; leftIndex += 1) {
    const left = placedComponents[leftIndex];

    if (!left) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < placedComponents.length; rightIndex += 1) {
      const right = placedComponents[rightIndex];

      if (!right || !componentBoundsOverlap(left, right)) {
        continue;
      }

      violations.push({
        componentIds: [left.id, right.id],
        id: `drc_overlap_${left.id}_${right.id}`,
        kind: "courtyard_overlap",
        message: `Footprint overlap: ${left.label} intersects ${right.label}`,
        severity: "error",
        target: {
          id: left.id,
          kind: "component"
        }
      });
    }
  }

  return violations;
}

function componentBoundsOverlap(left: BoardComponentProjection, right: BoardComponentProjection) {
  const leftBounds = componentBounds(left);
  const rightBounds = componentBounds(right);

  return (
    leftBounds.minX < rightBounds.maxX &&
    leftBounds.maxX > rightBounds.minX &&
    leftBounds.minY < rightBounds.maxY &&
    leftBounds.maxY > rightBounds.minY
  );
}

function componentBounds(component: BoardComponentProjection) {
  return {
    maxX: component.xMm + component.widthMm / 2,
    maxY: component.yMm + component.heightMm / 2,
    minX: component.xMm - component.widthMm / 2,
    minY: component.yMm - component.heightMm / 2
  };
}

function parseLengthMm(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  const match = /^(?<amount>-?\d+(?:\.\d+)?)(?<unit>mm|mil|in)?$/.exec(trimmed);

  if (!match?.groups) {
    return undefined;
  }

  const amount = Number(match.groups.amount);

  if (!Number.isFinite(amount)) {
    return undefined;
  }

  if (match.groups.unit === "in") {
    return amount * 25.4;
  }

  if (match.groups.unit === "mil") {
    return amount * 0.0254;
  }

  return amount;
}

function parseAngleDeg(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  const match = /^(?<amount>-?\d+(?:\.\d+)?)(?:deg)?$/.exec(trimmed);

  if (!match?.groups) {
    return undefined;
  }

  const amount = Number(match.groups.amount);

  return Number.isFinite(amount) ? amount : undefined;
}

function clampCenter(value: number, size: number, boardSize: number) {
  const margin = Math.min(1, boardSize / 20);
  const min = size / 2 + margin;
  const max = boardSize - size / 2 - margin;

  if (max < min) {
    return boardSize / 2;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeRotation(value: number) {
  return ((value % 360) + 360) % 360;
}

function isPlacementHint(value: unknown): value is PlacementHint {
  return typeof value === "object" && value !== null;
}

function componentLabel(componentId: string) {
  return componentId.split(":").pop()?.replaceAll("_", " ") ?? componentId;
}
