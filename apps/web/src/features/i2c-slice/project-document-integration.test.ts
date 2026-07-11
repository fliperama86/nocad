import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const featureDirectory = resolve(process.cwd(), "src/features/i2c-slice");
const appSource = readFileSync(resolve(featureDirectory, "i2c-slice-app.tsx"), "utf8");
const dialogSource = readFileSync(resolve(featureDirectory, "connection-intent-dialog.tsx"), "utf8");
const graphSource = readFileSync(resolve(featureDirectory, "intent-graph-view.tsx"), "utf8");

describe("I2cSliceApp project document integration", () => {
  it("uses one external-store ProjectDocument instead of mirrored source state", () => {
    expect(appSource).toContain("new ProjectDocument(createBlankSource())");
    expect(appSource).toContain("useSyncExternalStore(");
    expect(appSource).not.toMatch(/\bsetSource\b/);
    expect(appSource).not.toMatch(/useState\s*<\s*ProjectSource/);
  });

  it("routes edits, history, and persistence through the document API", () => {
    expect(appSource).toContain("projectDocument.apply(");
    expect(appSource).toContain("projectDocument.undo()");
    expect(appSource).toContain("projectDocument.redo()");
    expect(appSource).toContain("new Blob([projectDocument.save()]");
    expect(appSource).toContain("projectDocument.replace(nextSource, { expectedRevision })");
    expect(appSource.match(/op: "batch"/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("revision-guards delayed and resolver-derived edits", () => {
    expect(dialogSource).toContain("revision: number");
    expect(appSource).toContain("revision: projectDocument.revision");
    expect(appSource).toContain("pendingConnection?.revision");
    expect(appSource.match(/resolutionSnapshot\.revision/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps graph positions ephemeral while pruning deleted child selections", () => {
    expect(appSource).not.toContain("Object.fromEntries(Object.entries(currentPositions).filter");
    expect(graphSource).toContain("currentIds.filter((id) => nextNodeIds.has(id))");
    expect(graphSource).toContain("currentIds.filter((id) => nextEdgeIds.has(id))");
  });

  it("commits mixed React Flow deletion as one cascade-safe document batch", () => {
    expect(graphSource).toContain("onDelete={removeDeletedSelection}");
    expect(graphSource).not.toContain("onNodesDelete=");
    expect(graphSource).not.toContain("onEdgesDelete=");
    expect(appSource).toContain("!edgeReferencesAnyNode(edge, existingNodeIdSet)");
    expect(appSource).toContain("...explicitEdgeIds.map((edge) => ({ op: \"removeEdge\", edge })");
    expect(appSource).toContain("...existingNodeIds.map((node) => ({ op: \"removeNode\", node })");
  });
});
