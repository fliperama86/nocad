import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { serializeProjectSource } from "./project-document";
import { createProjectSourceSet, sha256Text } from "./provenance";
import type { ProjectSource } from "./types";

const project: ProjectSource = {
  schema: "nocad.project.v0",
  id: "hash-test",
  name: "Hash test",
  dependencies: {},
  nodes: [],
  edges: []
};

describe("sha256Text", () => {
  it.each(["", "abc", "nocad λ", "x".repeat(1000)])("matches the platform SHA-256 for %j", (value) => {
    expect(sha256Text(value)).toBe(createHash("sha256").update(value).digest("hex"));
  });
});

describe("createProjectSourceSet", () => {
  it("computes cryptographic provenance from the serialized project content", () => {
    const first = createProjectSourceSet(project);
    const second = createProjectSourceSet({ ...project, name: "Changed" });
    const expectedHash = createHash("sha256").update(serializeProjectSource(project)).digest("hex");

    expect(first.hash).toBe(`sha256:${expectedHash}`);
    expect(first.files).toEqual([
      { hash: first.hash, path: "project.nocad.json", role: "project" }
    ]);
    expect(second.hash).not.toBe(first.hash);
  });
});
