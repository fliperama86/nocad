import { hitTestScene } from "@nocad/editor-core";
import { describe, expect, it } from "vitest";

import { buildSchematicProjection } from "./schematic-projection";
import { resolveFixtureProject } from "./fixture-environment";
import { createRp2350HdmiTxSliceProject, hdmiTxSliceIds } from "./samples";
import type { ProjectSource, ResolvedProject } from "./types";

describe("buildSchematicProjection", () => {
  it("projects the HDMI transmitter sample into selectable symbols and resolved nets", () => {
    const project = createRp2350HdmiTxSliceProject();
    const projection = buildSchematicProjection(project, resolveFixtureProject(project));

    expect(projection.diagnostics).toEqual([]);
    expect(projection.nodes.map(({ id }) => id)).toEqual(expect.arrayContaining([
      hdmiTxSliceIds.hdmiPort,
      hdmiTxSliceIds.rail5v,
      hdmiTxSliceIds.tx,
      hdmiTxSliceIds.videoSource
    ]));
    expect(projection.nodes).toHaveLength(12);
    expect(projection.connections).toHaveLength(42);
    expect(projection.scene.primitives.filter(({ kind }) => kind === "rect")).toHaveLength(12);
  });

  it("projects authored and generated electrical objects with graph source references", () => {
    const projection = buildSchematicProjection(source(), resolved());

    expect(projection.nodes.map(({ id }) => id)).toEqual(["generated-part", "sink", "source"]);
    expect(projection.connections.map(({ id }) => id)).toEqual(["net-a", "net-b"]);
    expect(projection.nodes.find(({ id }) => id === "source")?.source).toEqual({ id: "source", kind: "node" });
    expect(projection.nodes.find(({ id }) => id === "generated-part")?.source).toEqual({
      id: "edge-a",
      kind: "edge",
      path: ["generated", "generated-part"]
    });
    expect(projection.connections.find(({ id }) => id === "net-a")?.source).toEqual({
      id: "edge-a",
      kind: "edge",
      path: ["nets", "net-a"]
    });
    expect(projection.nodes.some(({ id }) => id === "function-node")).toBe(false);

    const sourceBody = projection.scene.primitives.find(({ id }) => id === "node/source/body");
    expect(sourceBody).toBeDefined();
    expect(hitTestScene(projection.scene, { x: 100, y: 100 })[0]?.primitive.source).toEqual({
      id: "source",
      kind: "node"
    });

    const generatedPort = projection.nodes.find(({ id }) => id === "generated-part")?.ports[0];
    expect(generatedPort).toBeDefined();
    expect(hitTestScene(projection.scene, generatedPort!.position)[0]?.primitive.source).toEqual({
      id: "edge-a",
      kind: "edge",
      path: ["generated", "generated-part", "pins", "1"]
    });
  });

  it("is stable across source, generated-object, and resolved-net permutations", () => {
    const baseSource = source();
    const baseResolved = resolved();
    const expected = buildSchematicProjection(baseSource, baseResolved);

    expect(
      buildSchematicProjection(
        { ...baseSource, nodes: [...baseSource.nodes].reverse() },
        {
          ...baseResolved,
          generated: [...baseResolved.generated].reverse(),
          nets: [...baseResolved.nets].reverse()
        }
      )
    ).toEqual(expected);
  });
});

function source(): ProjectSource {
  return {
    schema: "nocad.project.v0",
    id: "projection-test",
    name: "Projection test",
    dependencies: {},
    nodes: [
      { id: "sink", kind: "component", component: "vendor:sink", label: "Sink" },
      { id: "function-node", kind: "intent.function", function: "vendor:function" },
      { id: "source", kind: "component", component: "vendor:source", label: "Source" }
    ],
    edges: []
  };
}

function resolved(): ResolvedProject {
  return {
    schema: "nocad.lock.v0",
    sourceSet: { files: [], hash: "sha256:test" },
    resolver: { name: "nocad-resolver", version: "test" },
    dependencies: {},
    resolvedChoices: [],
    diagnostics: [],
    generated: [
      {
        id: "generated-part",
        kind: "component",
        component: "vendor:part",
        connects: ["net-a", "net-b"],
        sourceEdge: "edge-a",
        sourceMap: { edge: "edge-a", feature: "feature-a" },
        value: "value-a"
      }
    ],
    nets: [
      {
        id: "net-b",
        name: "B",
        endpoints: [
          { node: "generated-part", pin: "2" },
          { node: "sink", pin: "input" }
        ],
        direction: "from_to_to",
        sourceEdge: "edge-a",
        sourceMap: { edge: "edge-a", signal: "b" }
      },
      {
        id: "net-a",
        name: "A",
        endpoints: [
          { node: "source", pin: "output" },
          { node: "generated-part", pin: "1" }
        ],
        direction: "from_to_to",
        sourceEdge: "edge-a",
        sourceMap: { edge: "edge-a", signal: "a" }
      }
    ]
  };
}
