import { describe, expect, it } from "vitest";

import { createHdmiSliceProject } from "@nocad/intent-core";
import type { ProjectNode } from "@nocad/intent-core";

import { matchFunctionComponentConnection } from "./function-connection-intent";

describe("matchFunctionComponentConnection", () => {
  const source = createHdmiSliceProject();
  const hdmiFunction = requiredNode(source.nodes, "intent.function");
  const mcu = requiredComponent(source.nodes, "@nocad/rp2350:RP2350A");
  const fpga: ProjectNode = {
    id: "fpga",
    kind: "component",
    component: "@nocad/fpga:GENERIC_FPGA"
  };
  const connector = requiredComponent(source.nodes, "@nocad/connectors:HDMI_TYPE_A_RECEPTACLE");

  it("finds package-declared provider and exposure ports", () => {
    expect(matchFunctionComponentConnection(mcu, hdmiFunction)).toEqual({
      intent: {
        componentPort: "video_out",
        contract: "@nocad/video:hdmi_output.v1",
        kind: "provides",
        providerMode: "auto"
      }
    });
    expect(matchFunctionComponentConnection(connector, hdmiFunction)).toEqual({
      intent: {
        componentPort: "hdmi",
        contract: "@nocad/video:hdmi_output.v1",
        kind: "exposes"
      }
    });
    expect(matchFunctionComponentConnection(fpga, hdmiFunction)).toEqual({
      intent: {
        componentPort: "gpio",
        contract: "@nocad/video:hdmi_output.v1",
        kind: "provides",
        providerMode: "generic_gpio"
      }
    });
  });

  it("rejects an I2C sensor as an HDMI provider or exposure", () => {
    const sensor: ProjectNode = {
      id: "sensor",
      kind: "component",
      component: "@nocad/sensors:I2C_TEMP_SENSOR"
    };

    expect(matchFunctionComponentConnection(sensor, hdmiFunction)).toEqual({ reason: "incompatible" });
  });
});

function requiredNode(nodes: ProjectNode[], kind: ProjectNode["kind"]) {
  const node = nodes.find((candidate) => candidate.kind === kind);

  if (!node) {
    throw new Error(`Missing ${kind} fixture node.`);
  }

  return node;
}

function requiredComponent(nodes: ProjectNode[], component: string) {
  const node = nodes.find((candidate) => candidate.kind === "component" && candidate.component === component);

  if (!node) {
    throw new Error(`Missing ${component} fixture node.`);
  }

  return node;
}
