import type { ProjectSource } from "@nocad/intent-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BindingsPanel } from "./bindings-panel";

const source: ProjectSource = {
  dependencies: {},
  edges: [],
  id: "bindings-panel",
  name: "Bindings panel",
  nodes: [],
  schema: "nocad.project.v0"
};

describe("BindingsPanel", () => {
  it("prompts for an edge when no resolved choice is selected", () => {
    const html = renderToStaticMarkup(
      <BindingsPanel nets={[]} selectedChoice={undefined} source={source} />
    );

    expect(html).toContain("Select a resolved intent edge to inspect bindings.");
    expect(html).not.toContain(">unresolved<");
  });
});
