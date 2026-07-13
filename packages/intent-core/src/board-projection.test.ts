import { describe, expect, it } from "vitest";

import { applyBoardComponentPlacement, buildBoardProjection } from "./board-projection";
import { fixtureCatalog, resolveFixtureProject as resolveProject } from "./fixture-environment";
import {
  createHdmiSliceProject,
  createHdmiTxSliceProject,
  createI2cSliceProject,
  hdmiSliceIds,
  hdmiTxSliceIds,
  i2cSliceIds
} from "./samples";
import type { DefinitionCatalog, ProjectSource, ResolvedProject } from "./types";


describe("buildBoardProjection", () => {
  it("requires authored board dimensions instead of inventing a project board", () => {
    const source = createHdmiSliceProject();
    const { board: _board, layout: _layout, ...boardless } = source;

    expect(() => buildBoardProjection(boardless, resolveProject(boardless), fixtureCatalog)).toThrow(
      "A board projection requires authored board dimensions."
    );
  });

  it("projects board footprint envelopes and ratsnest from resolved nets", () => {
    const source = createHdmiTxSliceProject();
    const projection = buildBoardProjection(source, resolveProject(source), fixtureCatalog);

    expect(projection.board).toMatchObject({ widthMm: 60, heightMm: 40, layers: 4 });
    expect(projection.components.slice(0, 3).map((component) => component.id)).toEqual([
      hdmiTxSliceIds.videoSource,
      hdmiTxSliceIds.tx,
      hdmiTxSliceIds.hdmiPort
    ]);
    expect(projection.ratsnest.length).toBeGreaterThan(30);
    expect(projection.ratsnest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "highSpeed", signal: "tmds2_p" }),
        expect.objectContaining({ kind: "signal", signal: "sda" })
      ])
    );
    expect(projection.components.find(({ id }) => id === hdmiTxSliceIds.videoSource)?.source).toEqual({
      id: hdmiTxSliceIds.videoSource,
      kind: "node"
    });
    expect(projection.ratsnest[0]?.source).toMatchObject({
      id: projection.ratsnest[0]?.sourceEdge,
      kind: "edge",
      path: ["nets", projection.ratsnest[0]?.netId, "segments", expect.any(String)]
    });
    expect(projection.scene.scene.primitives).toHaveLength(
      1 + projection.components.length + projection.ratsnest.length
    );
    expect(projection.obligations.filter((obligation) => obligation.kind === "placement")).toHaveLength(11);
    expect(projection.stats.drcViolations).toBe(0);
  });

  it("reports approximate geometry when a component has no authored envelope", () => {
    const source = createHdmiSliceProject();
    const componentId = source.nodes.find((node) => node.kind === "component")?.id;
    const componentNode = source.nodes.find((node) => node.id === componentId);

    if (!componentId || componentNode?.kind !== "component") {
      throw new Error("Missing component fixture.");
    }

    const definition = fixtureCatalog.components[componentNode.component];

    if (!definition) {
      throw new Error("Missing component definition fixture.");
    }

    const { board: _board, ...definitionWithoutBoard } = definition;

    const catalog = {
      ...fixtureCatalog,
      components: {
        ...fixtureCatalog.components,
        [definition.id]: definitionWithoutBoard
      }
    };
    const projection = buildBoardProjection(source, resolveProject(source), catalog);

    expect(projection.components.find((component) => component.id === componentId)?.geometryApproximate).toBe(true);
    expect(projection.obligations).toContainEqual(
      expect.objectContaining({ id: `geometry_${componentId}`, kind: "geometry" })
    );
  });

  it("projects generated inline components and both split ratsnest segments", () => {
    const source = createHdmiSliceProject();
    const projection = buildBoardProjection(source, resolveProject(source), fixtureCatalog);
    const componentId = `series_${hdmiSliceIds.videoProvider}_tmds2_p`;
    const generatedComponents = projection.components.filter((component) =>
      component.id.startsWith(`series_${hdmiSliceIds.videoProvider}_`)
    );
    const generated = projection.components.find((component) => component.id === componentId);
    const splitSegments = projection.ratsnest.filter(
      (edge) => edge.signal === "tmds2_p" && edge.sourceEdge === hdmiSliceIds.videoProvider
    );
    const provider = projection.components.find((component) => component.id === hdmiSliceIds.mcu);

    expect(generatedComponents).toHaveLength(8);
    expect(generated).toMatchObject({
      component: "@nocad/passives:RESISTOR",
      placementHint: { edge: hdmiSliceIds.videoProvider, near: "provider" },
      placed: false
    });
    expect(generated?.xMm).toBeGreaterThan(provider?.xMm ?? Number.POSITIVE_INFINITY);
    expect(splitSegments.map(({ fromNode, id, toNode }) => ({
      id,
      nodes: [fromNode, toNode].sort()
    }))).toEqual([
      {
        id: `net_${hdmiSliceIds.videoProvider}_tmds2_p_provider`,
        nodes: [hdmiSliceIds.mcu, componentId].sort()
      },
      {
        id: `net_${hdmiSliceIds.videoProvider}_tmds2_p_connector`,
        nodes: [componentId, hdmiSliceIds.hdmiPort].sort()
      }
    ]);
    expect(generated?.source).toEqual({
      id: hdmiSliceIds.videoProvider,
      kind: "edge",
      path: ["generated", componentId]
    });
    expect(
      projection.obligations.filter(
        (obligation) =>
          obligation.kind === "routing" && splitSegments.some((edge) => edge.id === obligation.target.id)
      )
    ).toHaveLength(2);
  });

  it("uses authored placement coordinates when present", () => {
    const source = createHdmiTxSliceProject();
    const placedSource = {
      ...source,
      layout: {
        ...source.layout,
        board: source.layout?.board ?? "main_board",
        placements: {
          [hdmiTxSliceIds.tx]: {
            x: "12mm",
            y: "13mm",
            rotation: "90deg"
          }
        },
        routingIntent: source.layout?.routingIntent ?? []
      }
    };
    const projection = buildBoardProjection(placedSource, resolveProject(placedSource), fixtureCatalog);
    const tx = projection.components.find((component) => component.id === hdmiTxSliceIds.tx);

    expect(tx).toMatchObject({ placed: true, rotationDeg: 90, xMm: 12, yMm: 13 });
    expect(projection.stats.placedComponents).toBe(1);
  });

  it("reports footprint overlap DRC for authored placement", () => {
    const source = createHdmiTxSliceProject();
    const projection = buildBoardProjection(source, resolveProject(source), fixtureCatalog);
    const withTxPlaced = applyBoardComponentPlacement(projection, hdmiTxSliceIds.tx, {
      rotationDeg: 0,
      xMm: 20,
      yMm: 20
    });
    const withOverlap = applyBoardComponentPlacement(withTxPlaced, hdmiTxSliceIds.videoSource, {
      rotationDeg: 0,
      xMm: 20,
      yMm: 20
    });

    expect(withOverlap.stats.drcViolations).toBe(1);
    expect(withOverlap.drcViolations[0]).toMatchObject({
      kind: "courtyard_overlap",
      severity: "error",
      componentIds: [hdmiTxSliceIds.videoSource, hdmiTxSliceIds.tx]
    });
    expect(withOverlap.obligations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "drc",
          severity: "error"
        })
      ])
    );
    expect(withOverlap.components.find((component) => component.id === hdmiTxSliceIds.tx)?.violations).toHaveLength(1);
  });

  it("uses rotation-aware portable geometry for overlap DRC", () => {
    const source = createHdmiTxSliceProject();
    const projection = buildBoardProjection(source, resolveProject(source), fixtureCatalog);
    const withRotatedConnector = applyBoardComponentPlacement(projection, hdmiTxSliceIds.hdmiPort, {
      rotationDeg: 90,
      xMm: 20,
      yMm: 20
    });
    const separated = applyBoardComponentPlacement(withRotatedConnector, hdmiTxSliceIds.tx, {
      rotationDeg: 0,
      xMm: 31,
      yMm: 20
    });
    const overlapping = applyBoardComponentPlacement(separated, hdmiTxSliceIds.hdmiPort, {
      rotationDeg: 0,
      xMm: 20,
      yMm: 20
    });

    expect(separated.drcViolations).toEqual([]);
    expect(overlapping.drcViolations).toHaveLength(1);
    expect(separated.scene.components.find(({ id }) => id === hdmiTxSliceIds.hdmiPort)?.rotationDeg).toBe(90);
  });

  it("builds a deterministic minimum spanning ratsnest for multi-endpoint nets", () => {
    const source = multiEndpointSource();
    const resolved = multiEndpointResolved();
    const projection = buildBoardProjection(source, resolved, emptyCatalog);
    const reversed = buildBoardProjection(
      { ...source, nodes: [...source.nodes].reverse() },
      { ...resolved, nets: [{ ...resolved.nets[0]!, endpoints: [...resolved.nets[0]!.endpoints].reverse() }] },
      emptyCatalog
    );

    expect(projection.ratsnest).toHaveLength(3);
    expect(projection.stats.unroutedNets).toBe(1);
    expect(projection.obligations.filter(({ kind }) => kind === "routing")).toHaveLength(1);
    expect(projection.ratsnest.every(({ netId }) => netId === "net_multi")).toBe(true);
    expect(projection.ratsnest.map(({ fromNode, toNode }) => [fromNode, toNode])).toEqual([
      ["a", "b"],
      ["a", "d"],
      ["b", "c"]
    ]);
    expect(projection.ratsnest.map(({ id }) => id)).toEqual(
      [...projection.ratsnest.map(({ id }) => id)].sort()
    );
    expect(reversed.ratsnest).toEqual(projection.ratsnest);

    const moved = applyBoardComponentPlacement(projection, "b", {
      rotationDeg: 0,
      xMm: 90,
      yMm: 50
    });
    expect(moved.ratsnest.map(({ fromNode, toNode }) => [fromNode, toNode])).toEqual([
      ["a", "d"],
      ["b", "c"],
      ["c", "d"]
    ]);
    expect(moved.ratsnest.every(({ netId }) => netId === "net_multi")).toBe(true);
    expect(moved.scene.connections.map(({ id }) => id)).toEqual(
      moved.ratsnest.map(({ id }) => id).sort()
    );
  });

  it("projects a semantic realization as one authored ratsnest identity", () => {
    const base = createI2cSliceProject();
    const source: ProjectSource = {
      ...base,
      edges: [
        {
          id: "authored-sda",
          kind: "net.authored",
          name: "SDA physical",
          realizes: { edge: i2cSliceIds.sensorBus, signal: "sda" },
          endpoints: [
            { node: i2cSliceIds.mcu, pin: "gpio4" },
            { node: i2cSliceIds.sensor, pin: "sda" }
          ]
        },
        ...base.edges
      ]
    };
    const projection = buildBoardProjection(source, resolveProject(source), fixtureCatalog);
    const sda = projection.ratsnest.filter(({ signal, sourceEdge }) =>
      signal === "authored-sda" || sourceEdge === "authored-sda"
    );

    expect(sda).toHaveLength(1);
    expect(sda[0]).toMatchObject({
      contract: "builtin:i2c.v1",
      id: "net_authored-sda",
      netId: "net_authored-sda",
      signal: "sda",
      source: { id: "authored-sda", kind: "edge" },
      sourceEdge: "authored-sda"
    });
    expect(projection.ratsnest.some(({ id }) => id === `net_${i2cSliceIds.sensorBus}_sda`)).toBe(false);
  });
});

