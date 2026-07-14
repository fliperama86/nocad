// @vitest-environment node

import { describe, expect, it } from "vitest";

import configFactory from "../vite.config";

describe("Vite entry isolation", () => {
  it("keeps research pages out of the standard production build", async () => {
    if (typeof configFactory !== "function") throw new Error("Expected a mode-aware Vite config.");

    const production = await configFactory({
      command: "build",
      isPreview: false,
      isSsrBuild: false,
      mode: "production"
    });
    const research = await configFactory({
      command: "build",
      isPreview: false,
      isSsrBuild: false,
      mode: "research"
    });

    expect(production.build?.rollupOptions?.input).toBeUndefined();
    expect(research.build?.rollupOptions?.input).toEqual({
      demo: "demo.html",
      fixture: "fixture.html",
      main: "index.html",
      northStar: "north-star.html"
    });
  });
});
