import {
  createProjectSourceSet,
  resolveProject,
  type ProjectSource
} from "@nocad/intent-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PcbDesignerPanel } from "./pcb-designer-panel";

describe("PcbDesignerPanel", () => {
  it("renders a generic empty state when the project has no authored board", () => {
    const source: ProjectSource = {
      dependencies: {},
      edges: [],
      id: "boardless-project",
      name: "Boardless project",
      nodes: [],
      schema: "nocad.project.v0"
    };
    const catalog = { components: {}, contracts: {}, functions: {} };
    const html = renderToStaticMarkup(
      <PcbDesignerPanel
        catalog={catalog}
        onSetComponentPlacement={() => undefined}
        onSourceSelectionChange={() => undefined}
        resolved={resolveProject(source, {
          catalog,
          resolveDependency: () => undefined,
          sourceSet: createProjectSourceSet
        })}
        source={source}
      />
    );

    expect(html).toContain("No authored board");
    expect(html).toContain("Add board dimensions");
  });
});
