import { describe, expect, it } from "vitest";

import type { Scene, ScenePrimitive } from "./scene";
import { hitTestPrimitive, hitTestScene } from "./hit-test";

const source = { kind: "test", id: "source" };

describe("geometry hit testing", () => {
  it("hits line and polyline strokes using width and tolerance", () => {
    const line: ScenePrimitive = {
      id: "line",
      kind: "line",
      layer: "wires",
      source,
      start: { x: 0, y: 0 },
      end: { x: 20, y: 0 },
      strokeWidth: 2,
      zIndex: 0
    };
    const polyline: ScenePrimitive = {
      id: "polyline",
      kind: "polyline",
      layer: "wires",
      source,
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      zIndex: 0
    };

    expect(hitTestPrimitive(line, { x: 10, y: 1 })).toMatchObject({ distance: 1 });
    expect(hitTestPrimitive(line, { x: 10, y: 2 })).toBeUndefined();
    expect(hitTestPrimitive(polyline, { x: 12, y: 8 }, 2)).toMatchObject({ distance: 2 });
  });

  it("supports fill and stroke modes for area primitives", () => {
    const rectangle: ScenePrimitive = {
      bounds: { x: 0, y: 0, width: 20, height: 10 },
      id: "rectangle",
      kind: "rect",
      layer: "symbols",
      pickMode: "stroke",
      source,
      strokeWidth: 2,
      zIndex: 0
    };
    const circle: ScenePrimitive = {
      center: { x: 30, y: 10 },
      id: "circle",
      kind: "circle",
      layer: "ports",
      radius: 5,
      source,
      zIndex: 0
    };
    const polygon: ScenePrimitive = {
      closed: true,
      id: "polygon",
      kind: "polyline",
      layer: "zones",
      pickMode: "fill-and-stroke",
      points: [{ x: 40, y: 0 }, { x: 50, y: 0 }, { x: 45, y: 10 }],
      source,
      zIndex: 0
    };

    expect(hitTestPrimitive(rectangle, { x: 10, y: 5 })).toBeUndefined();
    expect(hitTestPrimitive(rectangle, { x: 0, y: 5 })).toBeDefined();
    expect(hitTestPrimitive(circle, { x: 30, y: 10 })).toBeDefined();
    expect(hitTestPrimitive(polygon, { x: 45, y: 4 })).toBeDefined();
  });

  it("returns topmost hits deterministically and respects filters", () => {
    const primitive = (id: string, zIndex: number, layer = "symbols"): ScenePrimitive => ({
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      id,
      kind: "rect",
      layer,
      source,
      zIndex
    });
    const scene: Scene = {
      primitives: [
        primitive("same-z-b", 4),
        primitive("top", 10),
        { ...primitive("hidden", 20), interactive: false },
        primitive("same-z-a", 4),
        primitive("other-layer", 30, "annotations")
      ]
    };

    expect(hitTestScene(scene, { x: 5, y: 5 }).map(({ primitive: hit }) => hit.id)).toEqual([
      "other-layer",
      "top",
      "same-z-a",
      "same-z-b"
    ]);
    expect(hitTestScene(scene, { x: 5, y: 5 }, { layers: ["symbols"] }).map(({ primitive: hit }) => hit.id))
      .toEqual(["top", "same-z-a", "same-z-b"]);
    expect(hitTestScene(scene, { x: 5, y: 5 }, { includeNonInteractive: true })[0]?.primitive.id)
      .toBe("other-layer");
  });
});
