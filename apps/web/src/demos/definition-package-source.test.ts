import type { CapturedPackageDefinitionLoader } from "@nocad/component-library";
import { describe, expect, it } from "vitest";

import {
  definitionPackageLoadersFromGlob,
  InvalidDefinitionPackageGlobError
} from "./definition-package-source";

describe("definitionPackageLoadersFromGlob", () => {
  it("converts statically discovered module paths into manifest-relative loaders", async () => {
    const first = definitionLoader("first");
    const second = definitionLoader("second");

    const loaders = definitionPackageLoadersFromGlob("../../fixtures/package-root", {
      "../../fixtures/package-root/definitions/first.json": first,
      "../../fixtures/package-root/definitions/nested/second.json": second
    });

    expect(loaders).toEqual({
      "definitions/first.json": first,
      "definitions/nested/second.json": second
    });
    expect(Object.isFrozen(loaders)).toBe(true);
    await expect(loaders["definitions/first.json"]?.()).resolves.toEqual({
      default: { id: "first" }
    });
  });

  it("normalizes separators and dot segments before deriving loader keys", () => {
    const loader = definitionLoader("normalized");

    expect(
      definitionPackageLoadersFromGlob(".\\fixtures\\package-root\\", {
        "fixtures/package-root/definitions/./nested/../unit.json": loader
      })
    ).toEqual({ "definitions/unit.json": loader });
  });

  it.each([
    ["a sibling path", "fixtures/other/definition.json"],
    ["a traversing path", "fixtures/package-root/definitions/../../outside.json"],
    ["an absolute path for a relative root", "/fixtures/package-root/definition.json"]
  ])("rejects %s outside the package root", (_label, modulePath) => {
    expect(() =>
      definitionPackageLoadersFromGlob("fixtures/package-root", {
        [modulePath]: definitionLoader("outside")
      })
    ).toThrow(InvalidDefinitionPackageGlobError);
    expect(() =>
      definitionPackageLoadersFromGlob("fixtures/package-root", {
        [modulePath]: definitionLoader("outside")
      })
    ).toThrow("must resolve inside the package root");
  });

  it("rejects a module path that resolves to the package root", () => {
    expect(() =>
      definitionPackageLoadersFromGlob("fixtures/package-root", {
        "fixtures/package-root/definitions/..": definitionLoader("root")
      })
    ).toThrow("must not resolve to the package root");
  });

  it("rejects traversal above a dot package root", () => {
    expect(() =>
      definitionPackageLoadersFromGlob(".", {
        "../outside/definition.json": definitionLoader("outside")
      })
    ).toThrow("must resolve inside the package root");
  });

  it("rejects duplicate manifest paths after normalization", () => {
    expect(() =>
      definitionPackageLoadersFromGlob("fixtures/package-root", {
        "fixtures/package-root/definitions/unit.json": definitionLoader("first"),
        "fixtures/package-root/definitions/./unit.json": definitionLoader("second")
      })
    ).toThrow("duplicate normalized definition path definitions/unit.json");
  });

  it("rejects an empty package root", () => {
    expect(() => definitionPackageLoadersFromGlob("", {})).toThrow(
      "package root must not be empty"
    );
  });
});

function definitionLoader(id: string): CapturedPackageDefinitionLoader {
  return async () => ({ default: { id } });
}
