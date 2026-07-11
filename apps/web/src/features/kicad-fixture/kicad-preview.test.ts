import { describe, expect, it } from "vitest";

import hdmiBreakoutBoardSource from "../../../../../fixtures/kicad/hdmi-breakout/hdmi_breakout.kicad_pcb?raw";

import { parseKiCadBoardPreview } from "./kicad-preview";

describe("parseKiCadBoardPreview", () => {
  it("extracts the content-pinned HDMI breakout geometry", () => {
    const preview = parseKiCadBoardPreview(hdmiBreakoutBoardSource);

    expect(preview.generatorVersion).toBe("10.0");
    expect(preview.bounds).toEqual({ widthMm: 22, heightMm: 41 });
    expect(preview.footprints).toHaveLength(4);
    expect(preview.pads).toHaveLength(41);
    expect(preview.tracks).toHaveLength(52);
    expect(preview.vias).toHaveLength(0);
    expect(preview.zones).toHaveLength(2);
    expect(preview.graphics).toHaveLength(55);
    expect(preview.layers).toEqual(
      expect.arrayContaining(["F.Cu", "B.Cu", "F.SilkS", "F.Fab", "F.CrtYd", "Dwgs.User", "Cmts.User"])
    );
    expect(preview.nets).toEqual(
      expect.arrayContaining(["CEC", "CLK+", "CLK-", "D0+", "D0-", "D1+", "D1-", "D2+", "D2-", "SCL", "SDA"])
    );
    expect(preview.footprints.map((footprint) => footprint.reference)).toEqual(
      expect.arrayContaining(["H1", "H2", "J1", "J2"])
    );
  });

  it("preserves the serialized GND fills and footprint drawing layers", () => {
    const preview = parseKiCadBoardPreview(hdmiBreakoutBoardSource);
    const frontFill = preview.zones.find((zone) => zone.layer === "F.Cu");
    const backFill = preview.zones.find((zone) => zone.layer === "B.Cu");
    const silk = preview.graphics.filter((graphic) => graphic.layer === "F.SilkS");
    const fabrication = preview.graphics.filter((graphic) => graphic.layer === "F.Fab");
    const courtyard = preview.graphics.filter((graphic) => graphic.layer === "F.CrtYd");

    expect(frontFill?.net).toBe("GND");
    expect(frontFill?.points.length).toBeGreaterThan(100);
    expect(backFill?.net).toBe("GND");
    expect(backFill?.points.length).toBeGreaterThan(100);
    expect(silk).toHaveLength(14);
    expect(fabrication).toHaveLength(14);
    expect(courtyard).toHaveLength(23);
  });

  it("supports rectangular outlines and through vias used by larger boards", () => {
    const preview = parseKiCadBoardPreview(`
      (kicad_pcb
        (generator_version "10.0")
        (gr_rect
          (start 10 20)
          (end 40 50)
          (stroke (width 0.1) (type solid))
          (fill no)
          (layer "Edge.Cuts")
          (uuid "outline")
        )
        (via
          (at 20 30)
          (size 0.8)
          (drill 0.4)
          (layers "F.Cu" "B.Cu")
          (net "GND")
          (uuid "via-1")
        )
      )
    `);

    expect(preview.bounds).toEqual({ widthMm: 30, heightMm: 30 });
    expect(preview.outline).toEqual([
      { xMm: 0, yMm: 0 },
      { xMm: 30, yMm: 0 },
      { xMm: 30, yMm: 30 },
      { xMm: 0, yMm: 30 }
    ]);
    expect(preview.vias).toEqual([
      {
        drillMm: 0.4,
        id: "via-1",
        layers: ["F.Cu", "B.Cu"],
        net: "GND",
        sizeMm: 0.8,
        xMm: 10,
        yMm: 10
      }
    ]);
  });

  it("applies KiCad footprint rotation to J2 pads without mirroring them", () => {
    const preview = parseKiCadBoardPreview(hdmiBreakoutBoardSource);
    const j2 = preview.footprints.find((footprint) => footprint.reference === "J2");
    const d2PositivePad = preview.pads.find(
      (pad) => pad.footprintId === j2?.id && pad.number === "1" && pad.net === "D2+"
    );
    const connectedTrack = preview.tracks.find(
      (track) => track.net === "D2+" && pointsMatch(track.start, d2PositivePad)
    );

    expect(j2?.rotationDeg).toBe(-90);
    expect(d2PositivePad).toMatchObject({
      heightMm: 1.1,
      rotationDeg: 270,
      widthMm: 0.3,
      xMm: expect.closeTo(5.14),
      yMm: expect.closeTo(17.25)
    });
    expect(renderedSize(d2PositivePad)).toEqual({ widthMm: 1.1, heightMm: 0.3 });
    expect(connectedTrack).toBeDefined();
  });

  it("uses J2's serialized board angles for signal and mounting pads", () => {
    const preview = parseKiCadBoardPreview(hdmiBreakoutBoardSource);
    const j2 = preview.footprints.find((footprint) => footprint.reference === "J2");
    const signalPad = preview.pads.find((pad) => pad.footprintId === j2?.id && pad.number === "1");
    const mountingPad = preview.pads.find((pad) => pad.footprintId === j2?.id && pad.number === "MP");

    expect(signalPad?.rotationDeg).toBe(270);
    expect(renderedSize(signalPad)).toEqual({ widthMm: 1.1, heightMm: 0.3 });
    expect(mountingPad).toMatchObject({ widthMm: 2.3, heightMm: 3.1, rotationDeg: 270 });
    expect(renderedSize(mountingPad)).toEqual({ widthMm: 3.1, heightMm: 2.3 });
  });

  it("preserves J1 shield pad and drill oval geometry", () => {
    const preview = parseKiCadBoardPreview(hdmiBreakoutBoardSource);
    const j1 = preview.footprints.find((footprint) => footprint.reference === "J1");
    const shieldPads = preview.pads.filter((pad) => pad.footprintId === j1?.id && pad.number === "SH");

    expect(shieldPads).toHaveLength(4);
    expect(shieldPads[0]).toMatchObject({
      shape: "oval",
      widthMm: 3.3,
      heightMm: 1.5,
      drill: {
        shape: "oval",
        widthMm: 2.7,
        heightMm: 0.9
      }
    });
  });
});

function pointsMatch(
  left: { xMm: number; yMm: number },
  right: { xMm: number; yMm: number } | undefined
) {
  return Boolean(right && Math.abs(left.xMm - right.xMm) < 1e-6 && Math.abs(left.yMm - right.yMm) < 1e-6);
}

function renderedSize(pad: { widthMm: number; heightMm: number; rotationDeg: number } | undefined) {
  if (!pad) {
    return undefined;
  }

  const quarterTurns = Math.round(pad.rotationDeg / 90) % 2;

  return quarterTurns === 0
    ? { widthMm: pad.widthMm, heightMm: pad.heightMm }
    : { widthMm: pad.heightMm, heightMm: pad.widthMm };
}
