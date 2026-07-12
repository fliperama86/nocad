import { loadBuiltInDefinitionCatalog } from "@nocad/component-library";
import { createProjectSourceSet, resolveProject } from "@nocad/intent-core";
import type { ProjectSource, ResolutionEnvironment } from "@nocad/intent-core";
import { describe, expect, it } from "vitest";

import { matchFunctionComponentConnection } from "./features/workspace/function-connection-intent";

describe("production definition catalog", () => {
  it("supports a real RP2354B to video FFC semantic path", async () => {
    const catalog = await loadBuiltInDefinitionCatalog();
    const source = directVideoProject();
    const packages = catalog.library.packages;
    const environment: ResolutionEnvironment = {
      catalog,
      resolveDependency(name, requestedVersion) {
        const dependency = packages[name];
        return dependency && dependency.version === requestedVersion
          ? { hash: dependency.contentHash, version: dependency.version }
          : undefined;
      },
      sourceSet: createProjectSourceSet
    };
    const mcu = source.nodes.find((node) => node.id === "mcu");
    const output = source.nodes.find((node) => node.id === "video-output");
    const connector = source.nodes.find((node) => node.id === "video-ffc");

    if (!mcu || !output || !connector) throw new Error("Missing production test nodes.");

    expect(matchFunctionComponentConnection(mcu, output, catalog)).toEqual({
      intent: {
        componentPort: "video_out",
        contract: "@nocad/video:hdmi_output.v1",
        kind: "provides",
        providerMode: "custom_gpio"
      }
    });
    expect(matchFunctionComponentConnection(connector, output, catalog)).toEqual({
      intent: {
        componentPort: "hdmi",
        contract: "@nocad/video:hdmi_output.v1",
        kind: "exposes"
      }
    });
    expect(resolveProject(source, environment).diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  });
});

function directVideoProject(): ProjectSource {
  return {
    schema: "nocad.project.v0",
    id: "production-catalog-test",
    name: "Production catalog test",
    dependencies: {
      "@nocad/connectors": "0.1.0",
      "@nocad/rp2350": "0.1.0",
      "@nocad/video": "0.1.0"
    },
    board: {
      id: "board",
      layers: 2,
      size: { width: "50mm", height: "30mm" }
    },
    layout: { board: "board", placements: {}, routingIntent: [] },
    nodes: [
      {
        id: "mcu",
        kind: "component",
        component: "@nocad/rp2350:RP2354B",
        package: "QFN-80"
      },
      {
        id: "video-output",
        kind: "intent.function",
        function: "@nocad/video:hdmi_output.v1",
        include: { tmds: true, ddc: true, hpd: true, cec: false }
      },
      {
        id: "video-ffc",
        kind: "component",
        component: "@nocad/connectors:TE_1-1734839-4"
      }
    ],
    edges: [
      {
        id: "provider",
        kind: "intent.provides",
        from: { node: "mcu", port: "video_out" },
        to: { node: "video-output", port: "source" },
        contract: "@nocad/video:hdmi_output.v1",
        strategy: { pinAssignment: "auto", providerMode: "custom_gpio" }
      },
      {
        id: "exposure",
        kind: "intent.exposes",
        from: { node: "video-output", port: "connector" },
        to: { node: "video-ffc", port: "hdmi" },
        contract: "@nocad/video:hdmi_output.v1"
      }
    ]
  };
}
