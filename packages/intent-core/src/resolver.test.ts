import { describe, expect, it } from "vitest";

import { getComponentPinOptions, getI2cPinPairOptions } from "./assignment";
import {
  createHdmiSliceProject,
  createHdmiTxSliceProject,
  createI2cSliceProject,
  createRp2350HdmiTxSliceProject,
  hdmiSliceIds,
  hdmiTxSliceIds,
  i2cSliceIds
} from "./samples";
import { resolveProject } from "./resolver";
import type { ProjectSource } from "./types";

describe("resolveProject", () => {
  it("resolves the I2C slice with deterministic default pins and pullups", () => {
    const resolved = resolveProject(createI2cSliceProject());

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.resolvedChoices[0]?.selected.bindings).toMatchObject({
      sda: {
        from: { node: i2cSliceIds.mcu, pin: "gpio4" },
        to: { node: i2cSliceIds.sensor, pin: "sda" }
      },
      scl: {
        from: { node: i2cSliceIds.mcu, pin: "gpio5" },
        to: { node: i2cSliceIds.sensor, pin: "scl" }
      }
    });
    expect(resolved.nets.map((net) => net.name)).toEqual(["I2C_SDA", "I2C_SCL"]);
    expect(resolved.generated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `pullup_${i2cSliceIds.sensorBus}_sda`,
          connects: [`net_${i2cSliceIds.sensorBus}_sda`, i2cSliceIds.rail3v3],
          sourceMap: { edge: i2cSliceIds.sensorBus, feature: "pullups", signal: "sda" }
        }),
        expect.objectContaining({
          id: `pullup_${i2cSliceIds.sensorBus}_scl`,
          connects: [`net_${i2cSliceIds.sensorBus}_scl`, i2cSliceIds.rail3v3],
          sourceMap: { edge: i2cSliceIds.sensorBus, feature: "pullups", signal: "scl" }
        })
      ])
    );
    expect(resolved.dependencies["@nocad/passives"]).toMatchObject({
      introducedBy: {
        edge: i2cSliceIds.sensorBus,
        feature: "pullups"
      }
    });
  });

  it("exposes compatible I2C pin-pair options for an intent edge", () => {
    expect(getI2cPinPairOptions(createI2cSliceProject(), i2cSliceIds.sensorBus)).toEqual([
      { sda: "gpio4", scl: "gpio5" },
      { sda: "gpio8", scl: "gpio9" }
    ]);
  });

  it("exposes GPIO-capable component pins for custom provider binding", () => {
    const gpioPins = getComponentPinOptions(createHdmiSliceProject(), hdmiSliceIds.mcu, "gpio");

    expect(gpioPins).toHaveLength(30);
    expect(gpioPins.slice(0, 2)).toEqual([
      { id: "gpio0", name: "GPIO0", capabilities: ["gpio"] },
      { id: "gpio1", name: "GPIO1", capabilities: ["gpio"] }
    ]);
  });

  it("skips a reserved pin and falls back to the next valid I2C pair", () => {
    const resolved = resolveProject(createI2cSliceProject({ conflict: true }));

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.resolvedChoices[0]?.selected.bindings).toMatchObject({
      sda: {
        from: { node: i2cSliceIds.mcu, pin: "gpio8" }
      },
      scl: {
        from: { node: i2cSliceIds.mcu, pin: "gpio9" }
      }
    });
  });

  it("keeps net and generated object IDs unique across multiple I2C edges", () => {
    const source = createI2cSliceProject();
    const secondEdgeId = "edge_7f1f312f-6193-4957-a7ab-dc86e566f9a5";
    const secondSensorId = "node_22c7b325-2bc0-47de-b1d4-3e739d2fd489";
    const sourceWithSecondBus: ProjectSource = {
      ...source,
      nodes: [
        ...source.nodes,
        {
          id: secondSensorId,
          kind: "component",
          label: "Second temperature sensor",
          role: "secondary_temperature_sensor",
          component: "@nocad/sensors:I2C_TEMP_SENSOR",
          refdesHint: "U?"
        }
      ],
      edges: [
        ...source.edges,
        {
          id: secondEdgeId,
          kind: "intent.connection",
          label: "Secondary I2C bus",
          role: "secondary_sensor_bus",
          from: {
            node: i2cSliceIds.mcu,
            port: "i2c"
          },
          to: {
            node: secondSensorId,
            port: "i2c"
          },
          contract: "builtin:i2c.v1",
          strategy: {
            pinAssignment: "auto"
          },
          include: {
            pullups: true
          }
        }
      ]
    };

    const resolved = resolveProject(sourceWithSecondBus);

    expect(resolved.diagnostics).toEqual([]);
    expect(new Set(resolved.nets.map((net) => net.id)).size).toBe(resolved.nets.length);
    expect(new Set(resolved.generated.map((item) => item.id)).size).toBe(resolved.generated.length);
    expect(resolved.nets.map((net) => net.id)).toEqual(
      expect.arrayContaining([
        `net_${i2cSliceIds.sensorBus}_sda`,
        `net_${i2cSliceIds.sensorBus}_scl`,
        `net_${secondEdgeId}_sda`,
        `net_${secondEdgeId}_scl`
      ])
    );
  });

  it("elaborates HDMI output features into provider bindings and 5V power", () => {
    const source = createHdmiSliceProject();

    const resolved = resolveProject(source);

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.resolvedChoices).toHaveLength(1);
    expect(resolved.resolvedChoices[0]?.sourceEdge).toBe(hdmiSliceIds.videoProvider);
    expect(resolved.resolvedChoices[0]?.selected.bindings).toMatchObject({
      tmds2_p: {
        from: { node: hdmiSliceIds.mcu, pin: "gpio12" },
        to: { node: hdmiSliceIds.hdmiPort, pin: "tmds2_p" }
      },
      ddc_sda: {
        from: { node: hdmiSliceIds.mcu, pin: "gpio4" },
        to: { node: hdmiSliceIds.hdmiPort, pin: "ddc_sda" }
      },
      ddc_scl: {
        from: { node: hdmiSliceIds.mcu, pin: "gpio5" },
        to: { node: hdmiSliceIds.hdmiPort, pin: "ddc_scl" }
      },
      hpd: {
        from: { node: hdmiSliceIds.mcu, pin: "gpio0" },
        to: { node: hdmiSliceIds.hdmiPort, pin: "hpd" }
      }
    });
    expect(resolved.resolvedChoices[0]?.selected.bindings.cec).toBeUndefined();
    expect(resolved.nets.map((net) => net.name)).toEqual(
      expect.arrayContaining(["HDMI_TMDS2_P", "HDMI_DDC_SDA", "HDMI_HPD", "HDMI_5V"])
    );
    expect(source.edges.map((edge) => edge.id)).toEqual([
      hdmiSliceIds.videoProvider,
      hdmiSliceIds.hdmiConnector
    ]);
  });

  it("reports a missing 5V rail when HDMI source power is enabled", () => {
    const source = createHdmiSliceProject();
    const sourceWithout5v: ProjectSource = {
      ...source,
      nodes: source.nodes.filter((node) => node.id !== hdmiSliceIds.rail5v)
    };

    const resolved = resolveProject(sourceWithout5v);

    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_HDMI_5V_POWER"
        })
      ])
    );
  });

  it("moves HDMI DDC to another I2C pair when GPIO4/GPIO5 are used by a sensor", () => {
    const hdmiSource = createHdmiSliceProject();
    const i2cSource = createI2cSliceProject();
    const source: ProjectSource = {
      ...hdmiSource,
      dependencies: {
        ...hdmiSource.dependencies,
        "@nocad/sensors": "0.1.0"
      },
      nodes: [
        ...hdmiSource.nodes,
        ...i2cSource.nodes.filter((node) => node.id !== i2cSliceIds.mcu)
      ],
      edges: [
        ...hdmiSource.edges,
        ...i2cSource.edges
      ]
    };

    const resolved = resolveProject(source);
    const hdmiChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiSliceIds.videoProvider);

    expect(resolved.diagnostics).toEqual([]);
    expect(hdmiChoice?.selected.bindings.ddc_sda?.from?.pin).toBe("gpio8");
    expect(hdmiChoice?.selected.bindings.ddc_scl?.from?.pin).toBe("gpio9");
  });

  it("resolves HDMI output through an authored TX IC provider chain", () => {
    const source = createHdmiTxSliceProject();

    const resolved = resolveProject(source);
    const hdmiChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.txVideoProvider);
    const dpiChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.dpiConnection);
    const ctrlChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.ctrlConnection);

    expect(resolved.diagnostics).toEqual([]);
    expect(dpiChoice?.selected.bindings.pclk).toMatchObject({
      from: { node: hdmiTxSliceIds.videoSource, pin: "io0" },
      to: { node: hdmiTxSliceIds.tx, pin: "pclk" }
    });
    expect(ctrlChoice?.selected.bindings).toMatchObject({
      sda: {
        from: { node: hdmiTxSliceIds.videoSource, pin: "io60" },
        to: { node: hdmiTxSliceIds.tx, pin: "ctrl_sda" }
      },
      scl: {
        from: { node: hdmiTxSliceIds.videoSource, pin: "io61" },
        to: { node: hdmiTxSliceIds.tx, pin: "ctrl_scl" }
      }
    });
    expect(hdmiChoice?.selected.bindings).toMatchObject({
      tmds2_p: {
        from: { node: hdmiTxSliceIds.tx, pin: "tmds2_p" },
        to: { node: hdmiTxSliceIds.hdmiPort, pin: "tmds2_p" }
      },
      ddc_sda: {
        from: { node: hdmiTxSliceIds.tx, pin: "ddc_sda" },
        to: { node: hdmiTxSliceIds.hdmiPort, pin: "ddc_sda" }
      },
      hpd: {
        from: { node: hdmiTxSliceIds.tx, pin: "hpd" },
        to: { node: hdmiTxSliceIds.hdmiPort, pin: "hpd" }
      }
    });
    expect(hdmiChoice?.selected.providerMode).toBe("hdmi_1v4");
    expect(dpiChoice?.selected.params).toMatchObject({
      redBits: 8,
      greenBits: 8,
      blueBits: 8
    });
    expect(resolved.nets.map((net) => net.name)).toEqual(
      expect.arrayContaining(["PIXEL_PCLK", "I2C_SDA", "HDMI_TMDS2_P", "HDMI_5V"])
    );
  });

  it("resolves a pin-constrained TX IC provider chain independent of connection edge order", () => {
    const dpiFirst = resolveProject(createRp2350HdmiTxProject("dpi-first"));
    const ctrlFirst = resolveProject(createRp2350HdmiTxProject("ctrl-first"));

    for (const resolved of [dpiFirst, ctrlFirst]) {
      const dpiChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.dpiConnection);
      const ctrlChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.ctrlConnection);

      expect(resolved.diagnostics).toEqual([]);
      expect(ctrlChoice?.selected.bindings).toMatchObject({
        sda: { from: { node: hdmiTxSliceIds.videoSource, pin: "gpio4" } },
        scl: { from: { node: hdmiTxSliceIds.videoSource, pin: "gpio5" } }
      });
      expect(sourcePinsForChoice(dpiChoice)).not.toEqual(expect.arrayContaining(["gpio4", "gpio5"]));
    }
  });

  it("exposes RP2350 as an upstream pixel stream and I2C driver for an HDMI TX IC", () => {
    const resolved = resolveProject(createRp2350HdmiTxSliceProject());
    const dpiChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.dpiConnection);
    const ctrlChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.ctrlConnection);
    const hdmiChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.txVideoProvider);

    expect(resolved.diagnostics).toEqual([]);
    expect(ctrlChoice?.selected.bindings).toMatchObject({
      sda: { from: { node: hdmiTxSliceIds.videoSource, pin: "gpio4" } },
      scl: { from: { node: hdmiTxSliceIds.videoSource, pin: "gpio5" } }
    });
    expect(dpiChoice?.selected.params).toMatchObject({
      redBits: 5,
      greenBits: 6,
      blueBits: 5
    });
    expect(sourcePinsForChoice(dpiChoice)).toHaveLength(20);
    expect(sourcePinsForChoice(dpiChoice)).not.toEqual(expect.arrayContaining(["gpio4", "gpio5"]));
    expect(hdmiChoice?.selected.bindings.tmds2_p).toMatchObject({
      from: { node: hdmiTxSliceIds.tx, pin: "tmds2_p" },
      to: { node: hdmiTxSliceIds.hdmiPort, pin: "tmds2_p" }
    });
  });

  it("suppresses provider-requirement cascades when the required edge is authored but unresolved", () => {
    const source = createHdmiTxSliceProject();
    const badSource: ProjectSource = {
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === hdmiTxSliceIds.ctrlConnection && edge.kind === "intent.connection"
          ? {
              ...edge,
              bindings: {
                sda: { from: { node: hdmiTxSliceIds.videoSource, pin: "io0" } },
                scl: { from: { node: hdmiTxSliceIds.videoSource, pin: "io1" } }
              },
              strategy: {
                pinAssignment: "manual"
              }
            }
          : edge
      )
    };

    const resolved = resolveProject(badSource);
    const codes = resolved.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain("PIN_CAPABILITY_MISMATCH");
    expect(codes).not.toContain("PROVIDER_REQUIREMENT_UNSATISFIED");
    expect(resolved.resolvedChoices.some((choice) => choice.sourceEdge === hdmiTxSliceIds.txVideoProvider)).toBe(false);
  });

  it("rejects manual overrides that disagree with fixed provider signal maps", () => {
    const source = createHdmiTxSliceProject();
    const badSource: ProjectSource = {
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === hdmiTxSliceIds.txVideoProvider && edge.kind === "intent.provides"
          ? {
              ...edge,
              bindings: {
                tmds2_p: { from: { node: hdmiTxSliceIds.tx, pin: "ddc_scl" } }
              }
            }
          : edge
      )
    };

    const resolved = resolveProject(badSource);

    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PIN_BINDING_MISMATCH"
        })
      ])
    );
    expect(resolved.resolvedChoices.some((choice) => choice.sourceEdge === hdmiTxSliceIds.txVideoProvider)).toBe(false);
  });

  it("treats preferred I2C pairs as preferences and falls back to compatible selector pins", () => {
    const source = createHdmiTxSliceProject();
    const sourceWithReservedPreferredPair: ProjectSource = {
      ...source,
      edges: [
        {
          id: "edge_reserved_i2c_preferred_pair",
          kind: "net.binding",
          bindings: {
            reserved_sda: { from: { node: hdmiTxSliceIds.videoSource, pin: "io60" } },
            reserved_scl: { from: { node: hdmiTxSliceIds.videoSource, pin: "io61" } }
          }
        },
        ...source.edges
      ]
    };

    const resolved = resolveProject(sourceWithReservedPreferredPair);
    const ctrlChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.ctrlConnection);

    expect(resolved.diagnostics).toEqual([]);
    expect(ctrlChoice?.selected.bindings).toMatchObject({
      sda: { from: { node: hdmiTxSliceIds.videoSource, pin: "io62" } },
      scl: { from: { node: hdmiTxSliceIds.videoSource, pin: "io63" } }
    });
  });

  it("reports an unsatisfied provider requirement when a TX IC input port is unbound", () => {
    const resolved = resolveProject(createHdmiTxSliceProject({ omitVideoIn: true }));

    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PROVIDER_REQUIREMENT_UNSATISFIED",
          message: expect.stringContaining("video_in")
        })
      ])
    );
    expect(resolved.resolvedChoices.some((choice) => choice.sourceEdge === hdmiTxSliceIds.txVideoProvider)).toBe(false);
  });

  it("derives pixel stream signal count from authored color width params", () => {
    const source = createHdmiTxSliceProject();
    const rgb332Source: ProjectSource = {
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === hdmiTxSliceIds.dpiConnection && edge.kind === "intent.connection"
          ? {
              ...edge,
              params: {
                ...edge.params,
                redBits: 3,
                greenBits: 3,
                blueBits: 2
              }
            }
          : edge
      )
    };

    const resolved = resolveProject(rgb332Source);
    const dpiChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiTxSliceIds.dpiConnection);
    const pixelNets = resolved.nets.filter((net) => net.sourceEdge === hdmiTxSliceIds.dpiConnection);

    expect(resolved.diagnostics).toEqual([]);
    expect(Object.keys(dpiChoice?.selected.bindings ?? {})).toEqual([
      "pclk",
      "hsync",
      "vsync",
      "de",
      "r0",
      "r1",
      "r2",
      "g0",
      "g1",
      "g2",
      "b0",
      "b1"
    ]);
    expect(pixelNets.map((net) => net.name)).not.toContain("PIXEL_R3");
  });

  it("reports invalid connection contract params", () => {
    const source = createHdmiTxSliceProject();
    const badSource: ProjectSource = {
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === hdmiTxSliceIds.dpiConnection && edge.kind === "intent.connection"
          ? {
              ...edge,
              params: {
                ...edge.params,
                redBits: 7
              }
            }
          : edge
      )
    };

    const resolved = resolveProject(badSource);

    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CONTRACT_PARAM_INVALID"
        })
      ])
    );
    expect(resolved.resolvedChoices.some((choice) => choice.sourceEdge === hdmiTxSliceIds.dpiConnection)).toBe(false);
  });

  it("reports missing node references", () => {
    const source = createI2cSliceProject();
    const badSource: ProjectSource = {
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === i2cSliceIds.sensorBus && edge.kind === "intent.connection"
          ? {
              ...edge,
              to: {
                node: "missing_sensor",
                port: "i2c"
              }
            }
          : edge
      )
    };

    const resolved = resolveProject(badSource);

    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNKNOWN_NODE"
        })
      ])
    );
  });

  it("reports invalid endpoint ports", () => {
    const source = createI2cSliceProject();
    const badSource: ProjectSource = {
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === i2cSliceIds.sensorBus && edge.kind === "intent.connection"
          ? {
              ...edge,
              from: {
                node: i2cSliceIds.mcu,
                port: "not_i2c"
              }
            }
          : edge
      )
    };

    const resolved = resolveProject(badSource);

    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNKNOWN_PORT"
        })
      ])
    );
  });

  it("reports invalid contract-port pairs", () => {
    const source = createI2cSliceProject();
    const badSource: ProjectSource = {
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === i2cSliceIds.sensorBus && edge.kind === "intent.connection"
          ? {
              ...edge,
              contract: "builtin:spi.v1"
            }
          : edge
      )
    };

    const resolved = resolveProject(badSource);

    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNKNOWN_CONTRACT"
        })
      ])
    );
  });
});

