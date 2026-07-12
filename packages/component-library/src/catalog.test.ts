import {
  createProjectSourceSet,
  resolveProject,
  type ProjectSource,
  type ResolutionEnvironment
} from "@nocad/intent-core";
import { describe, expect, it } from "vitest";

import { loadBuiltInDefinitionCatalog } from "./catalog";

describe("built-in definition catalog", () => {
  it("loads a closed, immutable production catalog and package index", async () => {
    const catalog = await loadBuiltInDefinitionCatalog();

    expect(Object.keys(catalog.components)).toEqual([
      "@nocad/connectors:TE_1-1734839-4",
      "@nocad/hdmi-tx:IT66121",
      "@nocad/rp2350:RP2350A",
      "@nocad/rp2350:RP2354B"
    ]);
    expect(Object.keys(catalog.contracts).sort()).toEqual([
      "@nocad/io:digital_output.v1",
      "@nocad/video:hdmi_output.v1",
      "@nocad/video:pixel_stream.v1",
      "builtin:i2c.v1"
    ]);
    expect(Object.keys(catalog.functions)).toEqual(["@nocad/video:hdmi_output.v1"]);
    expect(catalog.contracts["@nocad/video:pixel_stream.v1"].dependency).toEqual({
      name: "@nocad/video",
      version: "0.1.0"
    });
    expect(catalog.functions["@nocad/video:hdmi_output.v1"].dependency).toEqual({
      name: "@nocad/video",
      version: "0.1.0"
    });
    expect(Object.keys(catalog.library.packages).sort()).toEqual([
      "@nocad/connectors",
      "@nocad/hdmi-tx",
      "@nocad/io",
      "@nocad/rp2350",
      "@nocad/video",
      "builtin"
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.library.packages)).toBe(true);
  });

  it("exposes data-driven function authoring metadata", async () => {
    const catalog = await loadBuiltInDefinitionCatalog();

    expect(catalog.library.functionDescriptors).toEqual([
      expect.objectContaining({
        defaultInclude: { cec: false, ddc: true, hpd: true, tmds: true },
        id: "@nocad/video:hdmi_output.v1",
        kind: "function",
        label: "HDMI video output",
        package: expect.objectContaining({ name: "@nocad/video", version: "0.1.0" })
      })
    ]);
  });

  it.each(["@nocad/rp2350:RP2350A", "@nocad/rp2350:RP2354B"])(
    "resolves a real %s to IT66121 transmitter chain",
    async (sourceComponent) => {
      const catalog = await loadBuiltInDefinitionCatalog();
      const environment: ResolutionEnvironment = {
        catalog,
        resolveDependency(name, requestedVersion) {
          const packageDefinition = catalog.library.packages[name];
          return packageDefinition &&
            (requestedVersion === undefined || requestedVersion === packageDefinition.version)
            ? { hash: packageDefinition.contentHash, version: packageDefinition.version }
            : undefined;
        },
        sourceSet: createProjectSourceSet
      };
      const source = transmitterProject(sourceComponent);
      const resolved = resolveProject(source, environment);

      expect(resolved.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
      expect(resolved.generated).toEqual([]);
      expect(resolved.nets.length).toBeGreaterThan(20);
    }
  );
});

function transmitterProject(sourceComponent: string): ProjectSource {
  return {
    schema: "nocad.project.v0",
    id: `transmitter-${sourceComponent.split(":").pop()}`,
    name: "Real transmitter chain",
    dependencies: {
      "@nocad/connectors": "0.1.0",
      "@nocad/hdmi-tx": "0.1.0",
      "@nocad/rp2350": "0.1.0",
      "@nocad/video": "0.1.0"
    },
    nodes: [
      { id: "source", kind: "component", component: sourceComponent },
      { id: "tx", kind: "component", component: "@nocad/hdmi-tx:IT66121" },
      { id: "video", kind: "intent.function", function: "@nocad/video:hdmi_output.v1" },
      { id: "connector", kind: "component", component: "@nocad/connectors:TE_1-1734839-4" }
    ],
    edges: [
      {
        id: "pixel",
        kind: "intent.connection",
        from: { node: "source", port: "dpi_out" },
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
      },
      {
        id: "control",
        kind: "intent.connection",
        from: { node: "source", port: "i2c" },
        to: { node: "tx", port: "ctrl" },
        contract: "builtin:i2c.v1"
      },
      {
        id: "provider",
        kind: "intent.provides",
        from: { node: "tx", port: "hdmi_tx" },
        to: { node: "video", port: "source" },
        contract: "@nocad/video:hdmi_output.v1",
        strategy: { providerMode: "hdmi_1v4" }
      },
      {
        id: "exposes",
        kind: "intent.exposes",
        from: { node: "video", port: "connector" },
        to: { node: "connector", port: "hdmi" },
        contract: "@nocad/video:hdmi_output.v1"
      }
    ]
  };
}
