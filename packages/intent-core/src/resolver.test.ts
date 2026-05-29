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
          id: "pullup_sda",
          connects: ["I2C_SDA", i2cSliceIds.rail3v3],
          sourceMap: { edge: i2cSliceIds.sensorBus, feature: "pullups" }
        }),
        expect.objectContaining({
          id: "pullup_scl",
          connects: ["I2C_SCL", i2cSliceIds.rail3v3],
          sourceMap: { edge: i2cSliceIds.sensorBus, feature: "pullups" }
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
