import { createHdmiSliceProject, hdmiSliceIds, resolveProject } from "@nocad/intent-core";
import type {
  GraphObjectMetadata,
  IntentConnectionEdge,
  IntentExposesEdge,
  IntentProvidesEdge,
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

function createSource() {
  return createHdmiSliceProject();
}

function createBlankSource() {
  const source = createSource();

  return {
    ...source,
    dependencies: {},
    edges: [],
    nodes: []
  } satisfies ProjectSource;
}

type ComponentTemplate = "hdmiFunction" | "hdmiPort" | "mcu" | "sensor" | "rail";
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
    | {
        kind: "intent.function";
        function: string;
        requirements?: Record<string, unknown>;
        include?: Record<string, unknown>;
      }
  );
type ComponentTemplateDefinition = {
  dependency?: SourceDependency;
  idPrefix: GraphIdPrefix;
  label: string;
  node: ProjectNodeTemplate;
};

const dependencyVersions: Record<string, string> = {
  "@nocad/connectors": "0.1.0",
  "@nocad/video": "0.1.0",
  "@nocad/rp2350": "0.1.0",
  "@nocad/sensors": "0.1.0"
};

const defaultPositions: NodePositions = {
  [hdmiSliceIds.mcu]: { x: 110, y: 270 },
  [hdmiSliceIds.hdmiFunction]: { x: 460, y: 215 },
  [hdmiSliceIds.hdmiPort]: { x: 820, y: 270 }
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
  },
  hdmiFunction: {
    dependency: {
      name: "@nocad/video",
      version: dependencyVersions["@nocad/video"]
    },
    idPrefix: "node",
    label: "HDMI output",
    node: {
      kind: "intent.function",
      label: "HDMI video output",
      role: "video_output",
      function: "@nocad/video:hdmi_output.v1",
      requirements: {
        resolution: "640x480@60",
        colorDepth: "rgb332"
      },
      include: {
        tmds: true,
        ddc: true,
        hpd: true,
        cec: false,
        source5v: true,
        seriesTermination: {
          mode: "auto",
          value: "270ohm"
        },
        esdProtection: "recommended"
      }
    }
  },
  hdmiPort: {
    dependency: {
      name: "@nocad/connectors",
      version: dependencyVersions["@nocad/connectors"]
    },
    idPrefix: "node",
    label: "HDMI port",
    node: {
      kind: "component",
      label: "HDMI port",
      role: "hdmi_port",
      component: "@nocad/connectors:HDMI_TYPE_A_RECEPTACLE",
      refdesHint: "J?"
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
const providerDataSignalIds = new Set([
  "clock_n",
  "clock_p",
  "tmds0_n",
  "tmds0_p",
  "tmds1_n",
  "tmds1_p",
  "tmds2_n",
  "tmds2_p"
]);

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
  const sourceJson = useMemo(() => JSON.stringify(source, null, 2), [source]);
  const resolvedJson = useMemo(() => JSON.stringify(resolved, null, 2), [resolved]);

  const setSelectedGraphEdge = useCallback((edgeId: string | undefined) => {
    setSelectedEdgeId((currentEdgeId) => (currentEdgeId === edgeId ? currentEdgeId : edgeId));
  }, []);

  function resetSample() {
    setSource(createSource());
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
      const sourceNode = current.nodes.find((node) => node.id === connection.source);
      const targetNode = current.nodes.find((node) => node.id === connection.target);

      if (!sourceNode || !targetNode) {
        return current;
      }

      const edgeIds = new Set(current.edges.map((edge) => edge.id));
      const edge = createIntentEdge(sourceNode, targetNode, edgeIds);

      if (!edge) {
        return current;
      }

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

  function setProviderMode(edgeId: string, providerMode: string) {
    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId && edge.kind === "intent.provides"
          ? {
              ...edge,
              bindings:
                providerMode === "custom_gpio"
                  ? edge.bindings
                  : removeProviderDataBindings(edge.bindings),
              strategy: {
                ...edge.strategy,
                providerMode
              }
            }
          : edge
      )
    }));
  }

  function setProviderPin(edgeId: string, signal: string, pin: string | undefined) {
    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) => {
        if (edge.id !== edgeId || edge.kind !== "intent.provides") {
          return edge;
        }

        const bindings = { ...(edge.bindings ?? {}) };

        if (pin) {
          bindings[signal] = {
            ...bindings[signal],
            from: {
              node: edge.from.node,
              pin
            }
          };
        } else {
          delete bindings[signal];
        }

        return {
          ...edge,
          bindings: Object.keys(bindings).length > 0 ? bindings : undefined,
          strategy: {
            ...edge.strategy
          }
        };
      })
    }));
  }

  function applyProviderPinPreset(edgeId: string, pinsBySignal: Record<string, string>) {
    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) => {
        if (edge.id !== edgeId || edge.kind !== "intent.provides") {
          return edge;
        }

        const bindings: SignalBindings = Object.fromEntries(
          Object.entries(pinsBySignal).map(([signal, pin]) => [
            signal,
            {
              from: {
                node: edge.from.node,
                pin
              }
            }
          ])
        );

        return {
          ...edge,
          bindings,
          strategy: {
            ...edge.strategy,
            providerMode: "custom_gpio"
          }
        };
      })
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
            <h1 className="text-2xl font-semibold tracking-normal">RP2350 intent graph</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              Load HDMI sample
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
                  onSetProviderMode={setProviderMode}
                  onSetProviderPin={setProviderPin}
                  onSetProviderPinPreset={applyProviderPinPreset}
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

