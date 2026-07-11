import { describe, expect, it } from "vitest";

import {
  createHdmiSliceProject,
  getComponentPinOptions,
  hdmiSliceIds,
  resolveProject
} from "@nocad/intent-core";
import type { IntentProvidesEdge, ProjectSource } from "@nocad/intent-core";

import {
  bindingsForProviderMode,
  fixedProviderPinsForEdge,
  providerModeDefinitionForEdge,
  providerModesForEdge,
  providerSignalIsEditable
} from "./provider-assignment";

describe("provider assignment metadata", () => {
  it("derives the generic FPGA mode and exactly 64 io pin options from package data", () => {
    const source = createGenericFpgaHdmiProject();
    const edge = requiredProviderEdge(source);
    const pinOptions = getComponentPinOptions(source, hdmiSliceIds.mcu, "gpio");

    expect(providerModesForEdge(source, edge)).toEqual([{ label: "Generic GPIO", value: "generic_gpio" }]);
    expect(providerModeDefinitionForEdge(source, edge, "generic_gpio")?.signalMap.tmds2_p).toEqual({
      pinSelector: { capabilities: ["gpio"] }
    });
    expect(fixedProviderPinsForEdge(source, edge, "generic_gpio")).toEqual({});
    expect(pinOptions.map((pin) => pin.id)).toEqual(Array.from({ length: 64 }, (_, index) => `io${index}`));
  });

  it("keeps generic GPIO TMDS mappings editable and retains authored pins when selecting the mode", () => {
    const source = createGenericFpgaHdmiProject();
    const baseEdge = requiredProviderEdge(source);
    const edge: IntentProvidesEdge = {
      ...baseEdge,
      bindings: {
        tmds2_p: { from: { node: hdmiSliceIds.mcu, pin: "io42" } }
      }
    };

    expect(providerSignalIsEditable(source, edge, "generic_gpio", "tmds2_p")).toBe(true);
    expect(bindingsForProviderMode(source, edge, "generic_gpio")).toEqual(edge.bindings);
  });

  it("shows resolved generic io mappings instead of the RP2350 GPIO12-19 preset", () => {
    const source = createGenericFpgaHdmiProject();
    const edge = requiredProviderEdge(source);
    const resolved = resolveProject(source);
    const choice = resolved.resolvedChoices.find((candidate) => candidate.sourceEdge === edge.id);
    const sourcePins = Object.values(choice?.selected.bindings ?? {}).flatMap((binding) =>
      binding.from?.pin ? [binding.from.pin] : []
    );

    expect(resolved.diagnostics).toEqual([]);
    expect(choice?.selected.providerMode).toBe("generic_gpio");
    expect(sourcePins).toHaveLength(11);
    expect(sourcePins).toEqual(Array.from({ length: 11 }, (_, index) => `io${index}`));
    expect(sourcePins).not.toEqual(expect.arrayContaining(["gpio12", "gpio13", "gpio19"]));
  });

  it("derives the RP2350 fixed mode mapping from its declared provider mode", () => {
    const source = createHdmiSliceProject();
    const edge = requiredProviderEdge(source);

    expect(providerModesForEdge(source, edge).map((mode) => mode.value)).toEqual([
      "auto",
      "hstx",
      "pio_gpio",
      "custom_gpio"
    ]);
    expect(fixedProviderPinsForEdge(source, edge, "hstx")).toMatchObject({
      clock_n: "gpio19",
      clock_p: "gpio18",
      tmds2_n: "gpio13",
      tmds2_p: "gpio12"
    });
  });

  it("treats RP2350 HSTX TMDS as fixed while retaining selectable sideband bindings", () => {
    const source = createHdmiSliceProject();
    const baseEdge = requiredProviderEdge(source);
    const edge: IntentProvidesEdge = {
      ...baseEdge,
      bindings: {
        ddc_sda: { from: { node: hdmiSliceIds.mcu, pin: "gpio4" } },
        tmds2_p: { from: { node: hdmiSliceIds.mcu, pin: "gpio20" } }
      }
    };

    expect(providerSignalIsEditable(source, edge, "hstx", "tmds2_p")).toBe(false);
    expect(providerSignalIsEditable(source, edge, "hstx", "ddc_sda")).toBe(true);
    expect(bindingsForProviderMode(source, edge, "hstx")).toEqual({
      ddc_sda: { from: { node: hdmiSliceIds.mcu, pin: "gpio4" } }
    });
  });
});

function createGenericFpgaHdmiProject(): ProjectSource {
  const source = createHdmiSliceProject();

  return {
    ...source,
    dependencies: {
      ...source.dependencies,
      "@nocad/fpga": "0.1.0"
    },
    nodes: source.nodes.map((node) =>
      node.id === hdmiSliceIds.mcu && node.kind === "component"
        ? {
            ...node,
            component: "@nocad/fpga:GENERIC_FPGA",
            role: "video_source"
          }
        : node
    ),
    edges: source.edges.map((edge) =>
      edge.id === hdmiSliceIds.videoProvider && edge.kind === "intent.provides"
        ? {
            ...edge,
            from: { node: hdmiSliceIds.mcu, port: "gpio" },
            strategy: { pinAssignment: "auto", providerMode: "generic_gpio" }
          }
        : edge
    )
  };
}

function requiredProviderEdge(source: ProjectSource): IntentProvidesEdge {
  const edge = source.edges.find(
    (candidate): candidate is IntentProvidesEdge =>
      candidate.id === hdmiSliceIds.videoProvider && candidate.kind === "intent.provides"
  );

  if (!edge) {
    throw new Error("Missing HDMI provider edge.");
  }

  return edge;
}