function createRp2350HdmiTxProject(order: "ctrl-first" | "dpi-first"): ProjectSource {
  const source = createRp2350HdmiTxSliceProject();
  const edgeById = new Map(source.edges.map((edge) => [edge.id, edge]));
  const firstConnection =
    order === "ctrl-first" ? edgeById.get(hdmiTxSliceIds.ctrlConnection) : edgeById.get(hdmiTxSliceIds.dpiConnection);
  const secondConnection =
    order === "ctrl-first" ? edgeById.get(hdmiTxSliceIds.dpiConnection) : edgeById.get(hdmiTxSliceIds.ctrlConnection);

  return {
    ...source,
    edges: [
      ...[firstConnection, secondConnection].filter((edge): edge is ProjectSource["edges"][number] => Boolean(edge)),
      ...source.edges.filter(
        (edge) => edge.id !== hdmiTxSliceIds.ctrlConnection && edge.id !== hdmiTxSliceIds.dpiConnection
      )
    ]
  };
}

function sourcePinsForChoice(choice: ReturnType<typeof resolveProject>["resolvedChoices"][number] | undefined) {
  return Object.values(choice?.selected.bindings ?? {}).flatMap((binding) => {
    const pin = binding.from?.pin;

    return pin ? [pin] : [];
  });
}
