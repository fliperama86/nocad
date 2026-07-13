import { orientedRectCorners } from "./geometry";
import type { Point, Rect, Size } from "./geometry";
import { hitTestScene } from "./hit-test";
import type { Scene, ScenePrimitive, SceneSourceReference } from "./scene";

export type BoardSceneComponentInput = Readonly<{
  center: Point;
  id: string;
  rotationDeg: number;
  size: Size;
  source: SceneSourceReference;
}>;

export type BoardSceneConnectionInput = Readonly<{
  from: Point;
  id: string;
  source: SceneSourceReference;
  to: Point;
}>;

export type BoardSceneInput = Readonly<{
  board: Readonly<{
    bounds: Rect;
    id: string;
    source: SceneSourceReference;
  }>;
  components: readonly BoardSceneComponentInput[];
  connections: readonly BoardSceneConnectionInput[];
}>;

export type BoardSceneComponent = BoardSceneComponentInput &
  Readonly<{
    corners: readonly [Point, Point, Point, Point];
    primitiveId: string;
  }>;

export type BoardSceneConnection = BoardSceneConnectionInput &
  Readonly<{
    primitiveId: string;
  }>;

export type BoardSceneDiagnostic = Readonly<{
  code: "DUPLICATE_COMPONENT_ID" | "DUPLICATE_CONNECTION_ID";
  id: string;
  message: string;
}>;

export type BoardSceneProjection = Readonly<{
  board: BoardSceneInput["board"];
  components: readonly BoardSceneComponent[];
  connections: readonly BoardSceneConnection[];
  diagnostics: readonly BoardSceneDiagnostic[];
  scene: Scene;
}>;

export type BoardSceneHit = Readonly<{
  distance: number;
  id: string;
  kind: "component" | "connection";
  source: SceneSourceReference;
}>;

export function projectBoardScene(input: BoardSceneInput): BoardSceneProjection {
  assertBoardBounds(input.board.bounds);
  input.connections.forEach(assertConnection);
  const diagnostics: BoardSceneDiagnostic[] = [];
  const componentInputs = uniqueById(
    input.components,
    "DUPLICATE_COMPONENT_ID",
    "component",
    diagnostics
  );
  const connectionInputs = uniqueById(
    input.connections,
    "DUPLICATE_CONNECTION_ID",
    "connection",
    diagnostics
  );
  const components = componentInputs.map((component): BoardSceneComponent => ({
    ...component,
    corners: orientedRectCorners(component),
    primitiveId: componentPrimitiveId(component.id)
  }));
  const connections = connectionInputs.map((connection): BoardSceneConnection => ({
    ...connection,
    primitiveId: connectionPrimitiveId(connection.id)
  }));
  const primitives: ScenePrimitive[] = [
    {
      bounds: input.board.bounds,
      id: boardPrimitiveId(input.board.id),
      interactive: false,
      kind: "rect",
      layer: "board",
      pickMode: "none",
      source: input.board.source,
      zIndex: 0
    },
    ...connections.map((connection) => ({
      end: connection.to,
      id: connection.primitiveId,
      kind: "line" as const,
      layer: "connections",
      source: connection.source,
      start: connection.from,
      strokeWidth: 0,
      zIndex: 10
    })),
    ...components.map((component) => ({
      closed: true,
      id: component.primitiveId,
      kind: "polyline" as const,
      layer: "components",
      pickMode: "fill-and-stroke" as const,
      points: component.corners,
      source: component.source,
      strokeWidth: 0,
      zIndex: 20
    }))
  ];

  return {
    board: input.board,
    components,
    connections,
    diagnostics,
    scene: {
      bounds: input.board.bounds,
      primitives
    }
  };
}

export function hitTestBoardScene(
  projection: BoardSceneProjection,
  point: Point,
  tolerance = 0
): BoardSceneHit[] {
  const objectByPrimitive = new Map<string, { id: string; kind: BoardSceneHit["kind"] }>([
    ...projection.components.map((component) => [
      component.primitiveId,
      { id: component.id, kind: "component" as const }
    ] as const),
    ...projection.connections.map((connection) => [
      connection.primitiveId,
      { id: connection.id, kind: "connection" as const }
    ] as const)
  ]);

  return hitTestScene(projection.scene, point, { tolerance }).flatMap((hit) => {
    const object = objectByPrimitive.get(hit.primitive.id);

    return object
      ? [{
          distance: hit.distance,
          id: object.id,
          kind: object.kind,
          source: hit.primitive.source
        }]
      : [];
  });
}

function uniqueById<T extends { id: string }>(
  values: readonly T[],
  code: BoardSceneDiagnostic["code"],
  noun: string,
  diagnostics: BoardSceneDiagnostic[]
): T[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
  }

  for (const [id, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
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

function boardPrimitiveId(id: string) {
  return `board/${encodeURIComponent(id)}`;
}

function componentPrimitiveId(id: string) {
  return `board/component/${encodeURIComponent(id)}`;
}

function connectionPrimitiveId(id: string) {
  return `board/connection/${encodeURIComponent(id)}`;
}

function assertBoardBounds(bounds: Rect): void {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new RangeError("Board scene bounds require finite coordinates and positive dimensions.");
  }
}

function assertConnection(connection: BoardSceneConnectionInput): void {
  if (
    !Number.isFinite(connection.from.x) ||
    !Number.isFinite(connection.from.y) ||
    !Number.isFinite(connection.to.x) ||
    !Number.isFinite(connection.to.y)
  ) {
    throw new RangeError(`Board connection "${connection.id}" requires finite endpoints.`);
  }
}
