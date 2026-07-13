import { describe, expect, it } from "vitest";

import type { SchematicProjectionInput } from "./schematic";
import { projectSchematic } from "./schematic";

const source: SchematicProjectionInput = {
  nodes: [
    {
      id: "controller",
      label: "Controller",
      ports: [
        { id: "out", side: "right" },
        { id: "power", side: "top" }
      ]
    },
    {
      id: "peripheral",
      label: "Peripheral",
      ports: [
        { id: "in", side: "left" }
      ]
    }
  ],
  connections: [
    {
      id: "data",
      from: { node: "controller", port: "out" },
      to: { node: "peripheral", port: "in" }
    }
  ]
};

describe("generic schematic projection", () => {
  it("projects nodes, ports, orthogonal connections, and source references", () => {
    const projection = projectSchematic(source, {
      columns: 2,
      gap: { width: 20, height: 30 },
      nodeSize: { width: 100, height: 60 },
      origin: { x: 10, y: 20 }
    });

    expect(projection.diagnostics).toEqual([]);
    expect(projection.nodes.map(({ id, bounds }) => ({ id, bounds }))).toEqual([
      { id: "controller", bounds: { x: 10, y: 20, width: 100, height: 60 } },
      { id: "peripheral", bounds: { x: 130, y: 20, width: 100, height: 60 } }
    ]);
    expect(projection.connections[0]?.points).toEqual([
      { x: 110, y: 50 },
      { x: 120, y: 50 },
      { x: 130, y: 50 }
    ]);
    expect(projection.scene.primitives.find(({ id }) => id === "node/controller/port/out")?.source)
      .toEqual({ kind: "node", id: "controller", path: ["ports", "out"] });
  });

  it("is exactly stable across node, port, and connection order permutations", () => {
    const additionalConnection = {
      id: "power-link",
      from: { node: "controller", port: "power" },
      to: { node: "peripheral", port: "in" }
    };
    const forward: SchematicProjectionInput = {
      nodes: source.nodes,
      connections: [...source.connections, additionalConnection]
    };
    const reversed: SchematicProjectionInput = {
      nodes: [...source.nodes]
        .reverse()
        .map((node) => ({ ...node, ports: [...(node.ports ?? [])].reverse() })),
      connections: [...forward.connections].reverse()
    };

    expect(projectSchematic(reversed)).toEqual(projectSchematic(forward));
  });

  it("honors explicit positions while assigning other nodes by canonical id", () => {
    const projection = projectSchematic({
      connections: [],
      nodes: [
        { id: "z", position: { x: 700, y: 800 } },
        { id: "a" }
      ]
    }, { columns: 2 });

    expect(projection.nodes.map(({ id, bounds }) => ({ id, x: bounds.x, y: bounds.y }))).toEqual([
      { id: "a", x: 40, y: 40 },
      { id: "z", x: 700, y: 800 }
    ]);
  });

  it("omits every duplicate and dangling connection with stable diagnostics", () => {
    const projection = projectSchematic({
      nodes: [
        { id: "duplicate", ports: [{ id: "p" }] },
        { id: "duplicate", ports: [{ id: "p" }] },
        { id: "valid", ports: [{ id: "same" }, { id: "same" }, { id: "out" }] }
      ],
      connections: [
        {
          id: "dangling",
          from: { node: "valid", port: "out" },
          to: { node: "missing", port: "in" }
        },
        {
          id: "repeated",
          from: { node: "valid", port: "out" },
          to: { node: "valid", port: "out" }
        },
        {
          id: "repeated",
          from: { node: "valid", port: "out" },
          to: { node: "valid", port: "out" }
        }
      ]
    });

    expect(projection.nodes.map(({ id }) => id)).toEqual(["valid"]);
    expect(projection.connections).toEqual([]);
    expect(projection.diagnostics.map(({ code, id }) => ({ code, id }))).toEqual([
      { code: "DUPLICATE_CONNECTION_ID", id: "repeated" },
      { code: "DUPLICATE_NODE_ID", id: "duplicate" },
      { code: "DUPLICATE_PORT_ID", id: "same" },
      { code: "MISSING_ENDPOINT", id: "dangling" }
    ]);
  });

  it("rejects non-finite coordinates and negative layout gaps", () => {
    expect(() => projectSchematic(source, { origin: { x: Number.NaN, y: 0 } })).toThrow(RangeError);
    expect(() => projectSchematic(source, { gap: { width: -1, height: 10 } })).toThrow(RangeError);
  });
});