const emptyCatalog: DefinitionCatalog = { components: {}, contracts: {}, functions: {} };

function multiEndpointSource(): ProjectSource {
  return {
    schema: "nocad.project.v0",
    id: "multi-endpoint-board",
    name: "Multi-endpoint board",
    dependencies: {},
    board: { id: "board", layers: 2, size: { width: "100mm", height: "60mm" } },
    layout: {
      board: "board",
      placements: {
        a: { x: "10mm", y: "10mm" },
        b: { x: "20mm", y: "10mm" },
        c: { x: "20mm", y: "20mm" },
        d: { x: "10mm", y: "20mm" }
      },
      routingIntent: []
    },
    nodes: ["a", "b", "c", "d"].map((id) => ({
      id,
      kind: "component" as const,
      component: `vendor:${id}`
    })),
    edges: []
  };
}

function multiEndpointResolved(): ResolvedProject {
  return {
    schema: "nocad.lock.v0",
    sourceSet: { files: [], hash: "test" },
    resolver: { name: "nocad-resolver", version: "test" },
    dependencies: {},
    resolvedChoices: [],
    diagnostics: [],
    generated: [],
    nets: [{
      id: "net_multi",
      name: "MULTI",
      endpoints: ["a", "b", "c", "d"].map((node) => ({ node, pin: "1" })),
      direction: "bidirectional",
      sourceEdge: "authored-multi",
      sourceMap: { edge: "authored-multi", signal: "authored-multi" }
    }]
  };
}
