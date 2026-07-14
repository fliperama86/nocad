import { describe, expect, it } from "vitest";

import { createWorkspaceFixture } from "./workspace-fixture";

const projectJson = JSON.stringify({
  dependencies: {},
  edges: [],
  id: "fixture",
  name: "Fixture",
  nodes: [{ component: "package:part", id: "node", kind: "component" }],
  schema: "nocad.project.v0"
});
const manifest = {
  id: "fixture",
  provenance: { sourceFree: true },
  status: {
    exactPhysicalParity: false,
    golden: false,
    hardwareQualified: false,
    license: "NOASSERTION",
    scope: "test-scope"
  }
};

describe("createWorkspaceFixture", () => {
  it("parses project data, status, and finite positions", () => {
    const fixture = createWorkspaceFixture({
      manifestValue: manifest,
      packageSources: [],
      positionsValue: { node: { x: 10, y: 20 } },
      projectJson
    });

    expect(fixture.source.id).toBe("fixture");
    expect(fixture.positions).toEqual({ node: { x: 10, y: 20 } });
    expect(fixture.status).toEqual({
      exactPhysicalParity: false,
      golden: false,
      hardwareQualified: false,
      license: "NOASSERTION",
      scope: "test-scope",
      sourceFree: true
    });
  });

  it("rejects mismatched fixture identities", () => {
    expect(() =>
      createWorkspaceFixture({
        manifestValue: { ...manifest, id: "other" },
        packageSources: [],
        positionsValue: {},
        projectJson
      })
    ).toThrow("manifest and project must have the same id");
  });

  it("rejects positions for unknown nodes or non-finite coordinates", () => {
    expect(() =>
      createWorkspaceFixture({
        manifestValue: manifest,
        packageSources: [],
        positionsValue: { other: { x: 10, y: 20 } },
        projectJson
      })
    ).toThrow("unknown node other");
    expect(() =>
      createWorkspaceFixture({
        manifestValue: manifest,
        packageSources: [],
        positionsValue: { node: { x: Number.NaN, y: 20 } },
        projectJson
      })
    ).toThrow("must be a finite number");
  });
});
