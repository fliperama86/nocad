import { describe, expect, it } from "vitest";

import { components, createHdmiTxSliceProject, hdmiTxSliceIds } from "@nocad/intent-core";

import {
  filterConnectionOptionsForProviderRequirement,
  providerRequirementForHandle,
  providerRequirementHandleId,
  providerRequirementHandlesForNode,
  providerRequirementPortFromHandle,
  providerRequirementTargetHandle
} from "./provider-requirement-handles";

describe("provider requirement handles", () => {
  it("derives labeled stable handles from the active provider mode", () => {
    const source = createHdmiTxSliceProject({ omitCtrl: true, omitVideoIn: true });
    const tx = requiredNode(source, hdmiTxSliceIds.tx);

    expect(providerRequirementHandlesForNode(source, tx)).toEqual([
      {
        acceptedContracts: ["@nocad/video:pixel_stream.v1"],
        connectedEdgeId: undefined,
        handleId: "requirement:video_in",
        label: "Video In",
        optional: false,
        port: "video_in"
      },
      {
        acceptedContracts: ["builtin:i2c.v1"],
        connectedEdgeId: undefined,
        handleId: "requirement:ctrl",
        label: "I2C Control",
        optional: false,
        port: "ctrl"
      }
    ]);
    expect(providerRequirementHandleId("video input/0")).toBe("requirement:video%20input%2F0");
    expect(providerRequirementPortFromHandle("requirement:video%20input%2F0")).toBe("video input/0");
  });

  it("marks satisfied requirements and attaches their edge to the matching handle", () => {
    const source = createHdmiTxSliceProject();
    const tx = requiredNode(source, hdmiTxSliceIds.tx);
    const requirements = providerRequirementHandlesForNode(source, tx);
    const ctrlRequirement = requirements.find((requirement) => requirement.port === "ctrl");
    const ctrlEdge = source.edges.find(
      (edge) => edge.kind === "intent.connection" && edge.id === hdmiTxSliceIds.ctrlConnection
    );

    expect(ctrlRequirement?.connectedEdgeId).toBe(hdmiTxSliceIds.ctrlConnection);
    expect(ctrlEdge?.kind).toBe("intent.connection");
    expect(ctrlEdge?.kind === "intent.connection" ? providerRequirementTargetHandle(source, ctrlEdge) : undefined).toBe(
      "requirement:ctrl"
    );
  });

  it("does not expose requirements until a component is an active provider", () => {
    const source = createHdmiTxSliceProject();
    const tx = requiredNode(source, hdmiTxSliceIds.tx);
    const sourceWithoutProvider = {
      ...source,
      edges: source.edges.filter((edge) => edge.kind !== "intent.provides")
    };

    expect(providerRequirementHandlesForNode(sourceWithoutProvider, tx)).toEqual([]);
  });

  it("preserves optional metadata on a first declaration", () => {
    const requirement = components["@nocad/hdmi-tx:IT66121"]?.ports.hdmi_tx.provides?.[
      "@nocad/video:hdmi_output.v1"
    ]?.modes.hdmi_1v4?.requires?.ports?.video_in;

    if (!requirement) {
      throw new Error("Missing HDMI transmitter video input requirement.");
    }

    const previousOptional = requirement.optional;
    requirement.optional = true;

    try {
      const source = createHdmiTxSliceProject({ omitCtrl: true, omitVideoIn: true });
      const tx = requiredNode(source, hdmiTxSliceIds.tx);

      expect(
        providerRequirementHandlesForNode(source, tx).find((candidate) => candidate.port === "video_in")?.optional
      ).toBe(true);
    } finally {
      requirement.optional = previousOptional;
    }
  });

  it("filters a requirement drop to its exact target port and accepted contract", () => {
    const source = createHdmiTxSliceProject({ omitCtrl: true, omitVideoIn: true });
    const tx = requiredNode(source, hdmiTxSliceIds.tx);
    const requirement = providerRequirementForHandle(source, tx, "requirement:ctrl");
    const options = [
      option("i2c", hdmiTxSliceIds.tx, "ctrl", "builtin:i2c.v1"),
      option("pixels", hdmiTxSliceIds.tx, "video_in", "@nocad/video:pixel_stream.v1"),
      option("other node", "other", "ctrl", "builtin:i2c.v1")
    ];

    expect(filterConnectionOptionsForProviderRequirement(options, hdmiTxSliceIds.tx, requirement)).toEqual([
      options[0]
    ]);
  });

  it("filters anonymous drops away from satisfied active requirement ports", () => {
    const source = createHdmiTxSliceProject();
    const tx = requiredNode(source, hdmiTxSliceIds.tx);
    const activeRequirements = providerRequirementHandlesForNode(source, tx);
    const options = [
      option("i2c", hdmiTxSliceIds.tx, "ctrl", "builtin:i2c.v1"),
      option("unrelated", hdmiTxSliceIds.tx, "debug", "@nocad/io:digital_output.v1")
    ];

    expect(
      filterConnectionOptionsForProviderRequirement(options, hdmiTxSliceIds.tx, undefined, activeRequirements)
    ).toEqual([options[1]]);
    expect(
      filterConnectionOptionsForProviderRequirement(
        options,
        hdmiTxSliceIds.tx,
        activeRequirements.find((requirement) => requirement.port === "ctrl"),
        activeRequirements
      )
    ).toEqual([]);
  });

  it("keeps disjoint same-port requirements as separate identities", () => {
    const component = components["@nocad/hdmi-tx:IT66121"];

    if (!component) {
      throw new Error("Missing HDMI transmitter definition.");
    }

    component.ports.secondary_provider = {
      kind: "fixed_port",
      provides: {
        "@nocad/video:hdmi_output.v1": {
          role: "provider",
          modes: {
            secondary: {
              requires: {
                ports: {
                  ctrl: {
                    contract: "@nocad/io:digital_output.v1",
                    label: "Enable Control"
                  }
                }
              },
              signalMap: {}
            }
          }
        }
      }
    };

    try {
      const source = createHdmiTxSliceProject();
      source.edges.push({
        id: "secondary-provider",
        kind: "intent.provides",
        from: { node: hdmiTxSliceIds.tx, port: "secondary_provider" },
        to: { node: hdmiTxSliceIds.hdmiFunction, port: "source" },
        contract: "@nocad/video:hdmi_output.v1",
        strategy: { pinAssignment: "auto", providerMode: "secondary" }
      });
      const tx = requiredNode(source, hdmiTxSliceIds.tx);
      const ctrlRequirements = providerRequirementHandlesForNode(source, tx).filter(
        (requirement) => requirement.port === "ctrl"
      );
      const reversedSource = {
        ...source,
        edges: [...source.edges].reverse()
      };
      const reversedIdentities = providerRequirementHandlesForNode(reversedSource, tx)
        .filter((requirement) => requirement.port === "ctrl")
        .map((requirement) => [requirement.label, requirement.handleId])
        .sort();

      expect(ctrlRequirements).toMatchObject([
        {
          acceptedContracts: ["builtin:i2c.v1"],
          connectedEdgeId: hdmiTxSliceIds.ctrlConnection,
          handleId: `requirement:ctrl:${hdmiTxSliceIds.txVideoProvider}`,
          label: "I2C Control"
        },
        {
          acceptedContracts: ["@nocad/io:digital_output.v1"],
          connectedEdgeId: undefined,
          handleId: "requirement:ctrl:secondary-provider",
          label: "Enable Control"
        }
      ]);
      expect(reversedIdentities).toEqual(
        ctrlRequirements
          .map((requirement) => [requirement.label, requirement.handleId])
          .sort()
      );
    } finally {
      delete component.ports.secondary_provider;
    }
  });
});

function option(id: string, node: string, port: string, contract: string) {
  return {
    contract,
    id,
    to: { node, port }
  };
}

function requiredNode(source: ReturnType<typeof createHdmiTxSliceProject>, nodeId: string) {
  const node = source.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    throw new Error(`Missing node ${nodeId}.`);
  }

  return node;
}
