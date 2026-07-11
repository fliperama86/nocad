import { describe, expect, it } from "vitest";

import { getComponentPinOptions, getI2cPinPairOptions } from "./assignment";
import { components } from "./fixtures";
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

  it("reports a contract-defined diagnostic when a shunt power domain is missing", () => {
    const source = createI2cSliceProject();
    const withoutRail: ProjectSource = {
      ...source,
      nodes: source.nodes.filter((node) => node.id !== i2cSliceIds.rail3v3)
    };

    const resolved = resolveProject(withoutRail);

    expect(resolved.generated).toEqual([]);
    expect(resolved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_POWER_DOMAIN",
          targets: [{ kind: "edge", id: i2cSliceIds.sensorBus }]
        })
      ])
    );
  });

  it("applies preferred pin groups and shunt rules to a non-I2C contract", () => {
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "biased-signal-slice",
      name: "Biased signal slice",
      dependencies: {
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0"
      },
      nodes: [
        {
          id: "mcu",
          kind: "component",
          component: "@nocad/rp2350:RP2350A"
        },
        {
          id: "indicator",
          kind: "component",
          component: "@nocad/io:LED"
        },
        {
          id: "rail-3v3",
          kind: "powerDomain",
          role: "power_3v3",
          voltage: "3.3V"
        }
      ],
      edges: [
        {
          id: "biased-edge",
          kind: "intent.connection",
          from: { node: "mcu", port: "biased_out" },
          to: { node: "indicator", port: "biased_input" },
          contract: "@nocad/io:biased_signal.v1",
          include: { bias: true }
        }
      ]
    };

    const resolved = resolveProject(source);

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.resolvedChoices[0]?.selected.bindings.signal).toEqual({
      from: { node: "mcu", pin: "gpio10" },
      to: { node: "indicator", pin: "anode" }
    });
    expect(resolved.generated).toEqual([
      expect.objectContaining({
        id: "bias_biased-edge_signal",
        component: "@nocad/passives:RESISTOR",
        value: "10k",
        connects: ["net_biased-edge_signal", "rail-3v3"],
        sourceMap: { edge: "biased-edge", feature: "bias", signal: "signal" }
      })
    ]);
    expect(resolved.dependencies["@nocad/passives"]?.introducedBy).toEqual({
      edge: "biased-edge",
      feature: "bias"
    });
  });

  it("preserves authored bindings when an edge keeps automatic strategy", () => {
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "authored-auto-binding",
      name: "Authored auto binding",
      dependencies: {
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0"
      },
      nodes: [
        { id: "mcu", kind: "component", component: "@nocad/rp2350:RP2350A" },
        { id: "indicator", kind: "component", component: "@nocad/io:LED" }
      ],
      edges: [
        {
          id: "biased-edge",
          kind: "intent.connection",
          from: { node: "mcu", port: "biased_out" },
          to: { node: "indicator", port: "biased_input" },
          contract: "@nocad/io:biased_signal.v1",
          strategy: { pinAssignment: "auto" },
          bindings: {
            signal: { from: { node: "mcu", pin: "gpio11" } }
          }
        }
      ]
    };
    const resolved = resolveProject(source);

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.resolvedChoices[0]?.selected.bindings.signal).toEqual({
      from: { node: "mcu", pin: "gpio11" },
      to: { node: "indicator", pin: "anode" }
    });
  });

  it("exposes compatible I2C pin-pair options for an intent edge", () => {
    expect(getI2cPinPairOptions(createI2cSliceProject(), i2cSliceIds.sensorBus)).toEqual([
      { sda: "gpio4", scl: "gpio5" },
      { sda: "gpio8", scl: "gpio9" }
    ]);
  });

  it("does not leak preferred groups from another same-contract port into options or suggestions", () => {
    const definition = components["@nocad/rp2350:RP2350A"];

    if (!definition) {
      throw new Error("Missing RP2350 fixture definition.");
    }

    const originalGroups = definition.preferredPinGroups;
    definition.preferredPinGroups = [
      ...(originalGroups ?? []),
      {
        contract: "builtin:i2c.v1",
        pins: { sda: "gpio4", scl: "gpio5" },
        port: "unrelated_i2c_port",
        suggestion: { title: "Wrong-port suggestion" }
      }
    ];

    try {
      const source = createI2cSliceProject();

      expect(getI2cPinPairOptions(source, i2cSliceIds.sensorBus)).toEqual([
        { sda: "gpio4", scl: "gpio5" },
        { sda: "gpio8", scl: "gpio9" }
      ]);

      const invalidSource: ProjectSource = {
        ...source,
        edges: source.edges.map((edge) =>
          edge.id === i2cSliceIds.sensorBus && edge.kind === "intent.connection"
            ? {
                ...edge,
                strategy: { pinAssignment: "manual" as const },
                bindings: {
                  sda: { from: { node: i2cSliceIds.mcu, pin: "gpio0" } },
                  scl: { from: { node: i2cSliceIds.mcu, pin: "gpio1" } }
                }
              }
            : edge
        )
      };
      const suggestionTitles = resolveProject(invalidSource).diagnostics.flatMap(
        (diagnostic) => diagnostic.suggestions?.map((suggestion) => suggestion.title) ?? []
      );

      expect(suggestionTitles).toEqual([
        "Move I2C to GPIO4/GPIO5",
        "Move I2C to GPIO8/GPIO9"
      ]);
      expect(suggestionTitles).not.toContain("Wrong-port suggestion");
    } finally {
      definition.preferredPinGroups = originalGroups;
    }
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

  it("derives an actionable I2C pin suggestion from package preferred groups", () => {
    const source = createI2cSliceProject();
    const conflictingSource: ProjectSource = {
      ...source,
      edges: [
        {
          id: "edge_reserved_gpio4",
          kind: "net.binding",
          bindings: {
            reserved: { from: { node: i2cSliceIds.mcu, pin: "gpio4" } }
          }
        },
        ...source.edges.map((edge) =>
          edge.id === i2cSliceIds.sensorBus && edge.kind === "intent.connection"
            ? {
                ...edge,
                strategy: { pinAssignment: "manual" as const },
                bindings: {
                  sda: {
                    from: { node: i2cSliceIds.mcu, pin: "gpio4" },
                    to: { node: i2cSliceIds.sensor, pin: "sda" }
                  },
                  scl: {
                    from: { node: i2cSliceIds.mcu, pin: "gpio5" },
                    to: { node: i2cSliceIds.sensor, pin: "scl" }
                  }
                }
              }
            : edge
        )
      ]
    };
    const failed = resolveProject(conflictingSource);
    const diagnostic = failed.diagnostics.find((candidate) => candidate.code === "PIN_CONFLICT");
    const suggestion = diagnostic?.suggestions?.[0];

    expect(diagnostic?.suggestions).toHaveLength(1);
    expect(suggestion).toEqual({
      title: "Move I2C to GPIO8/GPIO9",
      patch: {
        op: "setEdgeBindings",
        edge: i2cSliceIds.sensorBus,
        value: {
          sda: {
            from: { node: i2cSliceIds.mcu, pin: "gpio8" },
            to: { node: i2cSliceIds.sensor, pin: "sda" }
          },
          scl: {
            from: { node: i2cSliceIds.mcu, pin: "gpio9" },
            to: { node: i2cSliceIds.sensor, pin: "scl" }
          }
        }
      }
    });

    const repaired = resolveProject({
      ...conflictingSource,
      edges: conflictingSource.edges.map((edge) =>
        edge.id === i2cSliceIds.sensorBus && edge.kind === "intent.connection" && suggestion
          ? { ...edge, bindings: suggestion.patch.value }
          : edge
      )
    });

    expect(repaired.diagnostics).toEqual([]);
    expect(repaired.resolvedChoices[0]?.selected.bindings).toMatchObject({
      sda: { from: { node: i2cSliceIds.mcu, pin: "gpio8" } },
      scl: { from: { node: i2cSliceIds.mcu, pin: "gpio9" } }
    });
  });

  it("derives and round-trips a non-I2C pin suggestion from the same package metadata", () => {
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "biased-suggestion",
      name: "Biased signal suggestion",
      dependencies: {
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0"
      },
      nodes: [
        { id: "mcu", kind: "component", component: "@nocad/rp2350:RP2350A" },
        { id: "indicator", kind: "component", component: "@nocad/io:LED" }
      ],
      edges: [
        {
          id: "reserved-gpio0",
          kind: "net.binding",
          bindings: { reserved: { from: { node: "mcu", pin: "gpio0" } } }
        },
        {
          id: "biased-edge",
          kind: "intent.connection",
          from: { node: "mcu", port: "biased_out" },
          to: { node: "indicator", port: "biased_input" },
          contract: "@nocad/io:biased_signal.v1",
          strategy: { pinAssignment: "manual" },
          bindings: {
            signal: {
              from: { node: "mcu", pin: "gpio0" },
              to: { node: "indicator", pin: "anode" }
            }
          }
        }
      ]
    };
    const failed = resolveProject(source);
    const suggestion = failed.diagnostics.find((diagnostic) => diagnostic.code === "PIN_CONFLICT")?.suggestions?.[0];

    expect(suggestion).toEqual({
      title: "Move biased signal to GPIO10",
      patch: {
        op: "setEdgeBindings",
        edge: "biased-edge",
        value: {
          signal: {
            from: { node: "mcu", pin: "gpio10" },
            to: { node: "indicator", pin: "anode" }
          }
        }
      }
    });

    const repaired = resolveProject({
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === "biased-edge" && edge.kind === "intent.connection" && suggestion
          ? { ...edge, bindings: suggestion.patch.value }
          : edge
      )
    });

    expect(repaired.diagnostics).toEqual([]);
    expect(repaired.resolvedChoices[0]?.selected.bindings.signal).toEqual({
      from: { node: "mcu", pin: "gpio10" },
      to: { node: "indicator", pin: "anode" }
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

  it("keeps identical auto edges on stable pin pairs when source edge order changes", () => {
    const source = createI2cSliceProject();
    const secondSensorId = "node_second_sensor";
    const firstEdgeId = "edge_a_sensor_bus";
    const secondEdgeId = "edge_z_sensor_bus";
    const nodes: ProjectSource["nodes"] = [
      ...source.nodes,
      {
        id: secondSensorId,
        kind: "component",
        component: "@nocad/sensors:I2C_TEMP_SENSOR"
      }
    ];
    const makeEdge = (id: string, sensor: string): ProjectSource["edges"][number] => ({
      id,
      kind: "intent.connection",
      from: { node: i2cSliceIds.mcu, port: "i2c" },
      to: { node: sensor, port: "i2c" },
      contract: "builtin:i2c.v1",
      strategy: { pinAssignment: "auto" },
      include: { pullups: true }
    });
    const edges = [makeEdge(secondEdgeId, secondSensorId), makeEdge(firstEdgeId, i2cSliceIds.sensor)];
    const forward = resolveProject({ ...source, nodes, edges });
    const reversed = resolveProject({ ...source, nodes, edges: [...edges].reverse() });

    expect(reversed).toEqual(forward);
    expect(forward.diagnostics).toEqual([]);
    expect(forward.resolvedChoices.find((choice) => choice.sourceEdge === firstEdgeId)?.selected.bindings).toMatchObject({
      sda: { from: { node: i2cSliceIds.mcu, pin: "gpio4" } },
      scl: { from: { node: i2cSliceIds.mcu, pin: "gpio5" } }
    });
    expect(forward.resolvedChoices.find((choice) => choice.sourceEdge === secondEdgeId)?.selected.bindings).toMatchObject({
      sda: { from: { node: i2cSliceIds.mcu, pin: "gpio8" } },
      scl: { from: { node: i2cSliceIds.mcu, pin: "gpio9" } }
    });
  });

  it("allocates explicit bindings before auto preferences regardless of edge order", () => {
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "manual-and-auto-biased-signals",
      name: "Manual and auto biased signals",
      dependencies: {
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0"
      },
      nodes: [
        { id: "mcu", kind: "component", component: "@nocad/rp2350:RP2350A" },
        { id: "auto-led", kind: "component", component: "@nocad/io:LED" },
        { id: "manual-led", kind: "component", component: "@nocad/io:LED" }
      ],
      edges: [
        {
          id: "edge_a_auto",
          kind: "intent.connection",
          from: { node: "mcu", port: "biased_out" },
          to: { node: "auto-led", port: "biased_input" },
          contract: "@nocad/io:biased_signal.v1",
          strategy: { pinAssignment: "auto" }
        },
        {
          id: "edge_z_manual",
          kind: "intent.connection",
          from: { node: "mcu", port: "biased_out" },
          to: { node: "manual-led", port: "biased_input" },
          contract: "@nocad/io:biased_signal.v1",
          strategy: { pinAssignment: "manual" },
          bindings: {
            signal: { from: { node: "mcu", pin: "gpio10" } }
          }
        }
      ]
    };
    const forward = resolveProject(source);
    const reversed = resolveProject({ ...source, edges: [...source.edges].reverse() });

    expect(reversed).toEqual(forward);
    expect(forward.diagnostics).toEqual([]);
    expect(forward.resolvedChoices.find((choice) => choice.sourceEdge === "edge_z_manual")?.selected.bindings.signal).toMatchObject({
      from: { node: "mcu", pin: "gpio10" }
    });
    expect(forward.resolvedChoices.find((choice) => choice.sourceEdge === "edge_a_auto")?.selected.bindings.signal).toMatchObject({
      from: { node: "mcu", pin: "gpio0" }
    });
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

  it("resolves direct TMDS output from a generic FPGA GPIO pin pool", () => {
    const hdmiSource = createHdmiSliceProject();
    const source: ProjectSource = {
      ...hdmiSource,
      dependencies: {
        ...hdmiSource.dependencies,
        "@nocad/fpga": "0.1.0"
      },
      nodes: hdmiSource.nodes.map((node) =>
        node.id === hdmiSliceIds.mcu && node.kind === "component"
          ? {
              ...node,
              component: "@nocad/fpga:GENERIC_FPGA",
              role: "video_source"
            }
          : node
      ),
      edges: hdmiSource.edges.map((edge) =>
        edge.id === hdmiSliceIds.videoProvider && edge.kind === "intent.provides"
          ? {
              ...edge,
              from: { node: hdmiSliceIds.mcu, port: "gpio" },
              strategy: { pinAssignment: "auto", providerMode: "generic_gpio" }
            }
          : edge
      )
    };

    const resolved = resolveProject(source);
    const choice = resolved.resolvedChoices.find((candidate) => candidate.sourceEdge === hdmiSliceIds.videoProvider);

    expect(resolved.diagnostics).toEqual([]);
    expect(choice?.selected.providerMode).toBe("generic_gpio");
    expect(choice?.selected.bindings).toMatchObject({
      tmds2_p: {
        from: { node: hdmiSliceIds.mcu, pin: "io0" },
        to: { node: hdmiSliceIds.hdmiPort, pin: "tmds2_p" }
      },
      ddc_sda: {
        from: { node: hdmiSliceIds.mcu, pin: "io8" },
        to: { node: hdmiSliceIds.hdmiPort, pin: "ddc_sda" }
      },
      hpd: {
        from: { node: hdmiSliceIds.mcu, pin: "io10" },
        to: { node: hdmiSliceIds.hdmiPort, pin: "hpd" }
      }
    });
  });

  it("resolves function topology independently of provider and exposes edge order", () => {
    const source = createHdmiSliceProject();
    const forward = resolveProject(source);
    const reversed = resolveProject({ ...source, edges: [...source.edges].reverse() });

    expect(reversed).toEqual(forward);
  });

  it("resolves a second function type entirely from contract and package data", () => {
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "digital-output-slice",
      name: "Digital output slice",
      dependencies: {
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0"
      },
      nodes: [
        {
          id: "mcu",
          kind: "component",
          component: "@nocad/rp2350:RP2350A"
        },
        {
          id: "status-output",
          kind: "intent.function",
          function: "@nocad/io:digital_output.v1"
        },
        {
          id: "status-led",
          kind: "component",
          component: "@nocad/io:LED"
        }
      ],
      edges: [
        {
          id: "mcu-provides-status",
          kind: "intent.provides",
          from: { node: "mcu", port: "digital_out" },
          to: { node: "status-output" },
          contract: "@nocad/io:digital_output.v1"
        },
        {
          id: "status-exposes-led",
          kind: "intent.exposes",
          from: { node: "status-output" },
          to: { node: "status-led", port: "input" },
          contract: "@nocad/io:digital_output.v1"
        }
      ]
    };

    const resolved = resolveProject(source);

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.resolvedChoices).toEqual([
      expect.objectContaining({
        sourceEdge: "mcu-provides-status",
        selected: expect.objectContaining({
          bindings: {
            signal: {
              from: { node: "mcu", pin: "gpio0" },
              to: { node: "status-led", pin: "anode" }
            }
          },
          providerMode: "auto"
        })
      })
    ]);
    expect(resolved.nets).toEqual([
      expect.objectContaining({
        id: "net_mcu-provides-status_signal",
        name: "DIGITAL_SIGNAL",
        direction: "from_to_to"
      })
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
      from: { node: hdmiTxSliceIds.videoSource, pin: "io18" },
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

    expect(ctrlFirst).toEqual(dpiFirst);

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
    expect(sourcePinsForChoice(dpiChoice)).not.toEqual(expect.arrayContaining(["gpio4", "gpio5", "gpio8", "gpio9"]));
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

  it("keeps the complete mixed provider-chain output identical for every edge permutation", () => {
    const source = createRp2350HdmiTxSliceProject();
    const sensorId = "node_permutation_sensor";
    const railId = "node_permutation_3v3";
    const mixedSource: ProjectSource = {
      ...source,
      dependencies: {
        ...source.dependencies,
        "@nocad/sensors": "0.1.0"
      },
      nodes: [
        ...source.nodes,
        { id: sensorId, kind: "component", component: "@nocad/sensors:I2C_TEMP_SENSOR" },
        { id: railId, kind: "powerDomain", role: "power_3v3", voltage: "3.3V" }
      ],
      edges: [
        ...source.edges,
        {
          id: "edge_0_sensor_bus",
          kind: "intent.connection",
          from: { node: hdmiTxSliceIds.videoSource, port: "i2c" },
          to: { node: sensorId, port: "i2c" },
          contract: "builtin:i2c.v1",
          include: { pullups: true }
        },
        {
          id: "edge_1_hard_reservation",
          kind: "net.binding",
          bindings: {
            reserved: { from: { node: hdmiTxSliceIds.videoSource, pin: "gpio29" } }
          }
        }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(mixedSource);

    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.generated.map((item) => item.id)).toEqual([
      "pullup_edge_0_sensor_bus_sda",
      "pullup_edge_0_sensor_bus_scl"
    ]);
    expect(resolved.resolvedChoices.some((choice) => choice.sourceEdge === hdmiTxSliceIds.txVideoProvider)).toBe(true);
  });

  it("keeps diagnostics and package-authored suggestions identical for every edge permutation", () => {
    const source = createI2cSliceProject();
    const conflictingSource: ProjectSource = {
      ...source,
      edges: [
        {
          id: "edge_reserved_gpio4",
          kind: "net.binding",
          bindings: {
            reserved: { from: { node: i2cSliceIds.mcu, pin: "gpio4" } }
          }
        },
        ...source.edges.map((edge) =>
          edge.kind === "intent.connection"
            ? {
                ...edge,
                strategy: { pinAssignment: "manual" as const },
                bindings: {
                  sda: {
                    from: { node: i2cSliceIds.mcu, pin: "gpio4" },
                    to: { node: i2cSliceIds.sensor, pin: "sda" }
                  },
                  scl: {
                    from: { node: i2cSliceIds.mcu, pin: "gpio5" },
                    to: { node: i2cSliceIds.sensor, pin: "scl" }
                  }
                }
              }
            : edge
        )
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(conflictingSource);
    const diagnostic = resolved.diagnostics.find((candidate) => candidate.code === "PIN_CONFLICT");

    expect(diagnostic?.suggestions?.map((suggestion) => suggestion.title)).toEqual([
      "Move I2C to GPIO8/GPIO9"
    ]);
  });

  it("protects explicit provider bindings from automatic connection allocation in every edge permutation", () => {
    const source = createHdmiSliceProject();
    const txId = "node_pressure_tx";
    const pressureSource: ProjectSource = {
      ...source,
      dependencies: {
        ...source.dependencies,
        "@nocad/hdmi-tx": "0.1.0"
      },
      nodes: [
        ...source.nodes,
        { id: txId, kind: "component", component: "@nocad/hdmi-tx:IT66121" }
      ],
      edges: [
        ...source.edges.map((edge) =>
          edge.kind === "intent.provides"
            ? {
                ...edge,
                strategy: { pinAssignment: "manual" as const, providerMode: "custom_gpio" },
                bindings: {
                  tmds2_p: { from: { node: hdmiSliceIds.mcu, pin: "gpio0" } }
                }
              }
            : edge
        ),
        {
          id: "edge_auto_pixel_pressure",
          kind: "intent.connection",
          from: { node: hdmiSliceIds.mcu, port: "dpi_out" },
          to: { node: txId, port: "video_in" },
          contract: "@nocad/video:pixel_stream.v1",
          params: {
            transport: "parallel_rgb",
            redBits: 3,
            greenBits: 3,
            blueBits: 2,
            hsync: true,
            vsync: true,
            de: true
          }
        }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(pressureSource);
    const providerChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === hdmiSliceIds.videoProvider);
    const pixelChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === "edge_auto_pixel_pressure");

    expect(resolved.diagnostics).toEqual([]);
    expect(providerChoice?.selected.bindings.tmds2_p?.from?.pin).toBe("gpio0");
    expect(sourcePinsForChoice(pixelChoice)).not.toContain("gpio0");
  });

  it("allocates constrained function providers before flexible providers", () => {
    const contract = "@nocad/io:digital_output.v1";
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "function-provider-pressure",
      name: "Function provider pressure",
      dependencies: {
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0"
      },
      nodes: [
        { id: "mcu", kind: "component", component: "@nocad/rp2350:RP2350A" },
        { id: "function-auto", kind: "intent.function", function: contract },
        { id: "function-manual", kind: "intent.function", function: contract },
        { id: "led-auto", kind: "component", component: "@nocad/io:LED" },
        { id: "led-manual", kind: "component", component: "@nocad/io:LED" }
      ],
      edges: [
        {
          id: "edge_a_auto_provider",
          kind: "intent.provides",
          from: { node: "mcu", port: "digital_out" },
          to: { node: "function-auto" },
          contract
        },
        {
          id: "edge_b_auto_exposure",
          kind: "intent.exposes",
          from: { node: "function-auto" },
          to: { node: "led-auto", port: "input" },
          contract
        },
        {
          id: "edge_z_manual_provider",
          kind: "intent.provides",
          from: { node: "mcu", port: "digital_out" },
          to: { node: "function-manual" },
          contract,
          strategy: { pinAssignment: "manual" },
          bindings: {
            signal: { from: { node: "mcu", pin: "gpio0" } }
          }
        },
        {
          id: "edge_y_manual_exposure",
          kind: "intent.exposes",
          from: { node: "function-manual" },
          to: { node: "led-manual", port: "input" },
          contract
        }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(source);
    const manual = resolved.resolvedChoices.find((choice) => choice.sourceEdge === "edge_z_manual_provider");
    const automatic = resolved.resolvedChoices.find((choice) => choice.sourceEdge === "edge_a_auto_provider");

    expect(resolved.diagnostics).toEqual([]);
    expect(manual?.selected.bindings.signal?.from?.pin).toBe("gpio0");
    expect(automatic?.selected.bindings.signal?.from?.pin).toBe("gpio1");
  });

  it("protects fixed provider mode pins from earlier flexible connections", () => {
    const source = createHdmiSliceProject();
    const txId = "node_fixed_pressure_tx";
    const pressureSource: ProjectSource = {
      ...source,
      dependencies: {
        ...source.dependencies,
        "@nocad/hdmi-tx": "0.1.0"
      },
      nodes: [
        ...source.nodes,
        { id: txId, kind: "component", component: "@nocad/hdmi-tx:IT66121" }
      ],
      edges: [
        ...source.edges,
        {
          id: "edge_fixed_mode_pixel_pressure",
          kind: "intent.connection",
          from: { node: hdmiSliceIds.mcu, port: "dpi_out" },
          to: { node: txId, port: "video_in" },
          contract: "@nocad/video:pixel_stream.v1",
          params: {
            transport: "parallel_rgb",
            redBits: 3,
            greenBits: 3,
            blueBits: 2,
            hsync: true,
            vsync: true,
            de: true
          }
        }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(pressureSource);
    const pixelChoice = resolved.resolvedChoices.find(
      (choice) => choice.sourceEdge === "edge_fixed_mode_pixel_pressure"
    );
    const fixedProviderPins = [
      "gpio12",
      "gpio13",
      "gpio14",
      "gpio15",
      "gpio16",
      "gpio17",
      "gpio18",
      "gpio19"
    ];

    expect(resolved.diagnostics).toEqual([]);
    expect(sourcePinsForChoice(pixelChoice).filter((pin) => fixedProviderPins.includes(pin))).toEqual([]);
    expect(resolved.resolvedChoices.some((choice) => choice.sourceEdge === hdmiSliceIds.videoProvider)).toBe(true);
  });

  it("does not let orphan or invalid provider bindings reserve pins", () => {
    const contract = "@nocad/io:digital_output.v1";
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "invalid-provider-claims",
      name: "Invalid provider claims",
      dependencies: {
        "@nocad/hdmi-tx": "0.1.0",
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0",
        "@nocad/video": "0.1.0"
      },
      nodes: [
        { id: "mcu", kind: "component", component: "@nocad/rp2350:RP2350A" },
        { id: "tx", kind: "component", component: "@nocad/hdmi-tx:IT66121" },
        { id: "function", kind: "intent.function", function: contract },
        { id: "led", kind: "component", component: "@nocad/io:LED" }
      ],
      edges: [
        {
          id: "edge_invalid_provider",
          kind: "intent.provides",
          from: { node: "mcu", port: "digital_out" },
          to: { node: "function" },
          contract,
          strategy: { providerMode: "missing_mode" },
          bindings: { signal: { from: { node: "mcu", pin: "gpio0" } } }
        },
        {
          id: "edge_function_exposure",
          kind: "intent.exposes",
          from: { node: "function" },
          to: { node: "led", port: "input" },
          contract
        },
        {
          id: "edge_orphan_provider",
          kind: "intent.provides",
          from: { node: "mcu", port: "digital_out" },
          to: { node: "missing-function" },
          contract,
          bindings: { signal: { from: { node: "mcu", pin: "gpio1" } } }
        },
        {
          id: "edge_auto_pixel",
          kind: "intent.connection",
          from: { node: "mcu", port: "dpi_out" },
          to: { node: "tx", port: "video_in" },
          contract: "@nocad/video:pixel_stream.v1",
          params: {
            transport: "parallel_rgb",
            redBits: 3,
            greenBits: 3,
            blueBits: 2,
            hsync: true,
            vsync: true,
            de: true
          }
        }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(source);
    const pixelChoice = resolved.resolvedChoices.find((choice) => choice.sourceEdge === "edge_auto_pixel");

    expect(resolved.diagnostics.map((diagnostic) => diagnostic.code)).toContain("PROVIDER_MODE_NOT_FOUND");
    expect(sourcePinsForChoice(pixelChoice)).toContain("gpio0");
    expect(sourcePinsForChoice(pixelChoice)).toContain("gpio1");
  });

  it("diagnoses collisions between validated provider pin claims", () => {
    const contract = "@nocad/io:digital_output.v1";
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "provider-claim-conflict",
      name: "Provider claim conflict",
      dependencies: {
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0"
      },
      nodes: [
        { id: "mcu", kind: "component", component: "@nocad/rp2350:RP2350A" },
        { id: "function-a", kind: "intent.function", function: contract },
        { id: "function-z", kind: "intent.function", function: contract },
        { id: "led-a", kind: "component", component: "@nocad/io:LED" },
        { id: "led-z", kind: "component", component: "@nocad/io:LED" }
      ],
      edges: [
        {
          id: "edge_a_provider",
          kind: "intent.provides",
          from: { node: "mcu", port: "digital_out" },
          to: { node: "function-a" },
          contract,
          bindings: { signal: { from: { node: "mcu", pin: "gpio0" } } }
        },
        {
          id: "edge_a_exposure",
          kind: "intent.exposes",
          from: { node: "function-a" },
          to: { node: "led-a", port: "input" },
          contract
        },
        {
          id: "edge_z_provider",
          kind: "intent.provides",
          from: { node: "mcu", port: "digital_out" },
          to: { node: "function-z" },
          contract,
          bindings: { signal: { from: { node: "mcu", pin: "gpio0" } } }
        },
        {
          id: "edge_z_exposure",
          kind: "intent.exposes",
          from: { node: "function-z" },
          to: { node: "led-z", port: "input" },
          contract
        }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(source);
    const codes = resolved.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain("PIN_PROVIDER_CLAIM_CONFLICT");
    expect(codes).toContain("PIN_CONFLICT");
    expect(resolved.resolvedChoices.map((choice) => choice.sourceEdge)).toEqual(["edge_a_provider"]);
  });

  it("invalidates every duplicate edge occurrence deterministically", () => {
    const source = createI2cSliceProject();
    const original = source.edges[0];

    if (!original || original.kind !== "intent.connection") {
      throw new Error("Missing I2C fixture edge.");
    }

    const malformedSource: ProjectSource = {
      ...source,
      edges: [
        original,
        {
          ...original,
          from: { ...original.from, port: "not_i2c" }
        },
        {
          id: "edge_unique_reservation",
          kind: "net.binding",
          bindings: { reserved: { from: { node: i2cSliceIds.mcu, pin: "gpio4" } } }
        }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(malformedSource);

    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({ code: "DUPLICATE_EDGE_ID" })
    ]);
    expect(resolved.resolvedChoices).toEqual([]);
    expect(resolved.nets).toEqual([]);
    expect(resolved.generated).toEqual([]);
  });

  it("reports conflicting hard reservations with stable ownership", () => {
    const source = createI2cSliceProject();
    const conflictSource: ProjectSource = {
      ...source,
      edges: [
        {
          id: "edge_a_reservation",
          kind: "net.binding",
          bindings: { reserved: { from: { node: i2cSliceIds.mcu, pin: "gpio4" } } }
        },
        {
          id: "edge_z_reservation",
          kind: "net.binding",
          bindings: { reserved: { from: { node: i2cSliceIds.mcu, pin: "gpio4" } } }
        },
        ...source.edges
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(conflictSource);
    const conflict = resolved.diagnostics.find((diagnostic) => diagnostic.code === "PIN_RESERVATION_CONFLICT");

    expect(conflict?.message).toContain("edge_a_reservation keeps deterministic priority");
    expect(resolved.resolvedChoices[0]?.selected.bindings).toMatchObject({
      sda: { from: { pin: "gpio8" } },
      scl: { from: { pin: "gpio9" } }
    });
  });

  it("diagnoses ambiguous function topology instead of selecting by edge position", () => {
    const source = createHdmiSliceProject();
    const provider = source.edges.find((edge) => edge.kind === "intent.provides");
    const exposure = source.edges.find((edge) => edge.kind === "intent.exposes");

    if (!provider || provider.kind !== "intent.provides" || !exposure || exposure.kind !== "intent.exposes") {
      throw new Error("Missing HDMI topology edges.");
    }

    const ambiguousSource: ProjectSource = {
      ...source,
      edges: [
        ...source.edges,
        { ...provider, id: "edge_second_provider" },
        { ...exposure, id: "edge_second_exposure" }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(ambiguousSource);
    const codes = resolved.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(["AMBIGUOUS_FUNCTION_PROVIDER", "AMBIGUOUS_FUNCTION_EXPOSURE"]);
    expect(resolved.resolvedChoices).toEqual([]);
    expect(resolved.nets).toEqual([]);
  });

  it("keeps canonical dependency provenance when multiple topology edges introduce one package", () => {
    const source: ProjectSource = {
      schema: "nocad.project.v0",
      id: "dependency-provenance",
      name: "Dependency provenance",
      dependencies: {
        "@nocad/io": "0.1.0",
        "@nocad/rp2350": "0.1.0"
      },
      nodes: [
        { id: "mcu", kind: "component", component: "@nocad/rp2350:RP2350A" },
        { id: "led-a", kind: "component", component: "@nocad/io:LED" },
        { id: "led-z", kind: "component", component: "@nocad/io:LED" },
        { id: "rail", kind: "powerDomain", role: "power_3v3", voltage: "3.3V" }
      ],
      edges: [
        {
          id: "edge_z_bias",
          kind: "intent.connection",
          from: { node: "mcu", port: "biased_out" },
          to: { node: "led-z", port: "biased_input" },
          contract: "@nocad/io:biased_signal.v1",
          include: { bias: true }
        },
        {
          id: "edge_a_bias",
          kind: "intent.connection",
          from: { node: "mcu", port: "biased_out" },
          to: { node: "led-a", port: "biased_input" },
          contract: "@nocad/io:biased_signal.v1",
          include: { bias: true }
        }
      ]
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(source);

    expect(resolved.dependencies["@nocad/passives"]?.introducedBy).toEqual({
      edge: "edge_a_bias",
      feature: "bias"
    });
  });

  it("keeps authored-unresolved provider requirement suppression for every edge permutation", () => {
    const source = createHdmiTxSliceProject();
    const badSource: ProjectSource = {
      ...source,
      edges: source.edges.map((edge) =>
        edge.id === hdmiTxSliceIds.ctrlConnection && edge.kind === "intent.connection"
          ? {
              ...edge,
              strategy: { pinAssignment: "manual" as const },
              bindings: {
                sda: { from: { node: hdmiTxSliceIds.videoSource, pin: "io0" } },
                scl: { from: { node: hdmiTxSliceIds.videoSource, pin: "io1" } }
              }
            }
          : edge
      )
    };

    const resolved = expectAllEdgePermutationsToResolveExactly(badSource);
    const codes = resolved.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain("PIN_CAPABILITY_MISMATCH");
    expect(codes).not.toContain("PROVIDER_REQUIREMENT_UNSATISFIED");
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

function expectAllEdgePermutationsToResolveExactly(source: ProjectSource) {
  const expected = resolveProject(source);

  for (const edges of permutations(source.edges)) {
    expect(resolveProject({ ...source, edges })).toEqual(expected);
  }

  return expected;
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) {
    return [[]];
  }

  return values.flatMap((value, index) => {
    const remaining = [...values.slice(0, index), ...values.slice(index + 1)];

    return permutations(remaining).map((permutation) => [value, ...permutation]);
  });
}
