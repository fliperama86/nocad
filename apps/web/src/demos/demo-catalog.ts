import {
  createHdmiSliceProject,
  createRp2350HdmiTxSliceProject,
  hdmiSliceIds,
  hdmiTxSliceIds
} from "@nocad/intent-core/fixtures";
import type { FunctionNode, ProjectSource } from "@nocad/intent-core";
import type { ComponentDescriptor } from "@nocad/component-library";
import type {
  WorkspaceNodeTemplate,
  WorkspaceProjectExample
} from "../features/workspace/project-workspace-app";

const directVideoPositions = {
  [hdmiSliceIds.mcu]: { x: 110, y: 270 },
  [hdmiSliceIds.hdmiFunction]: { x: 460, y: 215 },
  [hdmiSliceIds.hdmiPort]: { x: 820, y: 270 },
  [hdmiSliceIds.rail5v]: { x: 820, y: 80 }
};

const transmitterPositions = {
  [hdmiTxSliceIds.videoSource]: { x: 80, y: 280 },
  [hdmiTxSliceIds.tx]: { x: 400, y: 280 },
  [hdmiTxSliceIds.hdmiFunction]: { x: 720, y: 220 },
  [hdmiTxSliceIds.hdmiPort]: { x: 1040, y: 280 },
  [hdmiTxSliceIds.rail5v]: { x: 1040, y: 80 }
};

export function createDemoProjectExamples(
  descriptors: readonly ComponentDescriptor[]
): WorkspaceProjectExample[] {
  return [
    {
      createSource: () => createRealDirectVideoProject(descriptors),
      id: "direct-video-output",
      label: "direct video output",
      positions: directVideoPositions
    },
    {
      createSource: () => createRealTransmitterProject(descriptors),
      id: "rp2350-transmitter-chain",
      label: "RP2350 transmitter chain",
      positions: transmitterPositions
    }
  ];
}

const demoIntentTemplates: WorkspaceNodeTemplate[] = [
  {
    dependency: { name: "@nocad/video", version: "0.1.0" },
    id: "video-output-function",
    label: "Video output",
    node: {
      kind: "intent.function",
      label: "Video output",
      role: "video_output",
      function: "@nocad/video:hdmi_output.v1",
      requirements: { resolution: "640x480@60", colorDepth: "rgb332" },
      include: {
        tmds: true,
        ddc: true,
        hpd: true,
        cec: false,
        source5v: true,
        seriesTermination: { mode: "off", value: "270ohm" },
        esdProtection: "off"
      }
    }
  },
  {
    id: "five-volt-domain",
    label: "5V power domain",
    node: {
      kind: "powerDomain",
      label: "5V rail",
      role: "power_5v",
      voltage: "5V"
    }
  }
];

export function createDemoNodeTemplates(
  descriptors: readonly ComponentDescriptor[]
): WorkspaceNodeTemplate[] {
  return [
    ...descriptors.map((descriptor) => ({
      dependency: {
        name: descriptor.package.name,
        version: descriptor.package.version
      },
      description: `${descriptor.description}. ${
        descriptor.coverage === "complete"
          ? "Complete component definition."
          : "Interface definition, not package-complete."
      }`,
      id: descriptor.id,
      label: `${descriptor.manufacturer} ${descriptor.partNumber}`,
      node: {
        kind: "component" as const,
        component: descriptor.id,
        label:
          descriptor.id === "@nocad/connectors:TE_1-1734839-4"
            ? "Video FFC connector"
            : descriptor.partNumber,
        package: descriptor.devicePackage,
        refdesHint: descriptor.id === "@nocad/connectors:TE_1-1734839-4" ? "J?" : "U?"
      }
    })),
    ...demoIntentTemplates
  ];
}

export function createRealDirectVideoProject(
  descriptors: readonly ComponentDescriptor[] = []
): ProjectSource {
  return replaceFixtureVideoParts(
    createHdmiSliceProject(),
    "@nocad/rp2350:RP2354B",
    descriptors
  );
}

export function createRealTransmitterProject(
  descriptors: readonly ComponentDescriptor[] = []
): ProjectSource {
  return replaceFixtureVideoParts(
    createRp2350HdmiTxSliceProject(),
    "@nocad/rp2350:RP2350A",
    descriptors
  );
}

function replaceFixtureVideoParts(
  source: ProjectSource,
  sourceComponent: string,
  descriptors: readonly ComponentDescriptor[]
): ProjectSource {
  const packageFor = (component: string) =>
    descriptors.find((descriptor) => descriptor.id === component)?.devicePackage;

  return {
    ...source,
    nodes: source.nodes.map((node) => {
      if (node.kind === "component" && node.role === "hdmi_port") {
        return {
          ...node,
          component: "@nocad/connectors:TE_1-1734839-4",
          label: "Video FFC connector",
          package: packageFor("@nocad/connectors:TE_1-1734839-4")
        };
      }

      if (node.kind === "component" && (node.role === "mcu" || node.role === "video_source")) {
        return { ...node, component: sourceComponent, package: packageFor(sourceComponent) };
      }

      return node.kind === "intent.function" ? disableUncatalogedGeneratedParts(node) : node;
    })
  };
}

function disableUncatalogedGeneratedParts(node: FunctionNode): FunctionNode {
  return {
    ...node,
    include: {
      ...node.include,
      esdProtection: "off",
      seriesTermination: { mode: "off", value: "270ohm" }
    }
  };
}
