import { builtInComponentLibrary } from "@nocad/component-library";
import { ProjectDocument, resolveProject, type DefinitionCatalog } from "@nocad/intent-core";
import {
  createFixtureResolutionEnvironment,
  fixtureCatalog
} from "@nocad/intent-core/fixtures";
import { describe, expect, it } from "vitest";

import { createDemoProjectExamples } from "./demo-catalog";

describe("demo catalog boundary", () => {
  it("uses only components present in the built-in component library", async () => {
    const [descriptors, components] = await Promise.all([
      builtInComponentLibrary.list(),
      builtInComponentLibrary.loadDefinitions()
    ]);
    const knownComponents = new Set(Object.keys(components));
    const catalog: DefinitionCatalog = {
      components,
      contracts: fixtureCatalog.contracts,
      functions: fixtureCatalog.functions
    };
    const environment = { ...createFixtureResolutionEnvironment(), catalog };

    for (const example of createDemoProjectExamples(descriptors)) {
      const source = example.createSource();
      expect(() => new ProjectDocument(source), example.id).not.toThrow();
      const authoredComponents = source.nodes.flatMap((node) =>
        node.kind === "component" ? [node.component] : []
      );
      const resolved = resolveProject(source, environment);
      const generatedComponents = resolved.generated.map(
        (component) => component.component
      );

      expect(authoredComponents, example.id).toSatisfy((componentIds: string[]) =>
        componentIds.every((componentId) => knownComponents.has(componentId))
      );
      expect(generatedComponents, example.id).toSatisfy((componentIds: string[]) =>
        componentIds.every((componentId) => knownComponents.has(componentId))
      );
      expect(
        resolved.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        example.id
      ).toEqual([]);
    }
  });
});
