import { describe, expect, it } from "vitest";

import { applyBoardComponentPlacement, buildBoardProjection } from "./board-projection";
import { resolveProject } from "./resolver";
import { createHdmiSliceProject, createHdmiTxSliceProject, hdmiSliceIds, hdmiTxSliceIds } from "./samples";


describe("buildBoardProjection", () => {
  it("projects board footprint envelopes and ratsnest from resolved nets", () => {
    const source = createHdmiTxSliceProject();
    const projection = buildBoardProjection(source, resolveProject(source));

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
    expect(projection.obligations.filter((obligation) => obligation.kind === "placement")).toHaveLength(11);
    expect(projection.stats.drcViolations).toBe(0);
  });

  it("projects generated inline components and both split ratsnest segments", () => {
    const source = createHdmiSliceProject();
    const projection = buildBoardProjection(source, resolveProject(source));
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
    expect(splitSegments).toEqual([
      expect.objectContaining({
        id: `net_${hdmiSliceIds.videoProvider}_tmds2_p_provider`,
        fromNode: hdmiSliceIds.mcu,
        toNode: componentId
      }),
      expect.objectContaining({
        id: `net_${hdmiSliceIds.videoProvider}_tmds2_p_connector`,
        fromNode: componentId,
        toNode: hdmiSliceIds.hdmiPort
      })
    ]);
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
    const projection = buildBoardProjection(placedSource, resolveProject(placedSource));
    const tx = projection.components.find((component) => component.id === hdmiTxSliceIds.tx);

    expect(tx).toMatchObject({ placed: true, rotationDeg: 90, xMm: 12, yMm: 13 });
    expect(projection.stats.placedComponents).toBe(1);
  });

  it("reports footprint overlap DRC for authored placement", () => {
    const source = createHdmiTxSliceProject();
    const projection = buildBoardProjection(source, resolveProject(source));
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
});
