import { createI2cSliceProject, i2cSliceIds, resolveProject } from "@nocad/intent-core";
import type {
  GraphObjectMetadata,
  IntentConnectionEdge,
  ProjectEdge,
  ProjectNode,
  ProjectSource,
  SignalBindings
} from "@nocad/intent-core";
import type { Connection, XYPosition } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";

import { BindingsPanel } from "./bindings-panel";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { EdgeAssignmentPanel } from "./edge-assignment-panel";
import { IntentGraphView } from "./intent-graph-view";
import { JsonPanel, type JsonView } from "./json-panel";
import { ResolutionPanel } from "./resolution-panel";

function createSource(conflict: boolean) {
  return createI2cSliceProject({ conflict });
}

function createBlankSource() {
  const source = createSource(false);

  return {
    ...source,
    dependencies: {},
    edges: [],
    nodes: []
  } satisfies ProjectSource;
}

type ComponentTemplate = "mcu" | "sensor" | "rail";
type WorkspaceTab = "graph" | "resolution" | "diagnostics" | "json";
type NodePositions = Record<string, XYPosition>;
type GraphIdPrefix = "edge" | "node";
type SourceDependency = {
  name: string;
  version: string;
};
type ProjectNodeTemplate = GraphObjectMetadata &
  (
  | {
      kind: "component";
      component: string;
      package?: string;
    }
  | {
      kind: "powerDomain";
      voltage: string;
    }
  );
type ComponentTemplateDefinition = {
  dependency?: SourceDependency;
  idPrefix: GraphIdPrefix;
  label: string;
  node: ProjectNodeTemplate;
};

const dependencyVersions: Record<string, string> = {
  "@nocad/rp2350": "0.1.0",
  "@nocad/sensors": "0.1.0"
};

const defaultPositions: NodePositions = {
  [i2cSliceIds.rail3v3]: { x: 460, y: 40 },
  [i2cSliceIds.mcu]: { x: 110, y: 270 },
  [i2cSliceIds.sensor]: { x: 820, y: 270 }
};

const componentTemplates: Record<ComponentTemplate, ComponentTemplateDefinition> = {
  mcu: {
    dependency: {
      name: "@nocad/rp2350",
      version: dependencyVersions["@nocad/rp2350"]
    },
    idPrefix: "node",
    label: "RP2350",
    node: {
      kind: "component",
      label: "Main MCU",
      role: "mcu",
      component: "@nocad/rp2350:RP2350A",
      package: "QFN80",
      refdesHint: "U?"
    }
  },
  rail: {
    idPrefix: "node",
    label: "3V3 rail",
    node: {
      kind: "powerDomain",
      label: "3V3 rail",
      role: "power_3v3",
      voltage: "3.3V"
    }
  },
  sensor: {
    dependency: {
      name: "@nocad/sensors",
      version: dependencyVersions["@nocad/sensors"]
    },
    idPrefix: "node",
    label: "I2C sensor",
    node: {
      kind: "component",
      label: "Temperature sensor",
      role: "temperature_sensor",
      component: "@nocad/sensors:I2C_TEMP_SENSOR",
      refdesHint: "U?"
    }
  }
};

const componentPalette = Object.entries(componentTemplates).map(([id, template]) => ({
  id,
  label: template.label
}));

const workspaceTabs: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "graph", label: "Graph" },
  { id: "resolution", label: "Resolution" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "json", label: "JSON" }
];

