import { describe, expect, it } from "vitest";

import {
  createViewportTransform,
  panViewport,
  viewportToWorld,
  worldRectToViewport,
  worldToViewport,
  zoomViewportAt
} from "./viewport";

describe("viewport transforms", () => {
  it("round-trips world and viewport points", () => {
    const viewport = createViewportTransform({
      offset: { x: 120, y: -45 },
      zoom: 2.5
    });
    const world = { x: -8, y: 19 };

    expect(viewportToWorld(worldToViewport(world, viewport), viewport)).toEqual(world);
    expect(worldRectToViewport({ x: 4, y: 6, width: 20, height: 12 }, viewport)).toEqual({
      x: 130,
      y: -30,
      width: 50,
      height: 30
    });
  });

  it("pans in viewport coordinates without changing zoom", () => {
    expect(
      panViewport(
        { offset: { x: 10, y: 20 }, zoom: 3 },
        { x: -4, y: 7 }
      )
    ).toEqual({ offset: { x: 6, y: 27 }, zoom: 3 });
  });

  it("keeps the anchored world point fixed while zooming and clamps limits", () => {
    const viewport = { offset: { x: 30, y: 50 }, zoom: 2 };
    const anchor = { x: 90, y: 110 };
    const before = viewportToWorld(anchor, viewport);
    const zoomed = zoomViewportAt(viewport, 20, anchor, { minZoom: 0.5, maxZoom: 4 });

    expect(zoomed.zoom).toBe(4);
    expect(worldToViewport(before, zoomed)).toEqual(anchor);
  });

  it("rejects invalid zoom and coordinates", () => {
    expect(() => createViewportTransform({ zoom: 0 })).toThrow(RangeError);
    expect(() => panViewport(createViewportTransform(), { x: Number.NaN, y: 0 })).toThrow(RangeError);
    expect(() => zoomViewportAt(createViewportTransform(), 2, { x: 0, y: 0 }, { minZoom: 3, maxZoom: 2 }))
      .toThrow(RangeError);
  });
});
