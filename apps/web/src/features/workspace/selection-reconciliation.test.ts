import { describe, expect, it } from "vitest";

import { reconcileControlledSelection } from "./selection-reconciliation";

describe("reconcileControlledSelection", () => {
  it("clears stale local selection when the controlled selection clears", () => {
    expect([...reconcileControlledSelection(["a", "b"], undefined)]).toEqual([]);
  });

  it("switches to a parent-selected object that was not locally selected", () => {
    expect([...reconcileControlledSelection(["a", "b"], "c")]).toEqual(["c"]);
  });

  it("preserves a local multi-selection when its controlled primary object remains selected", () => {
    expect([...reconcileControlledSelection(["a", "b"], "a")]).toEqual(["a", "b"]);
  });

  it("preserves a mixed node-and-edge selection through its controlled edge primary", () => {
    expect([...reconcileControlledSelection(["node:a", "edge:b"], "edge:b")]).toEqual([
      "node:a",
      "edge:b"
    ]);
  });
});
