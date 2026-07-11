import { describe, expect, it } from "vitest";

import { applyBoardComponentPlacement, buildBoardProjection } from "./board-projection";
import { resolveProject } from "./resolver";
import { createHdmiTxSliceProject, hdmiTxSliceIds } from "./samples";


describe("buildBoardProjection", () => {
  it("projects board footprint envelopes and ratsnest from resolved nets", () => {
    const source = createHdmiTxSliceProject();
    const projection = buildBoardProjection(source, resolveProject(source));

    expect(projection.board).toMatchObject({ widthMm: 60, heightMm: 40, layers: 4 });
    expect(projection.components.map((component) => component.id)).toEqual([
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
    expect(projection.obligations.filter((obligation) => obligation.kind === "placement")).toHaveLength(3);
    expect(projection.stats.drcViolations).toBe(0);
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
