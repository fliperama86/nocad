import type {
  ContractParams,
  IntentConnectionEdge,
  IntentProvidesEdge,
  IntentStrategy,
  ProjectEdge,
  ProjectNode,
  ProjectSource,
  SignalBindings
} from "./types";

export type ProjectPatch =
  | { op: "batch"; patches: ProjectPatch[] }
  | { op: "addNode"; node: ProjectNode }
  | { op: "removeNode"; node: string }
  | { op: "addEdge"; edge: ProjectEdge }
  | { op: "removeEdge"; edge: string }
  | { op: "setDependency"; dependency: string; version: string | null }
  | { op: "setFunctionInclude"; node: string; feature: string; value: unknown }
  | { op: "unsetFunctionInclude"; node: string; feature: string }
  | { op: "setEdgeBindings"; edge: string; value: SignalBindings | null }
  | { op: "setEdgeParams"; edge: string; value: ContractParams | null }
  | { op: "setEdgeStrategy"; edge: string; value: IntentStrategy | null }
  | { op: "setBoardPlacement"; object: string; value: unknown | null };

export type ProjectInversePatch =
  | ProjectPatch
  | { op: "restoreBatch"; patches: ProjectInversePatch[] }
  | { op: "restoreNode"; node: ProjectNode; index: number }
  | { op: "restoreEdge"; edge: ProjectEdge; index: number }
  | { op: "restoreNodeValue"; node: ProjectNode; index: number }
  | { op: "restoreEdgeValue"; edge: ProjectEdge; index: number }
  | { op: "restoreDependencies"; value: Record<string, string> }
  | { op: "restoreLayout"; value: ProjectSource["layout"] | null };

export type AppliedPatchRecord = {
  action: "apply" | "redo" | "undo";
  inverse: ProjectInversePatch;
  patch: ProjectInversePatch;
  revision: number;
};

type PatchTransaction = {
  inverse: ProjectInversePatch;
  patch: ProjectPatch;
};

export type ProjectDocumentMutationOptions = {
  expectedRevision?: number;
};

export class ProjectDocumentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectDocumentError";
    this.code = code;
  }
}

export class ProjectDocument {
  #history: AppliedPatchRecord[] = [];
  #listeners = new Set<() => void>();
  #redoStack: PatchTransaction[] = [];
  #revision = 0;
  #source: ProjectSource;
  #undoStack: PatchTransaction[] = [];

  constructor(source: ProjectSource) {
    validateProjectSource(source);
    this.#source = immutableSnapshot(source);
  }

  static load(json: string) {
    return new ProjectDocument(parseProjectSourceJson(json));
  }