function createIntentEdge(
  sourceNode: ProjectNode,
  targetNode: ProjectNode,
  edgeIds: Set<string>
): IntentConnectionEdge | IntentExposesEdge | IntentProvidesEdge | undefined {
  if (sourceNode.kind === "component" && targetNode.kind === "component") {
    if (isConnectorNode(sourceNode) || isConnectorNode(targetNode)) {
      return undefined;
    }

    return createI2cIntentEdge(sourceNode, targetNode, edgeIds);
  }

  if (sourceNode.kind === "intent.function" && targetNode.kind === "component") {
    return isConnectorNode(targetNode)
      ? createExposesEdge(sourceNode, targetNode, edgeIds)
      : createProvidesEdge(targetNode, sourceNode, edgeIds);
  }

  if (sourceNode.kind === "component" && targetNode.kind === "intent.function") {
    return isConnectorNode(sourceNode)
      ? createExposesEdge(targetNode, sourceNode, edgeIds)
      : createProvidesEdge(sourceNode, targetNode, edgeIds);
  }

  return undefined;
}

function createI2cIntentEdge(
  sourceNode: ProjectNode,
  targetNode: ProjectNode,
  edgeIds: Set<string>
): IntentConnectionEdge {
  return {
    id: uniqueId(createGraphId("edge"), edgeIds),
    kind: "intent.connection",
    label: "Sensor I2C bus",
    role: "sensor_bus",
    from: {
      node: sourceNode.id,
      port: "i2c"
    },
    to: {
      node: targetNode.id,
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
}

function createProvidesEdge(
  componentNode: ProjectNode,
  functionNode: ProjectNode,
  edgeIds: Set<string>
): IntentProvidesEdge {
  return {
    id: uniqueId(createGraphId("edge"), edgeIds),
    kind: "intent.provides",
    label: "Video provider",
    role: "video_provider",
    from: {
      node: componentNode.id,
      port: componentProviderPort(componentNode)
    },
    to: {
      node: functionNode.id,
      port: "source"
    },
    contract: functionNode.kind === "intent.function" ? functionNode.function : "builtin:unknown",
    strategy: {
      pinAssignment: "auto",
      providerMode: "auto"
    }
  };
}

function createExposesEdge(
  functionNode: ProjectNode,
  connectorNode: ProjectNode,
  edgeIds: Set<string>
): IntentExposesEdge {
  return {
    id: uniqueId(createGraphId("edge"), edgeIds),
    kind: "intent.exposes",
    label: "HDMI connector",
    role: "video_connector",
    from: {
      node: functionNode.id,
      port: "connector"
    },
    to: {
      node: connectorNode.id,
      port: connectorPort(connectorNode)
    },
    contract: functionNode.kind === "intent.function" ? functionNode.function : "builtin:unknown"
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

function removeProviderDataBindings(bindings: SignalBindings | undefined) {
  if (!bindings) {
    return undefined;
  }

  const sidebandBindings = Object.fromEntries(
    Object.entries(bindings).filter(([signal]) => !providerDataSignalIds.has(signal))
  );

  return Object.keys(sidebandBindings).length > 0 ? sidebandBindings : undefined;
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
  if (edge.kind === "intent.connection" || edge.kind === "intent.exposes" || edge.kind === "intent.provides") {
    return nodeIds.has(edge.from.node) || nodeIds.has(edge.to.node);
  }

  return Object.values(edge.bindings).some((binding) =>
    Object.values(binding).some((endpoint) => endpoint?.node && nodeIds.has(endpoint.node))
  );
}

function dependenciesForNodes(nodes: ProjectNode[], currentDependencies: Record<string, string>) {
  const dependencies: Record<string, string> = {};

  for (const node of nodes) {
    const dependencyName = dependencyNameForNode(node);

    if (!dependencyName) {
      continue;
    }

    const version = dependencyVersions[dependencyName] ?? currentDependencies[dependencyName];

    if (version) {
      dependencies[dependencyName] = version;
    }
  }

  return dependencies;
}

function dependencyNameForNode(node: ProjectNode) {
  if (node.kind === "component") {
    return node.component.split(":")[0];
  }

  if (node.kind === "intent.function") {
    return node.function.split(":")[0];
  }

  return undefined;
}

function isConnectorNode(node: ProjectNode) {
  return node.kind === "component" && (node.role?.includes("port") === true || node.component.includes("CONNECTOR"));
}

function componentProviderPort(node: ProjectNode) {
  return node.kind === "component" && node.role === "mcu" ? "video_out" : "provider";
}

function connectorPort(node: ProjectNode) {
  return node.kind === "component" && node.role === "hdmi_port" ? "hdmi" : "connector";
}
