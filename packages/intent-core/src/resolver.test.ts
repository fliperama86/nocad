import { describe, expect, it } from "vitest";

import { createI2cSliceProject, i2cSliceIds } from "./samples";
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
