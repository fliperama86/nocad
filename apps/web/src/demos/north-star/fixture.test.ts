import { ProjectDocument, resolveProject } from "@nocad/intent-core";
import { describe, expect, it } from "vitest";

import expectedResolution from "../../../../../fixtures/semantic/pico-retrodigital-main/video-output/expected-resolution.json";
import {
  createCatalogNodeTemplates,
  createCatalogResolutionEnvironment
} from "../../features/workspace/catalog-workspace";
import { loadWorkspaceFixtureCatalog } from "../workspace-fixture";
import { fixture } from "./fixture";

describe("north-star browser fixture", () => {
  it("loads the exact project through its dependency-only browser package source", async () => {
    const catalog = await loadWorkspaceFixtureCatalog(fixture);
    const resolved = resolveProject(
      fixture.source,
      createCatalogResolutionEnvironment(catalog)
    );

    expect(fixture.source.nodes).toHaveLength(11);
    expect(fixture.source.edges).toHaveLength(18);
    expect(fixture.source.nodes.filter(({ kind }) => kind === "component")).toHaveLength(
      expectedResolution.counts.authoredComponents
    );
    expect(fixture.source.edges.filter(({ kind }) => kind === "net.authored")).toHaveLength(
      expectedResolution.counts.authoredNets
    );
    expect(resolved.nets).toHaveLength(expectedResolution.counts.resolvedNets);
    expect(resolved.generated.map(({ id }) => id)).toEqual(expectedResolution.generatedComponents);
    expect(resolved.diagnostics).toEqual(expectedResolution.diagnostics);
    expect(
      resolved.resolvedChoices.map(({ selected, sourceEdge, strategy }) => ({
        ...(selected.providerMode ? { providerMode: selected.providerMode } : {}),
        sourceEdge,
        strategy
      }))
    ).toEqual(expectedResolution.resolvedChoices);
    expect(catalog.library.capturedComponentDescriptors).toHaveLength(8);
    expect(catalog.library.capturedFunctionDescriptors).toHaveLength(1);

    for (const [name, version] of Object.entries(fixture.source.dependencies)) {
      expect(catalog.library.packages[name]?.version, name).toBe(version);
    }
  });

  it("keeps dependency-only definitions out of the normal authoring palette", async () => {
    const catalog = await loadWorkspaceFixtureCatalog(fixture);
    const templates = createCatalogNodeTemplates(catalog);
    const capturedIds = new Set([
      ...catalog.library.capturedComponentDescriptors.map(({ id }) => id),
      ...catalog.library.capturedFunctionDescriptors.map(({ id }) => id)
    ]);

    expect(capturedIds.size).toBe(9);
    expect(templates.some(({ id }) => capturedIds.has(id.replace(/^function:/, "")))).toBe(false);
  });

  it("round-trips the fixture through the project document without losing stable data", () => {
    const document = new ProjectDocument(fixture.source);

    expect(JSON.parse(document.save())).toEqual(fixture.source);
    expect(Object.keys(fixture.positions).sort()).toEqual(
      fixture.source.nodes.map(({ id }) => id).sort()
    );
    expect(fixture.source.board).toBeUndefined();
  });
});
