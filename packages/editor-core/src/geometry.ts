export type Point = Readonly<{
  x: number;
  y: number;
}>;

export type Size = Readonly<{
  height: number;
  width: number;
}>;

export type Rect = Point & Size;

export type OrientedRect = Readonly<{
  center: Point;
  rotationDeg: number;
  size: Size;
}>;

export function normalizeRect(rect: Rect): Rect {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;

  return {
    height: Math.abs(rect.height),
    width: Math.abs(rect.width),
    x,
    y
  };
}

export function rectContainsPoint(rect: Rect, point: Point, tolerance = 0): boolean {
  const normalized = normalizeRect(rect);

  return (
    point.x >= normalized.x - tolerance &&
    point.x <= normalized.x + normalized.width + tolerance &&
    point.y >= normalized.y - tolerance &&
    point.y <= normalized.y + normalized.height + tolerance
  );
}

export function distanceBetweenPoints(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (lengthSquared === 0) {
    return distanceBetweenPoints(point, start);
  }

  const projection =
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, projection));

  return Math.hypot(
    point.x - (start.x + clamped * segmentX),
    point.y - (start.y + clamped * segmentY)
  );
}

export function pointInPolygon(point: Point, vertices: readonly Point[]): boolean {
  if (vertices.length < 3) {
    return false;
  }

  let inside = false;

  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const currentPoint = vertices[index];
    const previousPoint = vertices[previous];

    if (!currentPoint || !previousPoint) {
      continue;
    }

    if (distanceToSegment(point, previousPoint, currentPoint) <= Number.EPSILON) {
      return true;
    }

    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;

    if (crosses) {
      inside = !inside;
    }
  }

  return inside;
}

export function boundingRect(points: readonly Point[]): Rect | undefined {
  if (points.length === 0) {
    return undefined;
  }

  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top
  };
}

export function orientedRectCorners(rect: OrientedRect): readonly [Point, Point, Point, Point] {
  assertOrientedRect(rect);
  const radians = (rect.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const halfWidth = rect.size.width / 2;
  const halfHeight = rect.size.height / 2;
  const localCorners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight }
  ] as const;
  const rotate = ({ x, y }: Point): Point => ({
    x: rect.center.x + x * cosine - y * sine,
    y: rect.center.y + x * sine + y * cosine
  });

  return [
    rotate(localCorners[0]),
    rotate(localCorners[1]),
    rotate(localCorners[2]),
    rotate(localCorners[3])
  ];
}

export function orientedRectsOverlap(left: OrientedRect, right: OrientedRect): boolean {
  const leftCorners = orientedRectCorners(left);
  const rightCorners = orientedRectCorners(right);
  const axes = [
    ...polygonAxes(leftCorners),
    ...polygonAxes(rightCorners)
  ];

  return axes.every((axis) => {
    const leftProjection = projectPolygon(leftCorners, axis);
    const rightProjection = projectPolygon(rightCorners, axis);

    return leftProjection.max > rightProjection.min && rightProjection.max > leftProjection.min;
  });
}

function polygonAxes(points: readonly Point[]): Point[] {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length] as Point;
    const edge = { x: next.x - point.x, y: next.y - point.y };
    const length = Math.hypot(edge.x, edge.y);

    return { x: -edge.y / length, y: edge.x / length };
  });
}

function projectPolygon(points: readonly Point[], axis: Point) {
  const values = points.map((point) => point.x * axis.x + point.y * axis.y);

  return { min: Math.min(...values), max: Math.max(...values) };
}

function assertOrientedRect(rect: OrientedRect): void {
  if (
    !Number.isFinite(rect.center.x) ||
    !Number.isFinite(rect.center.y) ||
    !Number.isFinite(rect.rotationDeg) ||
    !Number.isFinite(rect.size.width) ||
    !Number.isFinite(rect.size.height) ||
    rect.size.width <= 0 ||
    rect.size.height <= 0
  ) {
    throw new RangeError("Oriented rectangles require finite coordinates, rotation, and positive dimensions.");
  }
}