  get appliedPatches(): AppliedPatchRecord[] {
    return cloneValue(this.#history);
  }

  get canRedo() {
    return this.#redoStack.length > 0;
  }

  get canUndo() {
    return this.#undoStack.length > 0;
  }

  get revision() {
    return this.#revision;
  }

  get source(): ProjectSource {
    return cloneValue(this.#source);
  }

  apply(patch: ProjectPatch, options: ProjectDocumentMutationOptions = {}): AppliedPatchRecord | null {
    this.#assertExpectedRevision(options.expectedRevision);
    const transaction = applyProjectPatch(this.#source, patch);

    if (sourcesEqual(this.#source, transaction.source)) {
      return null;
    }

    this.#source = immutableSnapshot(transaction.source);
    this.#undoStack.push({ patch: cloneValue(patch), inverse: cloneValue(transaction.inverse) });
    this.#redoStack = [];
    const record = this.#record("apply", patch, transaction.inverse);
    this.#notify();
    return record;
  }

  getSnapshot = (): ProjectSource => {
    return this.#source;
  };

  redo(): AppliedPatchRecord | null {
    const transaction = this.#redoStack.pop();

    if (!transaction) {
      return null;
    }

    const reapplied = applyProjectPatch(this.#source, transaction.patch);
    this.#source = immutableSnapshot(reapplied.source);
    this.#undoStack.push({ patch: cloneValue(transaction.patch), inverse: cloneValue(reapplied.inverse) });
    const record = this.#record("redo", transaction.patch, reapplied.inverse);
    this.#notify();
    return record;
  }

  replace(source: ProjectSource, options: ProjectDocumentMutationOptions = {}) {
    this.#assertExpectedRevision(options.expectedRevision);
    validateProjectSource(source);
    this.#source = immutableSnapshot(source);
    this.#undoStack = [];
    this.#redoStack = [];
    this.#history = [];
    this.#revision += 1;
    this.#notify();
  }

  save(): string {
    return serializeProjectSource(this.#source);
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  undo(): AppliedPatchRecord | null {
    const transaction = this.#undoStack.pop();

    if (!transaction) {
      return null;
    }

    const reverted = applyExecutableProjectPatch(this.#source, transaction.inverse);
    this.#source = immutableSnapshot(reverted.source);
    this.#redoStack.push(transaction);
    const record = this.#record("undo", transaction.inverse, transaction.patch);
    this.#notify();
    return record;
  }

  #assertExpectedRevision(expectedRevision: number | undefined) {
    if (expectedRevision !== undefined && expectedRevision !== this.#revision) {
      throw new ProjectDocumentError(
        "DOCUMENT_REVISION_STALE",
        `Expected document revision ${expectedRevision}, current revision is ${this.#revision}.`
      );
    }
  }

  #notify() {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #record(action: AppliedPatchRecord["action"], patch: ProjectInversePatch, inverse: ProjectInversePatch) {
    this.#revision += 1;

    const record: AppliedPatchRecord = {
      action,
      inverse: cloneValue(inverse),
      patch: cloneValue(patch),
      revision: this.#revision
    };

    this.#history.push(record);
    return cloneValue(record);
  }
}

export function applyProjectPatch(
  source: ProjectSource,
  patch: ProjectPatch
): { inverse: ProjectInversePatch; source: ProjectSource } {
  validateProjectPatch(patch);
  return applyExecutableProjectPatch(source, patch);
}

function applyExecutableProjectPatch(
  source: ProjectSource,
  patch: ProjectInversePatch
): { inverse: ProjectInversePatch; source: ProjectSource } {
  validateProjectSource(source);
  assertJsonValue(patch, "patch");

  const applied = applyPatchUnchecked(cloneValue(source), cloneValue(patch));
  validateProjectSource(applied.source);

  return {
    inverse: cloneValue(applied.inverse),
    source: cloneValue(applied.source)
  };
}

export function parseProjectSourceJson(json: string): ProjectSource {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown JSON parse error.";
    throw new ProjectDocumentError("PROJECT_JSON_INVALID", `Project JSON could not be parsed: ${detail}`);
  }

  validateProjectSource(value);
  return cloneValue(value);
}

export function serializeProjectSource(source: ProjectSource): string {
  validateProjectSource(source);
  return `${JSON.stringify(source, null, 2)}\n`;
}

export function validateProjectSource(value: unknown): asserts value is ProjectSource {
  assertJsonValue(value, "project");
  assertRecord(value, "PROJECT_INVALID", "Project source must be an object.");

  if (value.schema !== "nocad.project.v0") {
    throw new ProjectDocumentError("PROJECT_SCHEMA_UNSUPPORTED", "Project schema must be nocad.project.v0.");
  }

  assertNonEmptyString(value.id, "PROJECT_ID_INVALID", "Project id must be a non-empty string.");
  assertNonEmptyString(value.name, "PROJECT_NAME_INVALID", "Project name must be a non-empty string.");
  assertRecord(value.dependencies, "PROJECT_DEPENDENCIES_INVALID", "Project dependencies must be an object.");

  for (const [dependency, version] of Object.entries(value.dependencies)) {
    assertNonEmptyString(dependency, "PROJECT_DEPENDENCY_INVALID", "Dependency names must be non-empty strings.");
    assertNonEmptyString(version, "PROJECT_DEPENDENCY_INVALID", `Dependency "${dependency}" must have a version.`);
  }

  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new ProjectDocumentError("PROJECT_GRAPH_INVALID", "Project nodes and edges must be arrays.");
  }

  const nodeIds = new Set<string>();

  for (const node of value.nodes) {
    validateProjectNode(node);

    if (nodeIds.has(node.id)) {
      throw new ProjectDocumentError("DUPLICATE_NODE_ID", `Node id "${node.id}" is used more than once.`);
    }

    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();

  for (const edge of value.edges) {
    validateProjectEdge(edge);

    if (edgeIds.has(edge.id)) {
      throw new ProjectDocumentError("DUPLICATE_EDGE_ID", `Edge id "${edge.id}" is used more than once.`);
    }

    edgeIds.add(edge.id);

    for (const referencedNode of edgeNodeReferences(edge)) {
      if (!nodeIds.has(referencedNode)) {
        throw new ProjectDocumentError(
          "EDGE_NODE_NOT_FOUND",
          `Edge "${edge.id}" references missing node "${referencedNode}".`
        );
      }
    }
  }

  if (value.board !== undefined) {
    assertRecord(value.board, "PROJECT_BOARD_INVALID", "Project board must be an object.");
    assertNonEmptyString(value.board.id, "PROJECT_BOARD_INVALID", "Project board id must be a string.");

    if (typeof value.board.layers !== "number" || !Number.isInteger(value.board.layers) || value.board.layers < 1) {
      throw new ProjectDocumentError("PROJECT_BOARD_INVALID", "Project board layers must be a positive integer.");
    }

    assertRecord(value.board.size, "PROJECT_BOARD_INVALID", "Project board size must be an object.");
    assertNonEmptyString(value.board.size.width, "PROJECT_BOARD_INVALID", "Project board width must be a string.");
    assertNonEmptyString(value.board.size.height, "PROJECT_BOARD_INVALID", "Project board height must be a string.");
  }

  if (value.layout !== undefined) {
    assertRecord(value.layout, "PROJECT_LAYOUT_INVALID", "Project layout must be an object.");
    assertNonEmptyString(value.layout.board, "PROJECT_LAYOUT_INVALID", "Project layout board must be a string.");
    assertRecord(value.layout.placements, "PROJECT_LAYOUT_INVALID", "Project placements must be an object.");

    if (!Array.isArray(value.layout.routingIntent)) {
      throw new ProjectDocumentError("PROJECT_LAYOUT_INVALID", "Project routing intent must be an array.");
    }
  }
}

function applyPatchUnchecked(
  source: ProjectSource,
  patch: ProjectInversePatch
): { inverse: ProjectInversePatch; source: ProjectSource } {
  if (patch.op === "batch" || patch.op === "restoreBatch") {
    let current = source;
    const inverses: ProjectInversePatch[] = [];

    for (const child of patch.patches) {
      const applied = applyPatchUnchecked(current, child);
      current = applied.source;
      inverses.unshift(applied.inverse);
    }

    return { source: current, inverse: { op: "restoreBatch", patches: inverses } };
  }

  if (patch.op === "addNode" || patch.op === "restoreNode") {
    if (source.nodes.some((node) => node.id === patch.node.id)) {
      throw new ProjectDocumentError("DUPLICATE_NODE_ID", `Node id "${patch.node.id}" already exists.`);
    }

    const index = patch.op === "restoreNode" ? insertionIndex(patch.index, source.nodes.length, "node") : source.nodes.length;
    const nodes = [...source.nodes];
    nodes.splice(index, 0, cloneValue(patch.node));
    const removePatch: ProjectPatch = { op: "removeNode", node: patch.node.id };
    const inverse: ProjectInversePatch = source.layout
      ? {
          op: "restoreBatch",
          patches: [removePatch, { op: "restoreLayout", value: cloneValue(source.layout) }]
        }
      : removePatch;

    return { source: { ...source, nodes }, inverse };
  }

  if (patch.op === "removeNode") {
    const index = source.nodes.findIndex((node) => node.id === patch.node);

    if (index < 0) {
      throw new ProjectDocumentError("NODE_NOT_FOUND", `Node "${patch.node}" does not exist.`);
    }

    const node = source.nodes[index];

    if (!node) {
      throw new ProjectDocumentError("NODE_NOT_FOUND", `Node "${patch.node}" does not exist.`);
    }

    const incidentEdges = source.edges.flatMap((edge, edgeIndex) =>
      edgeNodeReferences(edge).includes(patch.node) ? [{ edge, index: edgeIndex }] : []
    );
    const nodes = source.nodes.filter((candidate) => candidate.id !== patch.node);
    const edges = source.edges.filter((edge) => !edgeNodeReferences(edge).includes(patch.node));
    const nextSource = removePlacement({ ...source, nodes, edges }, patch.node);
    const inversePatches: ProjectInversePatch[] = [
      { op: "restoreNode", node: cloneValue(node), index },
      ...incidentEdges.map(({ edge, index: edgeIndex }) => ({
        op: "restoreEdge" as const,
        edge: cloneValue(edge),
        index: edgeIndex
      }))
    ];

    if (source.layout !== undefined) {
      inversePatches.push({ op: "restoreLayout", value: cloneValue(source.layout ?? null) });
    }

    return { source: nextSource, inverse: { op: "restoreBatch", patches: inversePatches } };
  }

  if (patch.op === "restoreNodeValue") {
    const current = source.nodes[patch.index];

    if (!current || current.id !== patch.node.id) {
      throw new ProjectDocumentError("NODE_NOT_FOUND", `Node "${patch.node.id}" is not at its inverse index.`);
    }

    const nodes = [...source.nodes];
    nodes[patch.index] = cloneValue(patch.node);

    return {
      source: { ...source, nodes },
      inverse: { op: "restoreNodeValue", node: cloneValue(current), index: patch.index }
    };
  }

  if (patch.op === "addEdge" || patch.op === "restoreEdge") {
    if (source.edges.some((edge) => edge.id === patch.edge.id)) {
      throw new ProjectDocumentError("DUPLICATE_EDGE_ID", `Edge id "${patch.edge.id}" already exists.`);
    }

    const index = patch.op === "restoreEdge" ? insertionIndex(patch.index, source.edges.length, "edge") : source.edges.length;
    const edges = [...source.edges];
    edges.splice(index, 0, cloneValue(patch.edge));
    return { source: { ...source, edges }, inverse: { op: "removeEdge", edge: patch.edge.id } };
  }

  if (patch.op === "removeEdge") {
    const index = source.edges.findIndex((edge) => edge.id === patch.edge);
    const edge = source.edges[index];

    if (index < 0 || !edge) {
      throw new ProjectDocumentError("EDGE_NOT_FOUND", `Edge "${patch.edge}" does not exist.`);
    }

    return {
      source: { ...source, edges: source.edges.filter((candidate) => candidate.id !== patch.edge) },
      inverse: { op: "restoreEdge", edge: cloneValue(edge), index }
    };
  }

  if (patch.op === "restoreEdgeValue") {
    const current = source.edges[patch.index];

    if (!current || current.id !== patch.edge.id) {
      throw new ProjectDocumentError("EDGE_NOT_FOUND", `Edge "${patch.edge.id}" is not at its inverse index.`);
    }

    const edges = [...source.edges];
    edges[patch.index] = cloneValue(patch.edge);

    return {
      source: { ...source, edges },
      inverse: { op: "restoreEdgeValue", edge: cloneValue(current), index: patch.index }
    };
  }

  if (patch.op === "setDependency") {
    const previous = cloneValue(source.dependencies);
    const dependencies = { ...source.dependencies };

    if (patch.version === null) {
      delete dependencies[patch.dependency];
    } else {
      dependencies[patch.dependency] = patch.version;
    }

    return {
      source: { ...source, dependencies },
      inverse: { op: "restoreDependencies", value: previous }
    };
  }

  if (patch.op === "restoreDependencies") {
    const previous = cloneValue(source.dependencies);

    return {
      source: { ...source, dependencies: cloneValue(patch.value) },
      inverse: { op: "restoreDependencies", value: previous }
    };
  }

  if (patch.op === "setFunctionInclude" || patch.op === "unsetFunctionInclude") {
    const index = source.nodes.findIndex((node) => node.id === patch.node);
    const node = source.nodes[index];

    if (!node || node.kind !== "intent.function") {
      throw new ProjectDocumentError("FUNCTION_NODE_NOT_FOUND", `Function node "${patch.node}" does not exist.`);
    }

    const previousNode = cloneValue(node);
    const include = { ...(node.include ?? {}) };

    if (patch.op === "unsetFunctionInclude") {
      delete include[patch.feature];
    } else {
      include[patch.feature] = cloneValue(patch.value);
    }

    const { include: _include, ...nodeWithoutInclude } = node;
    const nextNode = Object.keys(include).length > 0 ? { ...node, include } : nodeWithoutInclude;
    const nodes = [...source.nodes];
    nodes[index] = nextNode;

    return {
      source: { ...source, nodes },
      inverse: { op: "restoreNodeValue", node: previousNode, index }
    };
  }

  if (patch.op === "setEdgeBindings") {
    return replaceEdgeField(source, patch.edge, "bindings", patch.value);
  }

  if (patch.op === "setEdgeParams") {
    const edge = requireEdge(source, patch.edge);

    if (edge.kind !== "intent.connection") {
      throw new ProjectDocumentError("EDGE_KIND_INVALID", `Edge "${patch.edge}" does not support params.`);
    }

    return replaceEdgeField(source, patch.edge, "params", patch.value);
  }

  if (patch.op === "setEdgeStrategy") {
    return replaceEdgeField(source, patch.edge, "strategy", patch.value);
  }

  if (patch.op === "restoreLayout") {
    const previous = cloneValue(source.layout ?? null);
    const nextSource = replaceLayout(source, patch.value);

    return {
      source: nextSource,
      inverse: { op: "restoreLayout", value: previous }
    };
  }

  const previousLayout = cloneValue(source.layout ?? null);
  const nextSource =
    patch.value === null
      ? removePlacement(source, patch.object)
      : setPlacement(source, patch.object, cloneValue(patch.value));

  return {
    source: nextSource,
    inverse: { op: "restoreLayout", value: previousLayout }
  };
}

function replaceEdgeField(
  source: ProjectSource,
  edgeId: string,
  field: "bindings" | "params" | "strategy",
  value: ContractParams | IntentStrategy | SignalBindings | null
): { inverse: ProjectInversePatch; source: ProjectSource } {
  const edge = requireEdge(source, edgeId);
  const edgeIndex = source.edges.findIndex((candidate) => candidate.id === edgeId);

  if (field === "bindings" && edge.kind !== "intent.connection" && edge.kind !== "intent.provides") {
    throw new ProjectDocumentError("EDGE_KIND_INVALID", `Edge "${edgeId}" does not support bindings.`);
  }

  if (field === "strategy" && edge.kind !== "intent.connection" && edge.kind !== "intent.provides") {
    throw new ProjectDocumentError("EDGE_KIND_INVALID", `Edge "${edgeId}" does not support strategy.`);
  }

  const previous = cloneValue(edge);
  const nextEdge = { ...edge } as IntentConnectionEdge | IntentProvidesEdge;
  const mutableEdge = nextEdge as unknown as Record<string, unknown>;

  if (value === null) {
    delete mutableEdge[field];
  } else {
    mutableEdge[field] = cloneValue(value);
  }

  const edges = source.edges.map((candidate) => (candidate.id === edgeId ? nextEdge : candidate));
  return {
    source: { ...source, edges },
    inverse: { op: "restoreEdgeValue", edge: previous, index: edgeIndex }
  };
}

function requireEdge(source: ProjectSource, edgeId: string) {
  const edge = source.edges.find((candidate) => candidate.id === edgeId);

  if (!edge) {
    throw new ProjectDocumentError("EDGE_NOT_FOUND", `Edge "${edgeId}" does not exist.`);
  }

  return edge;
}

function setPlacement(source: ProjectSource, object: string, value: unknown): ProjectSource {
  return {
    ...source,
    layout: {
      ...(source.layout ?? {}),
      board: source.layout?.board ?? source.board?.id ?? "main_board",
      placements: {
        ...(source.layout?.placements ?? {}),
        [object]: value
      },
      routingIntent: source.layout?.routingIntent ?? []
    }
  };
}

function removePlacement(source: ProjectSource, object: string): ProjectSource {
  if (!source.layout || !Object.hasOwn(source.layout.placements, object)) {
    return source;
  }

  const placements = { ...source.layout.placements };
  delete placements[object];

  return {
    ...source,
    layout: {
      ...source.layout,
      placements
    }
  };
}

function replaceLayout(source: ProjectSource, layout: ProjectSource["layout"] | null): ProjectSource {
  if (layout !== null) {
    return { ...source, layout: cloneValue(layout) };
  }

  const { layout: _layout, ...sourceWithoutLayout } = source;
  return sourceWithoutLayout;
}

function insertionIndex(index: number | undefined, length: number, object: "edge" | "node") {
  if (index === undefined) {
    return length;
  }

  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new ProjectDocumentError("PATCH_INDEX_INVALID", `The ${object} insertion index is invalid.`);
  }

  return index;
}

function validateProjectPatch(value: unknown): asserts value is ProjectPatch {
  assertJsonValue(value, "patch");
  assertRecord(value, "PATCH_INVALID", "Project patch must be an object.");
  assertNonEmptyString(value.op, "PATCH_INVALID", "Project patch op must be a string.");

  if (value.op === "batch") {
    if (!Array.isArray(value.patches)) {
      throw new ProjectDocumentError("PATCH_INVALID", "Batch patches must be an array.");
    }
    value.patches.forEach(validateProjectPatch);
    return;
  }

  if (value.op === "addNode") {
    validateProjectNode(value.node);
    return;
  }

  if (value.op === "removeNode") {
    assertNonEmptyString(value.node, "PATCH_INVALID", "removeNode requires a stable node id.");
    return;
  }

  if (value.op === "addEdge") {
    validateProjectEdge(value.edge);
    return;
  }

  if (value.op === "removeEdge") {
    assertNonEmptyString(value.edge, "PATCH_INVALID", "removeEdge requires a stable edge id.");
    return;
  }

  if (value.op === "setDependency") {
    assertNonEmptyString(value.dependency, "PATCH_INVALID", "setDependency requires a dependency name.");
    if (value.version !== null) {
      assertNonEmptyString(value.version, "PATCH_INVALID", "Dependency version must be a string or null.");
    }
    return;
  }

  if (value.op === "setFunctionInclude") {
    assertNonEmptyString(value.node, "PATCH_INVALID", "setFunctionInclude requires a stable node id.");
    assertNonEmptyString(value.feature, "PATCH_INVALID", "setFunctionInclude requires a feature id.");
    if (!Object.hasOwn(value, "value")) {
      throw new ProjectDocumentError("PATCH_INVALID", "setFunctionInclude requires a value.");
    }
    return;
  }

  if (value.op === "unsetFunctionInclude") {
    assertNonEmptyString(value.node, "PATCH_INVALID", "unsetFunctionInclude requires a stable node id.");
    assertNonEmptyString(value.feature, "PATCH_INVALID", "unsetFunctionInclude requires a feature id.");
    return;
  }

  if (value.op === "setEdgeBindings") {
    assertNonEmptyString(value.edge, "PATCH_INVALID", "setEdgeBindings requires a stable edge id.");
    if (value.value !== null) {
      assertRecord(value.value, "PATCH_INVALID", "Edge bindings must be an object or null.");
      validateSignalBindings(value.value, value.edge);
    }
    return;
  }

  if (value.op === "setEdgeParams") {
    assertNonEmptyString(value.edge, "PATCH_INVALID", "setEdgeParams requires a stable edge id.");
    if (value.value !== null) {
      validateContractParams(value.value, `Patch for edge "${value.edge}"`);
    }
    return;
  }

  if (value.op === "setEdgeStrategy") {
    assertNonEmptyString(value.edge, "PATCH_INVALID", "setEdgeStrategy requires a stable edge id.");
    if (value.value !== null) {
      validateIntentStrategy(value.value, `Patch for edge "${value.edge}"`);
    }
    return;
  }

  if (value.op === "setBoardPlacement") {
    assertNonEmptyString(value.object, "PATCH_INVALID", "setBoardPlacement requires a stable object id.");
    if (!Object.hasOwn(value, "value")) {
      throw new ProjectDocumentError("PATCH_INVALID", "setBoardPlacement requires a value or null.");
    }
    return;
  }

  throw new ProjectDocumentError("PATCH_OP_UNSUPPORTED", `Unsupported public patch op "${value.op}".`);
}

function validateProjectNode(value: unknown): asserts value is ProjectNode {
  assertRecord(value, "PROJECT_NODE_INVALID", "Project nodes must be objects.");
  assertNonEmptyString(value.id, "PROJECT_NODE_INVALID", "Project node ids must be non-empty strings.");
  validateGraphMetadata(value, `Node "${value.id}"`);

  if (value.kind === "component") {
    assertNonEmptyString(value.component, "PROJECT_NODE_INVALID", `Component node "${value.id}" needs a component.`);
    validateOptionalString(value.package, "PROJECT_NODE_INVALID", `Component node "${value.id}" package must be a string.`);
  } else if (value.kind === "intent.function") {
    assertNonEmptyString(value.function, "PROJECT_NODE_INVALID", `Function node "${value.id}" needs a function.`);
    if (value.requirements !== undefined) {
      assertRecord(value.requirements, "PROJECT_NODE_INVALID", `Function node "${value.id}" requirements must be an object.`);
    }
    if (value.include !== undefined) {
      assertRecord(value.include, "PROJECT_NODE_INVALID", `Function node "${value.id}" include must be an object.`);
    }
  } else if (value.kind === "powerDomain") {
    assertNonEmptyString(value.voltage, "PROJECT_NODE_INVALID", `Power node "${value.id}" needs a voltage.`);
  } else {
    throw new ProjectDocumentError("PROJECT_NODE_INVALID", `Node "${value.id}" has an unsupported kind.`);
  }
}

function validateProjectEdge(value: unknown): asserts value is ProjectEdge {
  assertRecord(value, "PROJECT_EDGE_INVALID", "Project edges must be objects.");
  assertNonEmptyString(value.id, "PROJECT_EDGE_INVALID", "Project edge ids must be non-empty strings.");
  validateGraphMetadata(value, `Edge "${value.id}"`);

  if (value.kind === "net.binding") {
    assertRecord(value.bindings, "PROJECT_EDGE_INVALID", `Net binding "${value.id}" needs bindings.`);
    validateSignalBindings(value.bindings, value.id);
    return;
  }

  if (value.kind !== "intent.connection" && value.kind !== "intent.provides" && value.kind !== "intent.exposes") {
    throw new ProjectDocumentError("PROJECT_EDGE_INVALID", `Edge "${value.id}" has an unsupported kind.`);
  }

  validateEndpoint(value.from, value.id, "from");
  validateEndpoint(value.to, value.id, "to");
  assertNonEmptyString(value.contract, "PROJECT_EDGE_INVALID", `Edge "${value.id}" needs a contract.`);

  if (value.bindings !== undefined) {
    assertRecord(value.bindings, "PROJECT_EDGE_INVALID", `Edge "${value.id}" bindings must be an object.`);
    validateSignalBindings(value.bindings, value.id);
  }

  if (value.params !== undefined) {
    validateContractParams(value.params, `Edge "${value.id}"`);
  }
  if (value.strategy !== undefined) {
    validateIntentStrategy(value.strategy, `Edge "${value.id}"`);
  }
  if (value.include !== undefined) {
    assertRecord(value.include, "PROJECT_EDGE_INVALID", `Edge "${value.id}" include must be an object.`);
    for (const [feature, enabled] of Object.entries(value.include)) {
      if (typeof enabled !== "boolean") {
        throw new ProjectDocumentError(
          "PROJECT_EDGE_INVALID",
          `Edge "${value.id}" include "${feature}" must be boolean.`
        );
      }
    }
  }
}

function validateGraphMetadata(value: Record<string, unknown>, object: string) {
  validateOptionalString(value.label, "PROJECT_GRAPH_METADATA_INVALID", `${object} label must be a string.`);
  validateOptionalString(value.role, "PROJECT_GRAPH_METADATA_INVALID", `${object} role must be a string.`);
  validateOptionalString(value.refdesHint, "PROJECT_GRAPH_METADATA_INVALID", `${object} refdesHint must be a string.`);
}

function validateContractParams(value: unknown, object: string): asserts value is ContractParams {
  assertRecord(value, "PROJECT_EDGE_INVALID", `${object} params must be an object.`);

  for (const [param, paramValue] of Object.entries(value)) {
    if (typeof paramValue !== "string" && typeof paramValue !== "number" && typeof paramValue !== "boolean") {
      throw new ProjectDocumentError("PROJECT_EDGE_INVALID", `${object} param "${param}" has an invalid value.`);
    }
  }
}

function validateIntentStrategy(value: unknown, object: string): asserts value is IntentStrategy {
  assertRecord(value, "PROJECT_EDGE_INVALID", `${object} strategy must be an object.`);

  if (value.pinAssignment !== undefined && value.pinAssignment !== "auto" && value.pinAssignment !== "manual") {
    throw new ProjectDocumentError("PROJECT_EDGE_INVALID", `${object} pinAssignment must be auto or manual.`);
  }

  validateOptionalString(value.providerMode, "PROJECT_EDGE_INVALID", `${object} providerMode must be a string.`);
}

function validateEndpoint(value: unknown, edgeId: string, role: "from" | "to") {
  assertRecord(value, "PROJECT_EDGE_INVALID", `Edge "${edgeId}" ${role} endpoint must be an object.`);
  assertNonEmptyString(value.node, "PROJECT_EDGE_INVALID", `Edge "${edgeId}" ${role} endpoint needs a node.`);

  if (value.pin !== undefined && typeof value.pin !== "string") {
    throw new ProjectDocumentError("PROJECT_EDGE_INVALID", `Edge "${edgeId}" ${role} pin must be a string.`);
  }

  if (value.port !== undefined && typeof value.port !== "string") {
    throw new ProjectDocumentError("PROJECT_EDGE_INVALID", `Edge "${edgeId}" ${role} port must be a string.`);
  }
}

function validateSignalBindings(bindings: Record<string, unknown>, edgeId: string) {
  for (const [signal, binding] of Object.entries(bindings)) {
    assertRecord(binding, "PROJECT_EDGE_INVALID", `Edge "${edgeId}" binding "${signal}" must be an object.`);

    for (const role of ["from", "to"] as const) {
      if (binding[role] !== undefined) {
        validateEndpoint(binding[role], edgeId, role);
      }
    }
  }
}

function edgeNodeReferences(edge: ProjectEdge): string[] {
  const bindingNodes = Object.values(
    edge.kind === "net.binding" || edge.kind === "intent.connection" || edge.kind === "intent.provides"
      ? edge.bindings ?? {}
      : {}
  ).flatMap((binding) =>
    Object.values(binding).flatMap((endpoint) => (endpoint ? [endpoint.node] : []))
  );

  return edge.kind === "net.binding" ? bindingNodes : [edge.from.node, edge.to.node, ...bindingNodes];
}

function assertJsonValue(value: unknown, path: string, ancestors = new Set<object>()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains a number JSON cannot preserve exactly.`);
    }
    return;
  }

  if (typeof value !== "object") {
    throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains a value JSON cannot preserve.`);
  }

  if (ancestors.has(value)) {
    throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains a circular reference.`);
  }

  const prototype = Object.getPrototypeOf(value);

  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains a non-JSON object.`);
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains symbol-keyed data.`);
  }

  if (
    Object.getOwnPropertyNames(value).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return Boolean(descriptor?.get || descriptor?.set);
    })
  ) {
    throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains accessor data.`);
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains a sparse array.`);
      }
    }

    const canonicalNames = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);

    if (Object.getOwnPropertyNames(value).some((key) => !canonicalNames.has(key))) {
      throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains non-index array data.`);
    }
  } else if (
    Object.getOwnPropertyNames(value).some(
      (key) => !Object.getOwnPropertyDescriptor(value, key)?.enumerable
    )
  ) {
    throw new ProjectDocumentError("PROJECT_JSON_LOSSY", `${path} contains non-enumerable data.`);
  }

  ancestors.add(value);

  for (const [key, child] of Object.entries(value)) {
    assertJsonValue(child, `${path}.${key}`, ancestors);
  }

  ancestors.delete(value);
}

function assertRecord(value: unknown, code: string, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectDocumentError(code, message);
  }
}

function assertNonEmptyString(value: unknown, code: string, message: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProjectDocumentError(code, message);
  }
}

function validateOptionalString(value: unknown, code: string, message: string) {
  if (value !== undefined && typeof value !== "string") {
    throw new ProjectDocumentError(code, message);
  }
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function immutableSnapshot(source: ProjectSource): ProjectSource {
  return deepFreeze(cloneValue(source));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return value;
}

function sourcesEqual(left: ProjectSource, right: ProjectSource) {
  return JSON.stringify(left) === JSON.stringify(right);
}
