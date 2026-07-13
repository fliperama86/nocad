import {
  distanceBetweenPoints,
  distanceToSegment,
  normalizeRect,
  pointInPolygon,
  rectContainsPoint
} from "./geometry";
import type { Point, Rect } from "./geometry";
import type { Scene, ScenePickMode, ScenePrimitive } from "./scene";

export type HitTestOptions = Readonly<{
  includeNonInteractive?: boolean;
  layers?: readonly string[];
  tolerance?: number;
}>;

export type SceneHit = Readonly<{
  distance: number;
  primitive: ScenePrimitive;
}>;

export function hitTestPrimitive(
  primitive: ScenePrimitive,
  point: Point,
  tolerance = 0
): SceneHit | undefined {
  assertTolerance(tolerance);
  const mode = primitive.pickMode ?? defaultPickMode(primitive);

  if (mode === "none") {
    return undefined;
  }

  const distance = primitiveDistance(primitive, point, mode);
  const strokeAllowance = mode === "stroke" || mode === "fill-and-stroke"
    ? ("strokeWidth" in primitive ? primitive.strokeWidth ?? 0 : 0) / 2
    : 0;

  return distance <= tolerance + strokeAllowance ? { distance, primitive } : undefined;
}

export function hitTestScene(
  scene: Scene,
  point: Point,
  options: HitTestOptions = {}
): SceneHit[] {
  const tolerance = options.tolerance ?? 0;
  const layers = options.layers ? new Set(options.layers) : undefined;

  assertTolerance(tolerance);

  return scene.primitives
    .filter(
      (primitive) =>
        (options.includeNonInteractive || primitive.interactive !== false) &&
        (!layers || layers.has(primitive.layer))
    )
    .flatMap((primitive) => {
      const hit = hitTestPrimitive(primitive, point, tolerance);
      return hit ? [hit] : [];
    })
    .sort(
      (left, right) =>
        right.primitive.zIndex - left.primitive.zIndex ||
        left.distance - right.distance ||
        left.primitive.id.localeCompare(right.primitive.id)
    );
}

function primitiveDistance(
  primitive: ScenePrimitive,
  point: Point,
  mode: Exclude<ScenePickMode, "none">
): number {
  if (primitive.kind === "line") {
    return distanceToSegment(point, primitive.start, primitive.end);
  }

  if (primitive.kind === "polyline") {
    if ((mode === "fill" || mode === "fill-and-stroke") && primitive.closed && pointInPolygon(point, primitive.points)) {
      return 0;
    }

    return polylineDistance(point, primitive.points, Boolean(primitive.closed));
  }

  if (primitive.kind === "circle") {
    const radialDistance = distanceBetweenPoints(point, primitive.center);

    return mode === "fill" || mode === "fill-and-stroke"
      ? Math.max(0, radialDistance - primitive.radius)
      : Math.abs(radialDistance - primitive.radius);
  }

  if (primitive.kind === "rect") {
    return rectDistance(point, primitive.bounds, mode);
  }

  return rectContainsPoint(primitive.bounds, point) ? 0 : distanceToRect(point, primitive.bounds);
}

function rectDistance(point: Point, rect: Rect, mode: Exclude<ScenePickMode, "none">): number {
  const normalized = normalizeRect(rect);

  if (mode === "fill" || mode === "fill-and-stroke") {
    return rectContainsPoint(normalized, point) ? 0 : distanceToRect(point, normalized);
  }

  const topLeft = { x: normalized.x, y: normalized.y };
  const topRight = { x: normalized.x + normalized.width, y: normalized.y };
  const bottomRight = {
    x: normalized.x + normalized.width,
    y: normalized.y + normalized.height
  };
  const bottomLeft = { x: normalized.x, y: normalized.y + normalized.height };

  return Math.min(
    distanceToSegment(point, topLeft, topRight),
    distanceToSegment(point, topRight, bottomRight),
    distanceToSegment(point, bottomRight, bottomLeft),
    distanceToSegment(point, bottomLeft, topLeft)
  );
}

function distanceToRect(point: Point, rect: Rect): number {
  const normalized = normalizeRect(rect);
  const dx = Math.max(normalized.x - point.x, 0, point.x - (normalized.x + normalized.width));
  const dy = Math.max(normalized.y - point.y, 0, point.y - (normalized.y + normalized.height));

  return Math.hypot(dx, dy);
}

function polylineDistance(point: Point, points: readonly Point[], closed: boolean): number {
  if (points.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (points.length === 1) {
    return distanceBetweenPoints(point, points[0] as Point);
  }

  const distances: number[] = [];

  for (let index = 1; index < points.length; index += 1) {
    distances.push(distanceToSegment(point, points[index - 1] as Point, points[index] as Point));
  }

  if (closed) {
    distances.push(distanceToSegment(point, points[points.length - 1] as Point, points[0] as Point));
  }

  return Math.min(...distances);
}

function defaultPickMode(primitive: ScenePrimitive): ScenePickMode {
  return primitive.kind === "line" || primitive.kind === "polyline" ? "stroke" : "fill";
}

function assertTolerance(tolerance: number): void {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("Hit-test tolerance must be a non-negative finite number.");
  }
}