export function I2cSliceApp() {
  const [jsonView, setJsonView] = useState<JsonView>("source");
  const [source, setSource] = useState<ProjectSource>(createBlankSource);
  const [positions, setPositions] = useState<NodePositions>({});
  const [graphRevision, setGraphRevision] = useState(0);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("graph");

  const resolved = useMemo(() => resolveProject(source), [source]);
  const selectedChoice = selectedEdgeId
    ? (resolved.resolvedChoices.find((choice) => choice.sourceEdge === selectedEdgeId) ?? resolved.resolvedChoices[0])
    : resolved.resolvedChoices[0];
  const gpio4Reserved = source.edges.some((edge) => edge.role === "debug_gpio");
  const sourceJson = useMemo(() => JSON.stringify(source, null, 2), [source]);
  const resolvedJson = useMemo(() => JSON.stringify(resolved, null, 2), [resolved]);

  const setSelectedGraphEdge = useCallback((edgeId: string | undefined) => {
    setSelectedEdgeId((currentEdgeId) => (currentEdgeId === edgeId ? currentEdgeId : edgeId));
  }, []);

  function setConflictScenario(nextConflict: boolean) {
    setSource((current) => {
      const edgesWithoutReservation = current.edges.filter((edge) => edge.role !== "debug_gpio");
      const mcuNode = current.nodes.find((node) => node.kind === "component" && node.role === "mcu");

      if (!nextConflict || !mcuNode) {
        return {
          ...current,
          edges: edgesWithoutReservation
        };
      }

      return {
        ...current,
        edges: [
          {
            id: createGraphId("edge"),
            kind: "net.binding",
            label: "Debug GPIO reservation",
            role: "debug_gpio",
            bindings: {
              debug: {
                from: { node: mcuNode.id, pin: "gpio4" }
              }
            }
          },
          ...edgesWithoutReservation
        ]
      };
    });
  }

  function resetSample() {
    setSource(createSource(false));
    setPositions(defaultPositions);
    setSelectedEdgeId(undefined);
    setGraphRevision((revision) => revision + 1);
  }

  function clearCanvas() {
    setSource(createBlankSource());
    setPositions({});
    setSelectedEdgeId(undefined);
    setGraphRevision((revision) => revision + 1);
  }

  function addComponent(template: string) {
    if (!isComponentTemplate(template)) {
      return;
    }

    const component = componentTemplates[template];
    const id = createGraphId(component.idPrefix);

    setSource({
      ...source,
      dependencies: component.dependency
        ? {
            ...source.dependencies,
            [component.dependency.name]: component.dependency.version
          }
        : source.dependencies,
      nodes: [
        ...source.nodes,
        {
          ...component.node,
          id
        } as ProjectNode
      ]
    });
    setPositions((currentPositions) => ({
      ...currentPositions,
      [id]: currentPositions[id] ?? nextPosition(source.nodes.length)
    }));
  }

  function connectNodes(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }

    setSource((current) => {
      const edgeIds = new Set(current.edges.map((edge) => edge.id));
      const edge: IntentConnectionEdge = {
        id: uniqueId(createGraphId("edge"), edgeIds),
        kind: "intent.connection",
        label: "Sensor I2C bus",
        role: "sensor_bus",
        from: {
          node: connection.source ?? "",
          port: "i2c"
        },
        to: {
          node: connection.target ?? "",
          port: "i2c"
        },
        contract: "builtin:i2c.v1",
        strategy: {
          pinAssignment: "auto"
        },
        include: {
          pullups: true
        }
      };

      return {
        ...current,
        edges: [...current.edges, edge]
      };
    });
  }

  function removeNodes(nodeIds: string[]) {
    const nodeIdSet = new Set(nodeIds);

    setSource((current) => ({
      ...current,
      edges: current.edges.filter((edge) => !edgeReferencesAnyNode(edge, nodeIdSet)),
      dependencies: dependenciesForNodes(current.nodes.filter((node) => !nodeIdSet.has(node.id)), current.dependencies),
      nodes: current.nodes.filter((node) => !nodeIdSet.has(node.id))
    }));
    setPositions((currentPositions) =>
      Object.fromEntries(Object.entries(currentPositions).filter(([nodeId]) => !nodeIdSet.has(nodeId)))
    );
    setSelectedEdgeId(undefined);
  }

  function removeEdges(edgeIds: string[]) {
    const edgeIdSet = new Set(edgeIds);

    setSource((current) => ({
      ...current,
      edges: current.edges.filter((edge) => !edgeIdSet.has(edge.id))
    }));
    setSelectedEdgeId((currentEdgeId) => (currentEdgeId && edgeIdSet.has(currentEdgeId) ? undefined : currentEdgeId));
  }

  function setEdgeAuto(edgeId: string) {
    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) => (edge.id === edgeId && edge.kind === "intent.connection" ? autoEdge(edge) : edge))
    }));
  }

  function lockCurrentAssignment(edgeId: string) {
    const choice = resolved.resolvedChoices.find((resolvedChoice) => resolvedChoice.sourceEdge === edgeId);

    if (!choice) {
      return;
    }

    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId && edge.kind === "intent.connection"
          ? {
              ...edge,
              strategy: {
                pinAssignment: "manual"
              },
              bindings: choice.selected.bindings
            }
          : edge
      )
    }));
  }

  function setManualPinPair(edgeId: string, pair: { sda: string; scl: string }) {
    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId && edge.kind === "intent.connection"
          ? {
              ...edge,
              strategy: {
                pinAssignment: "manual"
              },
              bindings: manualBindings(edge, pair)
            }
          : edge
      )
    }));
  }

  return (
    <main className="h-svh overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex h-full w-full max-w-none flex-col gap-4 overflow-hidden px-4 py-4 sm:px-6">
        <header className="flex shrink-0 flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Intent resolver slice
            </p>
            <h1 className="text-2xl font-semibold tracking-normal">RP2350 I2C bus</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
              <input
                checked={gpio4Reserved}
                className="size-4 accent-foreground"
                onChange={(event) => setConflictScenario(event.target.checked)}
                type="checkbox"
              />
              GPIO4 reserved
            </label>
            <button
              className="h-9 rounded-md border border-border px-4 text-sm font-medium"
              onClick={clearCanvas}
              type="button"
            >
              Clear
            </button>
            <button
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
              onClick={resetSample}
              type="button"
            >
              Reset sample
            </button>
          </div>
        </header>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div aria-label="Workspace views" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border pb-3" role="tablist">
            {workspaceTabs.map((tab) => (
              <button
                aria-controls={`${tab.id}-panel`}
                aria-selected={activeTab === tab.id}
                className={workspaceTabClassName(activeTab === tab.id)}
                id={`${tab.id}-tab`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden pt-4">
            {activeTab === "graph" ? (
              <div
                aria-labelledby="graph-tab"
                className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
                id="graph-panel"
                role="tabpanel"
              >
                <IntentGraphView
                  className="min-h-0"
                  componentTemplates={componentPalette}
                  graphRevision={graphRevision}
                  onAddComponent={addComponent}
                  onConnectNodes={connectNodes}
                  onRemoveEdges={removeEdges}
                  onRemoveNodes={removeNodes}
                  onPositionsChange={setPositions}
                  onSelectedEdgeChange={setSelectedGraphEdge}
                  positions={positions}
                  resolved={resolved}
                  source={source}
                />
                <EdgeAssignmentPanel
                  className="min-h-0 lg:w-[360px]"
                  onLockCurrent={lockCurrentAssignment}
                  onSetAuto={setEdgeAuto}
                  onSetManualPair={setManualPinPair}
                  resolved={resolved}
                  selectedEdgeId={selectedEdgeId}
                  source={source}
                />
              </div>
            ) : null}

            {activeTab === "resolution" ? (
              <div aria-labelledby="resolution-tab" className="h-full overflow-auto" id="resolution-panel" role="tabpanel">
                <div className="grid gap-4 xl:grid-cols-2">
                  <ResolutionPanel resolved={resolved} source={source} />
                  <BindingsPanel nets={resolved.nets} selectedChoice={selectedChoice} source={source} />
                </div>
              </div>
            ) : null}

            {activeTab === "diagnostics" ? (
              <div aria-labelledby="diagnostics-tab" className="h-full overflow-auto" id="diagnostics-panel" role="tabpanel">
                <DiagnosticsPanel diagnostics={resolved.diagnostics} source={source} />
              </div>
            ) : null}

            {activeTab === "json" ? (
              <div aria-labelledby="json-tab" className="h-full" id="json-panel" role="tabpanel">
                <JsonPanel
                  className="h-full"
                  resolvedJson={resolvedJson}
                  selectedView={jsonView}
                  setSelectedView={setJsonView}
                  sourceJson={sourceJson}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function workspaceTabClassName(active: boolean) {
  return active
    ? "h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
    : "h-9 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground";
}

function autoEdge(edge: IntentConnectionEdge): IntentConnectionEdge {
  const { bindings: _bindings, ...edgeWithoutBindings } = edge;

  return {
    ...edgeWithoutBindings,
    strategy: {
      pinAssignment: "auto"
    }
  };
}

function manualBindings(edge: IntentConnectionEdge, pair: { sda: string; scl: string }): SignalBindings {
  return {
    sda: {
      from: {
        node: edge.from.node,
        pin: pair.sda
      }
    },
    scl: {
      from: {
        node: edge.from.node,
        pin: pair.scl
      }
    }
  };
}

function uniqueId(base: string, usedIds: Set<string>) {
  if (!usedIds.has(base)) {
    return base;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${base}_${index}`;

    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
}

function createGraphId(prefix: GraphIdPrefix) {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function nextPosition(index: number): XYPosition {
  return {
    x: 120 + (index % 4) * 300,
    y: 120 + Math.floor(index / 4) * 220
  };
}

function isComponentTemplate(value: string): value is ComponentTemplate {
  return value in componentTemplates;
}

function edgeReferencesAnyNode(edge: ProjectEdge, nodeIds: Set<string>) {
  if (edge.kind === "intent.connection") {
    return nodeIds.has(edge.from.node) || nodeIds.has(edge.to.node);
  }

  return Object.values(edge.bindings).some((binding) =>
    Object.values(binding).some((endpoint) => endpoint?.node && nodeIds.has(endpoint.node))
  );
}

function dependenciesForNodes(nodes: ProjectNode[], currentDependencies: Record<string, string>) {
  const dependencies: Record<string, string> = {};

  for (const node of nodes) {
    if (node.kind !== "component") {
      continue;
    }

    const dependencyName = node.component.split(":")[0];
    const version = dependencyVersions[dependencyName] ?? currentDependencies[dependencyName];

    if (version) {
      dependencies[dependencyName] = version;
    }
  }

  return dependencies;
}
