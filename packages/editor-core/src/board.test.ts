import { describe, expect, it } from "vitest";

import { hitTestBoardScene, projectBoardScene } from "./board";
import type { BoardSceneInput } from "./board";
import { orientedRectCorners, orientedRectsOverlap } from "./geometry";

const input: BoardSceneInput = {
  board: {
    bounds: { x: 0, y: 0, width: 100, height: 60 },
    id: "main",
    source: { id: "main", kind: "board" }
  },
  components: [
    {
      center: { x: 25, y: 20 },
      id: "controller",
      rotationDeg: 45,
      size: { width: 20, height: 10 },
      source: { id: "controller", kind: "node" }
    },
    {
      center: { x: 75, y: 40 },
      id: "generated",
      rotationDeg: 0,
      size: { width: 8, height: 4 },
      source: { id: "edge-a", kind: "edge", path: ["generated", "generated"] }
    }
  ],
  connections: [
    {
      from: { x: 25, y: 20 },
      id: "net-a",
      source: { id: "edge-a", kind: "edge", path: ["nets", "net-a"] },
      to: { x: 75, y: 40 }
    }
  ]
};

describe("portable board scene", () => {
  it("projects rotated component geometry, connections, and source references", () => {
    const projection = projectBoardScene(input);

    expect(projection.diagnostics).toEqual([]);
    expect(projection.components.map(({ id }) => id)).toEqual(["controller", "generated"]);
    expect(projection.connections.map(({ id }) => id)).toEqual(["net-a"]);
    expect(projection.components[0]?.corners).toEqual(
      orientedRectCorners(input.components[0]!)
    );
    expect(projection.scene.bounds).toEqual(input.board.bounds);
    expect(projection.scene.primitives.map(({ id, source }) => ({ id, source }))).toEqual([
      { id: "board/main", source: input.board.source },
      { id: "board/connection/net-a", source: input.connections[0]?.source },
      { id: "board/component/controller", source: input.components[0]?.source },
      { id: "board/component/generated", source: input.components[1]?.source }
    ]);
  });

  it("is exactly stable across component and connection permutations", () => {
    const secondConnection = {
      from: { x: 10, y: 10 },
      id: "net-b",
      source: { id: "edge-b", kind: "edge" },
      to: { x: 90, y: 50 }
    };
    const forward = projectBoardScene({
      ...input,
      connections: [...input.connections, secondConnection]
    });
    const reversed = projectBoardScene({
      ...input,
      components: [...input.components].reverse(),
      connections: [secondConnection, ...input.connections]
    });

    expect(reversed).toEqual(forward);
  });

  it("hits rotated footprints accurately and prioritizes them over connections", () => {
    const projection = projectBoardScene(input);

    expect(hitTestBoardScene(projection, { x: 25, y: 20 })[0]).toEqual({
      distance: 0,
      id: "controller",
      kind: "component",
      source: { id: "controller", kind: "node" }
    });
    expect(hitTestBoardScene(projection, { x: 34, y: 29 })).toEqual([]);
    expect(hitTestBoardScene(projection, { x: 50, y: 30 }, 0.1)[0]).toMatchObject({
      id: "net-a",
      kind: "connection",
      source: { id: "edge-a", kind: "edge", path: ["nets", "net-a"] }
    });
  });

  it("omits all duplicate occurrences with deterministic diagnostics", () => {
    const duplicate = projectBoardScene({
      ...input,
      components: [input.components[0]!, input.components[0]!],
      connections: [input.connections[0]!, input.connections[0]!]
    });

    expect(duplicate.components).toEqual([]);
    expect(duplicate.connections).toEqual([]);
    expect(duplicate.diagnostics).toEqual([
      {
        code: "DUPLICATE_COMPONENT_ID",
        id: "controller",
        message: "Duplicate component id \"controller\"; all occurrences were ignored."
      },
      {
        code: "DUPLICATE_CONNECTION_ID",
        id: "net-a",
        message: "Duplicate connection id \"net-a\"; all occurrences were ignored."
      }
    ]);
  });

  it("rejects invalid board and connection geometry", () => {
    expect(() => projectBoardScene({
      ...input,
      board: { ...input.board, bounds: { x: 0, y: 0, width: 0, height: 10 } }
    })).toThrow(RangeError);
    expect(() => projectBoardScene({
      ...input,
      connections: [{
        ...input.connections[0]!,
        to: { x: Number.NaN, y: 0 }
      }]
    })).toThrow(RangeError);
  });
});

describe("oriented rectangle geometry", () => {
  it("detects rotated overlap while treating edge contact as non-overlap", () => {
    const base = {
      center: { x: 0, y: 0 },
      rotationDeg: 45,
      size: { width: 10, height: 4 }
    };

    expect(orientedRectsOverlap(base, {
      center: { x: 3, y: 0 },
      rotationDeg: -20,
      size: { width: 6, height: 4 }
    })).toBe(true);
    expect(orientedRectsOverlap(
      { center: { x: 0, y: 0 }, rotationDeg: 0, size: { width: 10, height: 4 } },
      { center: { x: 10, y: 0 }, rotationDeg: 0, size: { width: 10, height: 4 } }
    )).toBe(false);
  });

  it("rejects invalid dimensions", () => {
    expect(() => orientedRectCorners({
      center: { x: 0, y: 0 },
      rotationDeg: 0,
      size: { width: 0, height: 2 }
    })).toThrow(RangeError);
  });
});
