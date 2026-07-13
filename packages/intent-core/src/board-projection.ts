import { orientedRectsOverlap, projectBoardScene } from "@nocad/editor-core";
import type { BoardSceneProjection, SceneSourceReference } from "@nocad/editor-core";

import type {
  ComponentDefinition,
  DefinitionCatalog,
  EndpointRef,
  GeneratedObject,
  ProjectNode,
  ProjectSource,
  ResolvedNet,
  ResolvedProject
} from "./types";

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
  scene: BoardSceneProjection;
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
  geometryApproximate: boolean;
  heightMm: number;
  label: string;
  package?: string;
  placed: boolean;
  placementHint?: GeneratedObject["placementHint"];
  refdesHint?: string;
  role?: string;
  rotationDeg: number;
  source: SceneSourceReference;
  violations: string[];
  widthMm: number;
  xMm: number;
  yMm: number;
};

export type BoardRatsnestEdge = {
  contract?: string;
  from: BoardPoint;
  fromEndpoint: EndpointRef;
  fromNode: string;
  id: string;
  kind: "highSpeed" | "power" | "signal";
  name: string;
  netId: string;
  signal: string;
  source: SceneSourceReference;
  sourceEdge: string;
  to: BoardPoint;
  toEndpoint: EndpointRef;
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
  kind: "drc" | "geometry" | "placement" | "routing";
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

export function buildBoardProjection(
  source: ProjectSource,
  resolved: ResolvedProject,
  catalog: DefinitionCatalog
): BoardProjection {
  const board = projectBoard(source);
  const componentNodes = source.nodes.filter((node): node is ProjectNode & { kind: "component" } => node.kind === "component");
  const componentsById = new Map<string, BoardComponentProjection>();
  const projectedComponents = componentNodes.map((node, index) => {
    const projected = projectComponent(
      node,
      index,
      componentNodes.length,
      board,
      source.layout?.placements[node.id],
      catalog
    );

    componentsById.set(node.id, projected);
    return projected;
  });
  const projectedGeneratedComponents = resolved.generated.map((generated, index) => {
    const projected = projectGeneratedComponent(
      generated,
      index,
      board,
      source,
      componentsById,
      source.layout?.placements[generated.id],
      catalog
    );

    componentsById.set(generated.id, projected);
    return projected;
  });
  const ratsnest = resolved.nets.flatMap((net) => projectRatsnest(net, source, componentsById));

  return completeBoardProjection(board, [...projectedComponents, ...projectedGeneratedComponents], ratsnest);
}

function projectBoard(source: ProjectSource): BoardProjection["board"] {
  if (!source.board) {
    throw new Error("A board projection requires authored board dimensions.");
  }

  const widthMm = parseLengthMm(source.board.size.width);
  const heightMm = parseLengthMm(source.board.size.height);

  if (
    widthMm === undefined ||
    heightMm === undefined ||
    widthMm <= 0 ||
    heightMm <= 0 ||
    !Number.isInteger(source.board.layers) ||
    source.board.layers <= 0
  ) {
    throw new Error("A board projection requires valid authored board dimensions.");
  }

  return {
    id: source.board.id,
    layers: source.board.layers,
    widthMm,
    heightMm
  };
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
  const ratsnest = rebuildRatsnest(projection.ratsnest, components);

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
  const geometryObligations = componentsWithViolations.flatMap((component) =>
    component.geometryApproximate
      ? [
          {
            id: `geometry_${component.id}`,
            kind: "geometry" as const,
            message: `Add an authored footprint envelope for ${component.label}`,
            severity: "warning" as const,
            sourceId: component.id,
            target: {
              id: component.id,
              kind: "component" as const
            }
          }
        ]
      : []
  );
  const drcObligations = drcViolations.map((violation) => ({
    id: violation.id,
    kind: "drc" as const,
    message: violation.message,
    severity: violation.severity,
    sourceId: violation.componentIds.join("+"),
    target: violation.target
  }));
  const routingObligations = uniqueRatsnestNets(ratsnest).map((edge) => ({
    id: `route_${encodeURIComponent(edge.netId)}`,
    kind: "routing" as const,
    message: `Route ${edge.name}`,
    severity: "warning" as const,
    sourceId: edge.sourceEdge,
    target: {
      id: edge.id,
      kind: "ratsnest" as const
    }
  }));
  const scene = projectBoardScene({
    board: {
      bounds: { x: 0, y: 0, width: board.widthMm, height: board.heightMm },
      id: board.id,
      source: { id: board.id, kind: "board" }
    },
    components: componentsWithViolations.map((component) => ({
      center: { x: component.xMm, y: component.yMm },
      id: component.id,
      rotationDeg: component.rotationDeg,
      size: { width: component.widthMm, height: component.heightMm },
      source: component.source
    })),
    connections: ratsnest.map((edge) => ({
      from: { x: edge.from.xMm, y: edge.from.yMm },
      id: edge.id,
      source: edge.source,
      to: { x: edge.to.xMm, y: edge.to.yMm }
    }))
  });

  return {
    board,
    components: componentsWithViolations,
    drcViolations,
    obligations: [...drcObligations, ...geometryObligations, ...placementObligations, ...routingObligations],
    ratsnest,
    scene,
    stats: {
      drcViolations: drcViolations.length,
      placedComponents: componentsWithViolations.filter((component) => component.placed).length,
      totalComponents: componentsWithViolations.length,
      unroutedNets: routingObligations.length
    }
  };
}

function uniqueRatsnestNets(ratsnest: BoardRatsnestEdge[]): BoardRatsnestEdge[] {
  const firstSegmentByNet = new Map<string, BoardRatsnestEdge>();

  for (const edge of ratsnest) {
    if (!firstSegmentByNet.has(edge.netId)) {
      firstSegmentByNet.set(edge.netId, edge);
    }
  }

  return [...firstSegmentByNet.values()];
}

function projectComponent(
  node: ProjectNode & { kind: "component" },
  index: number,
  componentCount: number,
  board: BoardProjection["board"],
  placement: unknown,
  catalog: DefinitionCatalog
): BoardComponentProjection {
  const definition = catalog.components[node.component];
  const footprint = footprintEnvelope(definition);
  const authored = authoredPlacement(placement);
  const hinted = authored ? undefined : hintedPlacement(index, componentCount, board);
  const xMm = clampCenter(authored?.xMm ?? hinted?.xMm ?? board.widthMm / 2, footprint.widthMm, board.widthMm);
  const yMm = clampCenter(authored?.yMm ?? hinted?.yMm ?? board.heightMm / 2, footprint.heightMm, board.heightMm);

  return {
    id: node.id,
    component: node.component,
    geometryApproximate: footprint.approximate,
    heightMm: footprint.heightMm,
    label: node.label ?? componentLabel(node.component),
    package: node.package,
    placed: Boolean(authored),
    refdesHint: node.refdesHint,
    role: node.role,
    rotationDeg: authored?.rotationDeg ?? hinted?.rotationDeg ?? 0,
    source: { id: node.id, kind: "node" },
    violations: [],
    widthMm: footprint.widthMm,
    xMm,
    yMm
  };
}

function projectGeneratedComponent(
  generated: GeneratedObject,
  index: number,
  board: BoardProjection["board"],
  source: ProjectSource,
  componentsById: Map<string, BoardComponentProjection>,
  placement: unknown,
  catalog: DefinitionCatalog
): BoardComponentProjection {
  const node: ProjectNode & { kind: "component" } = {
    id: generated.id,
    kind: "component",
    component: generated.component,
    label: generated.value ? `${componentLabel(generated.component)} ${generated.value}` : componentLabel(generated.component),
    role: "generated"
  };
  const footprint = footprintEnvelope(catalog.components[generated.component]);
  const authored = authoredPlacement(placement);
  const anchorId = generatedPlacementAnchor(generated, source);
  const anchor = anchorId ? componentsById.get(anchorId) : undefined;
  const offset = 2.5 + (index % 4) * 1.5;
  const xMm = clampCenter(
    authored?.xMm ?? (anchor ? anchor.xMm + offset : board.widthMm / 2),
    footprint.widthMm,
    board.widthMm
  );
  const yMm = clampCenter(
    authored?.yMm ?? (anchor ? anchor.yMm + ((index % 3) - 1) * 1.5 : board.heightMm / 2),
    footprint.heightMm,
    board.heightMm
  );

  return {
    id: generated.id,
    component: generated.component,
    geometryApproximate: footprint.approximate,
    heightMm: footprint.heightMm,
    label: node.label ?? componentLabel(generated.component),
    placed: Boolean(authored),
    placementHint: generated.placementHint,
    role: node.role,
    rotationDeg: authored?.rotationDeg ?? 0,
    source: {
      id: generated.sourceEdge,
      kind: "edge",
      path: ["generated", generated.id]
    },
    violations: [],
    widthMm: footprint.widthMm,
    xMm,
    yMm
  };
}

function generatedPlacementAnchor(generated: GeneratedObject, source: ProjectSource) {
  const hint = generated.placementHint;

  if (!hint) {
    return undefined;
  }

  const edge = source.edges.find((candidate) => candidate.id === hint.edge);

  if (!edge || edge.kind === "net.binding" || edge.kind === "net.authored") {
    return undefined;
  }

  if (hint.near === "provider") {
    return edge.from.node;
  }

  if (edge.kind !== "intent.provides") {
    return edge.to.node;
  }

  const exposure = source.edges.find(
    (candidate): candidate is Extract<ProjectSource["edges"][number], { kind: "intent.exposes" }> =>
      candidate.kind === "intent.exposes" &&
      candidate.from.node === edge.to.node &&
      candidate.contract === edge.contract
  );

  return exposure?.to.node;
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
  index: number,
  componentCount: number,
  board: BoardProjection["board"]
) {
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
  return createRatsnestSegments(
    {
      contract: contractForEdge(source, net.realizes?.edge ?? net.sourceEdge),
      endpoints: net.endpoints,
      id: net.id,
      kind: ratsnestKind(net),
      name: net.name,
      signal: net.realizes?.signal ?? net.sourceMap.signal,
      sourceEdge: net.sourceEdge
    },
    componentsById
  );
}

type RatsnestNet = {
  contract?: string;
  endpoints: readonly EndpointRef[];
  id: string;
  kind: BoardRatsnestEdge["kind"];
  name: string;
  signal: string;
  sourceEdge: string;
};

function createRatsnestSegments(
  net: RatsnestNet,
  componentsById: ReadonlyMap<string, BoardComponentProjection>
): BoardRatsnestEdge[] {
  const endpoints = canonicalEndpoints(net.endpoints).flatMap((endpoint) => {
    const component = componentsById.get(endpoint.node);

    return component ? [{ component, endpoint, key: endpointKey(endpoint) }] : [];
  });

  if (endpoints.length < 2) {
    return [];
  }

  return minimumSpanningTree(endpoints)
    .sort((left, right) => left.pairKey.localeCompare(right.pairKey))
    .map(({ left, pairKey, right }) => {
      const segmentId = endpoints.length === 2 ? net.id : `${net.id}:segment:${pairKey}`;

      return {
        contract: net.contract,
        from: { xMm: left.component.xMm, yMm: left.component.yMm },
        fromEndpoint: left.endpoint,
        fromNode: left.component.id,
        id: segmentId,
        kind: net.kind,
        name: net.name,
        netId: net.id,
        signal: net.signal,
        source: {
          id: net.sourceEdge,
          kind: "edge",
          path: ["nets", net.id, "segments", pairKey]
        },
        sourceEdge: net.sourceEdge,
        to: { xMm: right.component.xMm, yMm: right.component.yMm },
        toEndpoint: right.endpoint,
        toNode: right.component.id
      };
    });
}

function rebuildRatsnest(
  edges: readonly BoardRatsnestEdge[],
  components: readonly BoardComponentProjection[]
): BoardRatsnestEdge[] {
  const componentsById = new Map(components.map((component) => [component.id, component]));
  const edgesByNet = new Map<string, BoardRatsnestEdge[]>();

  for (const edge of edges) {
    const current = edgesByNet.get(edge.netId) ?? [];
    current.push(edge);
    edgesByNet.set(edge.netId, current);
  }

  return [...edgesByNet.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([netId, netEdges]) => {
      const first = [...netEdges].sort((left, right) => left.id.localeCompare(right.id))[0];

      if (!first) return [];
      const endpointsByKey = new Map<string, EndpointRef>();
      for (const edge of netEdges) {
        endpointsByKey.set(endpointKey(edge.fromEndpoint), edge.fromEndpoint);
        endpointsByKey.set(endpointKey(edge.toEndpoint), edge.toEndpoint);
      }

      return createRatsnestSegments(
        {
          contract: first.contract,
          endpoints: [...endpointsByKey.values()],
          id: netId,
          kind: first.kind,
          name: first.name,
          signal: first.signal,
          sourceEdge: first.sourceEdge
        },
        componentsById
      );
    });
}

type ProjectedEndpoint = {
  component: BoardComponentProjection;
  endpoint: EndpointRef;
  key: string;
};

type EndpointPair = {
  distanceSquared: number;
  left: ProjectedEndpoint;
  pairKey: string;
  right: ProjectedEndpoint;
};

function minimumSpanningTree(endpoints: readonly ProjectedEndpoint[]): EndpointPair[] {
  const candidates: EndpointPair[] = [];

  for (let leftIndex = 0; leftIndex < endpoints.length; leftIndex += 1) {
    const left = endpoints[leftIndex];

    if (!left) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < endpoints.length; rightIndex += 1) {
      const right = endpoints[rightIndex];

      if (!right) continue;
      candidates.push({
        distanceSquared:
          (right.component.xMm - left.component.xMm) ** 2 +
          (right.component.yMm - left.component.yMm) ** 2,
        left,
        pairKey: endpointPairKey(left, right),
        right
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.distanceSquared - right.distanceSquared || left.pairKey.localeCompare(right.pairKey)
  );
  const parent = new Map(endpoints.map(({ key }) => [key, key]));
  const selected: EndpointPair[] = [];

  for (const candidate of candidates) {
    const leftRoot = findEndpointRoot(parent, candidate.left.key);
    const rightRoot = findEndpointRoot(parent, candidate.right.key);

    if (leftRoot === rightRoot) continue;
    parent.set(rightRoot, leftRoot.localeCompare(rightRoot) <= 0 ? leftRoot : rightRoot);
    parent.set(leftRoot, leftRoot.localeCompare(rightRoot) <= 0 ? leftRoot : rightRoot);
    selected.push(candidate);
    if (selected.length === endpoints.length - 1) break;
  }

  return selected;
}

function findEndpointRoot(parent: Map<string, string>, key: string): string {
  const next = parent.get(key);

  if (!next || next === key) return key;
  const root = findEndpointRoot(parent, next);
  parent.set(key, root);
  return root;
}

function endpointPairKey(left: ProjectedEndpoint, right: ProjectedEndpoint): string {
  return [left.key, right.key].sort().map(encodeURIComponent).join("--");
}

function endpointKey(endpoint: EndpointRef): string {
  return `${endpoint.node}\u0000${endpoint.pin ?? ""}\u0000${endpoint.port ?? ""}`;
}

function canonicalEndpoints(endpoints: readonly EndpointRef[]): EndpointRef[] {
  return [...endpoints].sort(
    (left, right) =>
      left.node.localeCompare(right.node) ||
      (left.pin ?? "").localeCompare(right.pin ?? "") ||
      (left.port ?? "").localeCompare(right.port ?? "")
  );
}

function contractForEdge(source: ProjectSource, edgeId: string) {
  const edge = source.edges.find((candidate) => candidate.id === edgeId);

  return edge && (edge.kind === "intent.connection" || edge.kind === "intent.exposes" || edge.kind === "intent.provides")
    ? edge.contract
    : undefined;
}

function ratsnestKind(net: ResolvedNet): BoardRatsnestEdge["kind"] {
  return net.boardKind ?? "signal";
}

function footprintEnvelope(definition: ComponentDefinition | undefined) {
  if (definition?.board?.envelope) {
    return {
      ...definition.board.envelope,
      approximate: definition.board.envelope.accuracy !== "verified"
    };
  }

  const pinCount = Object.keys(definition?.pins ?? {}).length;
  const side = Math.max(3, Math.min(14, Math.sqrt(Math.max(pinCount, 4)) * 1.4));

  return { widthMm: side, heightMm: side, approximate: true };
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
  return orientedRectsOverlap(
    {
      center: { x: left.xMm, y: left.yMm },
      rotationDeg: left.rotationDeg,
      size: { width: left.widthMm, height: left.heightMm }
    },
    {
      center: { x: right.xMm, y: right.yMm },
      rotationDeg: right.rotationDeg,
      size: { width: right.widthMm, height: right.heightMm }
    }
  );
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
