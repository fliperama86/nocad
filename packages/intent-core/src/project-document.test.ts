import { describe, expect, it, vi } from "vitest";

import { createHdmiSliceProject, createHdmiTxSliceProject, hdmiSliceIds, hdmiTxSliceIds } from "./samples";
import {
  ProjectDocument,
  ProjectDocumentError,
  applyProjectPatch,
  parseProjectSourceJson,
  serializeProjectSource,
  validateProjectSource
} from "./project-document";
import type { ProjectPatch } from "./project-document";
import type { ProjectSource } from "./types";

describe("ProjectDocument", () => {
  it("applies semantic graph patches and exposes exact inverse records", () => {
    const source = createHdmiSliceProject();
    const document = new ProjectDocument(source);
    const sensorId = "node_sensor";
    const edgeId = "edge_sensor_bus";
    const patch: ProjectPatch = {
      op: "batch",
      patches: [
        { op: "setDependency", dependency: "@nocad/sensors", version: "0.1.0" },
        {
          op: "addNode",
          node: { id: sensorId, kind: "component", component: "@nocad/sensors:I2C_TEMP_SENSOR" }
        },
        {
          op: "addEdge",
          edge: {
            id: edgeId,
            kind: "intent.connection",
            from: { node: hdmiSliceIds.mcu, port: "i2c" },
            to: { node: sensorId, port: "i2c" },
            contract: "builtin:i2c.v1"
          }
        }
      ]
    };

    const record = document.apply(patch);

    expect(record).toMatchObject({ action: "apply", revision: 1, patch });
    expect(record?.inverse).toMatchObject({ op: "restoreBatch" });
    expect(document.source.nodes.at(-1)?.id).toBe(sensorId);
    expect(document.source.edges.at(-1)?.id).toBe(edgeId);
    expect(document.source.dependencies["@nocad/sensors"]).toBe("0.1.0");
    expect(document.canUndo).toBe(true);
  });

  it("supports every graph inspector field currently authored by the web slice", () => {
    const source = createHdmiTxSliceProject();
    const document = new ProjectDocument(source);
    const connection = source.edges.find((edge) => edge.id === hdmiTxSliceIds.ctrlConnection);

    if (!connection || connection.kind !== "intent.connection") {
      throw new Error("Missing control connection fixture.");
    }

    document.apply({
      op: "batch",
      patches: [
        {
          op: "setFunctionInclude",
          node: hdmiTxSliceIds.hdmiFunction,
          feature: "cec",
          value: true
        },
        {
          op: "setEdgeBindings",
          edge: connection.id,
          value: {
            sda: { from: { node: hdmiTxSliceIds.videoSource, pin: "io62" } },
            scl: { from: { node: hdmiTxSliceIds.videoSource, pin: "io63" } }
          }
        },
        { op: "setEdgeParams", edge: connection.id, value: { speed: "400kHz" } },
        { op: "setEdgeStrategy", edge: connection.id, value: { pinAssignment: "manual" } },
        {
          op: "setBoardPlacement",
          object: hdmiTxSliceIds.tx,
          value: { x: "12mm", y: "13mm", rotation: "90deg" }
        }
      ]
    });

    const next = document.source;
    const nextConnection = next.edges.find((edge) => edge.id === connection.id);
    const functionNode = next.nodes.find((node) => node.id === hdmiTxSliceIds.hdmiFunction);

    expect(functionNode?.kind === "intent.function" ? functionNode.include?.cec : undefined).toBe(true);
    expect(nextConnection).toMatchObject({
      bindings: {
        sda: { from: { pin: "io62" } },
        scl: { from: { pin: "io63" } }
      },
      params: { speed: "400kHz" },
      strategy: { pinAssignment: "manual" }
    });
    expect(next.layout?.placements[hdmiTxSliceIds.tx]).toEqual({
      x: "12mm",
      y: "13mm",
      rotation: "90deg"
    });
  });

  it("undoes and redoes node cascades with exact node, edge, and placement order", () => {
    const source = createHdmiSliceProject();
    const withPlacement = applyProjectPatch(source, {
      op: "setBoardPlacement",
      object: hdmiSliceIds.hdmiFunction,
      value: { x: "20mm", y: "15mm", rotation: "0deg" }
    }).source;
    const document = new ProjectDocument(withPlacement);
    const before = document.save();

    document.apply({ op: "removeNode", node: hdmiSliceIds.hdmiFunction });

    expect(document.source.nodes.some((node) => node.id === hdmiSliceIds.hdmiFunction)).toBe(false);
    expect(document.source.edges).toEqual([]);
    expect(document.source.layout?.placements[hdmiSliceIds.hdmiFunction]).toBeUndefined();
    expect(document.source.dependencies).toEqual(withPlacement.dependencies);

    document.undo();
    expect(document.source).toEqual(withPlacement);
    expect(document.save()).toBe(before);

    document.redo();
    expect(document.source.nodes.some((node) => node.id === hdmiSliceIds.hdmiFunction)).toBe(false);
    expect(document.canRedo).toBe(false);
  });

  it("restores an edge at its original array index", () => {
    const source = createHdmiTxSliceProject();
    const document = new ProjectDocument(source);
    const middleEdge = source.edges[1];

    if (!middleEdge) {
      throw new Error("Missing edge fixture.");
    }

    document.apply({ op: "removeEdge", edge: middleEdge.id });
    document.undo();

    expect(document.source.edges).toEqual(source.edges);
  });

  it("keeps failed batches atomic and leaves revision, history, and snapshot unchanged", () => {
    const document = new ProjectDocument(createHdmiSliceProject());
    const snapshot = document.getSnapshot();
    const patch: ProjectPatch = {
      op: "batch",
      patches: [
        { op: "addNode", node: { id: "new-node", kind: "powerDomain", voltage: "1.8V" } },
        { op: "addNode", node: { id: "new-node", kind: "powerDomain", voltage: "3.3V" } }
      ]
    };

    expect(() => document.apply(patch)).toThrowError(ProjectDocumentError);
    expect(document.getSnapshot()).toBe(snapshot);
    expect(document.revision).toBe(0);
    expect(document.appliedPatches).toEqual([]);
    expect(document.canUndo).toBe(false);
  });

  it("does not record no-ops and invalidates redo only after a new edit", () => {
    const source = createHdmiSliceProject();
    const document = new ProjectDocument(source);

    expect(
      document.apply({
        op: "setDependency",
        dependency: "@nocad/video",
        version: source.dependencies["@nocad/video"] ?? null
      })
    ).toBeNull();
    expect(document.revision).toBe(0);

    document.apply({
      op: "setFunctionInclude",
      node: hdmiSliceIds.hdmiFunction,
      feature: "cec",
      value: true
    });
    document.undo();
    expect(document.canRedo).toBe(true);

    expect(document.apply({ op: "setDependency", dependency: "missing", version: null })).toBeNull();
    expect(document.canRedo).toBe(true);

    document.apply({ op: "setDependency", dependency: "@nocad/test", version: "1.0.0" });
    expect(document.canRedo).toBe(false);
  });

  it("provides stable frozen snapshots and notifies subscribers only after changes", () => {
    const document = new ProjectDocument(createHdmiSliceProject());
    const listener = vi.fn();
    const subscribe = document.subscribe;
    const getSnapshot = document.getSnapshot;
    const unsubscribe = subscribe(listener);
    const snapshot = getSnapshot();

    expect(getSnapshot()).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes)).toBe(true);
    expect(() => snapshot.nodes.push({ id: "mutated", kind: "powerDomain", voltage: "5V" })).toThrow();

    document.apply({ op: "setDependency", dependency: "@nocad/test", version: "1.0.0" });
    expect(document.getSnapshot()).not.toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    document.undo();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("prevents caller mutation of source snapshots and applied records", () => {
    const document = new ProjectDocument(createHdmiSliceProject());
    const sourceCopy = document.source;
    sourceCopy.name = "Mutated copy";
    const record = document.apply({ op: "setDependency", dependency: "@nocad/test", version: "1.0.0" });

    if (!record) {
      throw new Error("Expected applied record.");
    }

    record.patch = { op: "removeNode", node: hdmiSliceIds.mcu };
    const records = document.appliedPatches;
    records[0]!.patch = { op: "removeNode", node: hdmiSliceIds.hdmiPort };

    expect(document.source.name).not.toBe("Mutated copy");
    expect(document.appliedPatches[0]?.patch).toEqual({
      op: "setDependency",
      dependency: "@nocad/test",
      version: "1.0.0"
    });
  });

  it("clones caller-owned nested patches before undo and redo", () => {
    const document = new ProjectDocument(createHdmiSliceProject());
    const value = { mode: "required", value: "220ohm" };
    const patch: ProjectPatch = {
      op: "setFunctionInclude",
      node: hdmiSliceIds.hdmiFunction,
      feature: "seriesTermination",
      value
    };

    document.apply(patch);
    value.mode = "off";
    value.value = "999ohm";
    document.undo();
    document.redo();

    const functionNode = document.source.nodes.find((node) => node.id === hdmiSliceIds.hdmiFunction);
    expect(functionNode?.kind === "intent.function" ? functionNode.include?.seriesTermination : undefined).toEqual({
      mode: "required",
      value: "220ohm"
    });
    expect(document.appliedPatches[0]?.patch).toMatchObject({
      value: { mode: "required", value: "220ohm" }
    });
  });

  it("rejects stale resolver-derived patches without changing history", () => {
    const document = new ProjectDocument(createHdmiSliceProject());
    document.apply({ op: "setDependency", dependency: "@nocad/test", version: "1.0.0" });
    const snapshot = document.getSnapshot();

    expectDocumentError(
      () =>
        document.apply(
          { op: "setDependency", dependency: "@nocad/stale", version: "1.0.0" },
          { expectedRevision: 0 }
        ),
      "DOCUMENT_REVISION_STALE"
    );
    expect(document.getSnapshot()).toBe(snapshot);
    expect(document.appliedPatches).toHaveLength(1);
  });

  it("restores absent include and layout containers exactly", () => {
    const source = createHdmiSliceProject();
    const withoutContainers: ProjectSource = {
      ...source,
      layout: undefined,
      nodes: source.nodes.map((node) =>
        node.id === hdmiSliceIds.hdmiFunction && node.kind === "intent.function"
          ? (({ include: _include, ...rest }) => rest)(node)
          : node
      )
    };
    const { layout: _layout, ...sourceWithoutLayout } = withoutContainers;
    const document = new ProjectDocument(sourceWithoutLayout);

    document.apply({
      op: "setFunctionInclude",
      node: hdmiSliceIds.hdmiFunction,
      feature: "cec",
      value: true
    });
    document.undo();
    expect(document.source).toEqual(sourceWithoutLayout);

    document.apply({
      op: "setBoardPlacement",
      object: hdmiSliceIds.mcu,
      value: { x: "1mm", y: "2mm", rotation: "0deg" }
    });
    document.undo();
    expect(document.source).toEqual(sourceWithoutLayout);
    expect(Object.hasOwn(document.source, "layout")).toBe(false);
  });

  it("restores every function include container shape and serialized key order exactly", () => {
    const base = createHdmiSliceProject();
    const functionNode = base.nodes.find((node) => node.id === hdmiSliceIds.hdmiFunction);

    if (!functionNode || functionNode.kind !== "intent.function") {
      throw new Error("Missing HDMI function fixture.");
    }

    const includeVariants: Array<Record<string, unknown> | null> = [
      null,
      {},
      { unrelated: "keep" },
      { cec: false, unrelated: "keep" }
    ];

    for (const include of includeVariants) {
      const { include: _include, ...withoutInclude } = functionNode;
      const node = include === null ? withoutInclude : { ...withoutInclude, include };
      const source = {
        ...base,
        nodes: base.nodes.map((candidate) => (candidate.id === functionNode.id ? node : candidate))
      };
      const document = new ProjectDocument(source);
      const before = document.save();

      document.apply({
        op: "setFunctionInclude",
        node: functionNode.id,
        feature: "cec",
        value: true
      });
      document.undo();

      expect(document.save()).toBe(before);
      expect(document.source).toEqual(source);
    }

    const document = new ProjectDocument(base);
    const before = document.save();
    document.apply({ op: "unsetFunctionInclude", node: functionNode.id, feature: "cec" });
    document.undo();
    expect(document.save()).toBe(before);
  });

  it("restores dependencies and edge fields byte-for-byte after undo", () => {
    const source = createHdmiTxSliceProject();
    const document = new ProjectDocument(source);
    const before = document.save();
    const firstDependency = Object.keys(source.dependencies)[0];

    if (!firstDependency) {
      throw new Error("Missing dependency fixture.");
    }

    document.apply({ op: "setDependency", dependency: firstDependency, version: null });
    document.undo();
    expect(document.save()).toBe(before);

    document.apply({ op: "setEdgeStrategy", edge: hdmiTxSliceIds.ctrlConnection, value: null });
    document.undo();
    expect(document.save()).toBe(before);
  });

  it("preserves touched node and edge future keys through patch and undo", () => {
    const source = createHdmiTxSliceProject() as ProjectSource & { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
    const functionIndex = source.nodes.findIndex((node) => node.id === hdmiTxSliceIds.hdmiFunction);
    const edgeIndex = source.edges.findIndex((edge) => edge.id === hdmiTxSliceIds.ctrlConnection);
    source.nodes[functionIndex] = {
      ...source.nodes[functionIndex],
      futureNode: { nested: ["preserved"] }
    };
    source.edges[edgeIndex] = {
      ...source.edges[edgeIndex],
      futureEdge: { nested: ["preserved"] }
    };
    const document = new ProjectDocument(source as ProjectSource);
    const before = document.save();

    document.apply({
      op: "batch",
      patches: [
        {
          op: "setFunctionInclude",
          node: hdmiTxSliceIds.hdmiFunction,
          feature: "cec",
          value: true
        },
        {
          op: "setEdgeStrategy",
          edge: hdmiTxSliceIds.ctrlConnection,
          value: { pinAssignment: "manual" }
        }
      ]
    });
    document.undo();

    expect(document.save()).toBe(before);
    expect((document.source.nodes[functionIndex] as ProjectSource["nodes"][number] & { futureNode?: unknown }).futureNode).toEqual({
      nested: ["preserved"]
    });
    expect((document.source.edges[edgeIndex] as ProjectSource["edges"][number] & { futureEdge?: unknown }).futureEdge).toEqual({
      nested: ["preserved"]
    });
  });

  it("rejects malformed and internal public patches without changing the document", () => {
    const document = new ProjectDocument(createHdmiSliceProject());
    const snapshot = document.getSnapshot();
    const invalidPatches = [
      { op: "restoreLayout", value: null },
      { op: "unknown", object: hdmiSliceIds.mcu, value: { x: "1mm" } },
      { op: "setEdgeParams", edge: hdmiSliceIds.videoProvider, value: "invalid" }
    ];

    for (const patch of invalidPatches) {
      expectDocumentError(
        () => document.apply(patch as unknown as ProjectPatch),
        patch.op === "setEdgeParams" ? "PROJECT_EDGE_INVALID" : "PATCH_OP_UNSUPPORTED"
      );
    }

    expect(document.getSnapshot()).toBe(snapshot);
    expect(document.revision).toBe(0);
    expect(document.appliedPatches).toEqual([]);
  });

  it("replaces the document with clean history and a new stable snapshot", () => {
    const document = new ProjectDocument(createHdmiSliceProject());
    const listener = vi.fn();
    document.subscribe(listener);
    document.apply({ op: "setDependency", dependency: "@nocad/test", version: "1.0.0" });
    const revision = document.revision;
    const replacement = createHdmiTxSliceProject();

    document.replace(replacement, { expectedRevision: revision });

    expect(document.source).toEqual(replacement);
    expect(document.appliedPatches).toEqual([]);
    expect(document.canUndo).toBe(false);
    expect(document.canRedo).toBe(false);
    expect(document.revision).toBe(revision + 1);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("project source persistence and validation", () => {
  it("round-trips every JSON field losslessly and loads with clean history", () => {
    const source = createHdmiSliceProject() as ProjectSource & { future?: unknown };
    source.future = {
      nested: [1, true, null, { extension: "preserved" }]
    };
    const json = serializeProjectSource(source);
    const parsed = parseProjectSourceJson(json) as ProjectSource & { future?: unknown };
    const document = ProjectDocument.load(json);

    expect(parsed).toEqual(source);
    expect(document.source).toEqual(source);
    expect(document.save()).toBe(json);
    expect(document.revision).toBe(0);
    expect(document.appliedPatches).toEqual([]);
  });

  it("rejects invalid JSON, schemas, duplicate IDs, and missing edge nodes", () => {
    expectDocumentError(() => parseProjectSourceJson("{"), "PROJECT_JSON_INVALID");
    expectDocumentError(
      () => parseProjectSourceJson(JSON.stringify({ ...createHdmiSliceProject(), schema: "future.v1" })),
      "PROJECT_SCHEMA_UNSUPPORTED"
    );

    const source = createHdmiSliceProject();
    expectDocumentError(
      () => validateProjectSource({ ...source, nodes: [...source.nodes, source.nodes[0]] }),
      "DUPLICATE_NODE_ID"
    );
    expectDocumentError(
      () =>
        validateProjectSource({
          ...source,
          edges: source.edges.map((edge, index) =>
            index === 0 && edge.kind !== "net.binding"
              ? { ...edge, from: { ...edge.from, node: "missing" } }
              : edge
          )
        }),
      "EDGE_NODE_NOT_FOUND"
    );

    expectDocumentError(
      () =>
        validateProjectSource({
          ...source,
          nodes: source.nodes.map((node) =>
            node.id === hdmiSliceIds.hdmiFunction ? { ...node, include: "invalid" } : node
          )
        }),
      "PROJECT_NODE_INVALID"
    );
    expectDocumentError(
      () =>
        validateProjectSource({
          ...source,
          edges: source.edges.map((edge) =>
            edge.id === hdmiSliceIds.videoProvider ? { ...edge, strategy: { pinAssignment: "sometimes" } } : edge
          )
        }),
      "PROJECT_EDGE_INVALID"
    );
    expectDocumentError(
      () =>
        validateProjectSource({
          ...source,
          edges: source.edges.map((edge) =>
            edge.id === hdmiSliceIds.videoProvider
              ? {
                  ...edge,
                  bindings: { hpd: { from: { node: "missing", pin: "gpio0" } } }
                }
              : edge
          )
        }),
      "EDGE_NODE_NOT_FOUND"
    );
  });

  it("rejects every non-lossless JSON value at source and patch ingress", () => {
    const source = createHdmiSliceProject();
    const lossyValues: unknown[] = [undefined, Number.NaN, Number.POSITIVE_INFINITY, -0, 1n, () => true, Symbol("value")];

    for (const value of lossyValues) {
      expectDocumentError(
        () => validateProjectSource({ ...source, future: value }),
        "PROJECT_JSON_LOSSY"
      );
    }

    const circular = { name: "cycle" } as { name: string; self?: unknown };
    circular.self = circular;
    expectDocumentError(() => validateProjectSource({ ...source, future: circular }), "PROJECT_JSON_LOSSY");

    const symbolKeyed = { ...source } as ProjectSource & Record<PropertyKey, unknown>;
    symbolKeyed[Symbol("hidden")] = "lost";
    expectDocumentError(() => validateProjectSource(symbolKeyed), "PROJECT_JSON_LOSSY");

    const sparse = Array.from({ length: 2 }, (_, index) => index);
    delete sparse[0];
    expectDocumentError(() => validateProjectSource({ ...source, future: sparse }), "PROJECT_JSON_LOSSY");

    const noncanonicalArray = ["kept"] as string[] & Record<string, unknown>;
    noncanonicalArray["01"] = "lost";
    expectDocumentError(
      () => validateProjectSource({ ...source, future: noncanonicalArray }),
      "PROJECT_JSON_LOSSY"
    );

    const hidden = { visible: true };
    Object.defineProperty(hidden, "secret", { value: true, enumerable: false });
    expectDocumentError(() => validateProjectSource({ ...source, future: hidden }), "PROJECT_JSON_LOSSY");

    const accessor = {
      get changing() {
        return Math.random();
      }
    };
    expectDocumentError(() => validateProjectSource({ ...source, future: accessor }), "PROJECT_JSON_LOSSY");

    const document = new ProjectDocument(source);
    expectDocumentError(
      () =>
        document.apply({
          op: "setFunctionInclude",
          node: hdmiSliceIds.hdmiFunction,
          feature: "invalid",
          value: undefined
        }),
      "PROJECT_JSON_LOSSY"
    );
    expect(document.revision).toBe(0);
  });
});

function expectDocumentError(action: () => unknown, code: string) {
  try {
    action();
    throw new Error(`Expected ProjectDocumentError ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectDocumentError);
    expect(error).toMatchObject({ code });
  }
}
