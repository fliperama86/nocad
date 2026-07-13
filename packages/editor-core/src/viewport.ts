import type { Point, Rect } from "./geometry";

export type ViewportTransform = Readonly<{
  offset: Point;
  zoom: number;
}>;

export type ViewportLimits = Readonly<{
  maxZoom?: number;
  minZoom?: number;
}>;

export function createViewportTransform(
  transform: Partial<ViewportTransform> = {}
): ViewportTransform {
  const viewport = {
    offset: transform.offset ?? { x: 0, y: 0 },
    zoom: transform.zoom ?? 1
  };

  assertViewport(viewport);
  return viewport;
}

export function worldToViewport(point: Point, viewport: ViewportTransform): Point {
  assertViewport(viewport);

  return {
    x: point.x * viewport.zoom + viewport.offset.x,
    y: point.y * viewport.zoom + viewport.offset.y
  };
}

export function viewportToWorld(point: Point, viewport: ViewportTransform): Point {
  assertViewport(viewport);

  return {
    x: (point.x - viewport.offset.x) / viewport.zoom,
    y: (point.y - viewport.offset.y) / viewport.zoom
  };
}

export function worldRectToViewport(rect: Rect, viewport: ViewportTransform): Rect {
  const origin = worldToViewport(rect, viewport);

  return {
    ...origin,
    height: rect.height * viewport.zoom,
    width: rect.width * viewport.zoom
  };
}

export function viewportRectToWorld(rect: Rect, viewport: ViewportTransform): Rect {
  const origin = viewportToWorld(rect, viewport);

  return {
    ...origin,
    height: rect.height / viewport.zoom,
    width: rect.width / viewport.zoom
  };
}

export function panViewport(viewport: ViewportTransform, delta: Point): ViewportTransform {
  assertViewport(viewport);
  assertFinitePoint(delta, "pan delta");

  return {
    offset: {
      x: viewport.offset.x + delta.x,
      y: viewport.offset.y + delta.y
    },
    zoom: viewport.zoom
  };
}

export function zoomViewportAt(
  viewport: ViewportTransform,
  nextZoom: number,
  anchor: Point,
  limits: ViewportLimits = {}
): ViewportTransform {
  assertViewport(viewport);
  assertFinitePoint(anchor, "zoom anchor");
  const zoom = clampZoom(nextZoom, limits);
  const worldAnchor = viewportToWorld(anchor, viewport);

  return {
    offset: {
      x: anchor.x - worldAnchor.x * zoom,
      y: anchor.y - worldAnchor.y * zoom
    },
    zoom
  };
}

function clampZoom(zoom: number, limits: ViewportLimits): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError("Viewport zoom must be a positive finite number.");
  }

  const minimum = limits.minZoom ?? Number.MIN_VALUE;
  const maximum = limits.maxZoom ?? Number.MAX_VALUE;

  if (!Number.isFinite(minimum) || minimum <= 0 || !Number.isFinite(maximum) || maximum < minimum) {
    throw new RangeError("Viewport zoom limits must be finite, positive, and ordered.");
  }

  return Math.max(minimum, Math.min(maximum, zoom));
}

function assertViewport(viewport: ViewportTransform): void {
  assertFinitePoint(viewport.offset, "viewport offset");

  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
    throw new RangeError("Viewport zoom must be a positive finite number.");
  }
}

function assertFinitePoint(point: Point, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`${label} must contain finite coordinates.`);
  }
}
