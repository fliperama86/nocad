import {
  components,
  contracts,
  createHdmiSliceProject,
  createHdmiTxSliceProject,
  createRp2350HdmiTxSliceProject,
  hdmiSliceIds,
  hdmiTxSliceIds,
  resolveProject
} from "@nocad/intent-core";
import type {
  ContractParams,
  ContractParamValue,
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
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { BindingsPanel } from "./bindings-panel";
import {
  ConnectionIntentDialog,
  type ConnectionIntentOption,
  type PendingConnectionIntent
} from "./connection-intent-dialog";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { EdgeAssignmentPanel } from "./edge-assignment-panel";
import { matchFunctionComponentConnection } from "./function-connection-intent";
import { IntentGraphView } from "./intent-graph-view";
import { JsonPanel, type JsonView } from "./json-panel";
import { PcbDesignerPanel, type BoardComponentPlacement } from "./pcb-designer-panel";
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

type ComponentTemplate = "fpga" | "hdmiFunction" | "hdmiPort" | "hdmiTx" | "mcu" | "sensor" | "rail3v3" | "rail5v";
type WorkspaceTab = "graph" | "pcb" | "resolution" | "diagnostics" | "json";
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
  "@nocad/fpga": "0.1.0",
  "@nocad/hdmi-tx": "0.1.0",
  "@nocad/rp2350": "0.1.0",
  "@nocad/sensors": "0.1.0"
};

const directHdmiPositions: NodePositions = {
  [hdmiSliceIds.mcu]: { x: 110, y: 270 },
  [hdmiSliceIds.hdmiFunction]: { x: 460, y: 215 },
  [hdmiSliceIds.hdmiPort]: { x: 820, y: 270 },
  [hdmiSliceIds.rail5v]: { x: 820, y: 80 }
};

const hdmiTxPositions: NodePositions = {
  [hdmiTxSliceIds.videoSource]: { x: 80, y: 280 },
  [hdmiTxSliceIds.tx]: { x: 400, y: 280 },
  [hdmiTxSliceIds.hdmiFunction]: { x: 720, y: 220 },
  [hdmiTxSliceIds.hdmiPort]: { x: 1040, y: 280 },
  [hdmiTxSliceIds.rail5v]: { x: 1040, y: 80 }
};

const componentTemplates: Record<ComponentTemplate, ComponentTemplateDefinition> = {
  fpga: {
    dependency: {
      name: "@nocad/fpga",
      version: dependencyVersions["@nocad/fpga"]
    },
    idPrefix: "node",
    label: "FPGA",
    node: {
      kind: "component",
      label: "Video source",
      role: "video_source",
      component: "@nocad/fpga:GENERIC_FPGA",
      package: "BGA",
      refdesHint: "U?"
    }
  },
  hdmiTx: {
    dependency: {
      name: "@nocad/hdmi-tx",
      version: dependencyVersions["@nocad/hdmi-tx"]
    },
    idPrefix: "node",
    label: "HDMI TX",
    node: {
      kind: "component",
      label: "HDMI transmitter",
      role: "hdmi_tx",
      component: "@nocad/hdmi-tx:IT66121",
      refdesHint: "U?"
    }
  },
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
  rail3v3: {
    idPrefix: "node",
    label: "3V3 rail",
    node: {
      kind: "powerDomain",
      label: "3V3 rail",
      role: "power_3v3",
      voltage: "3.3V"
    }
  },
  rail5v: {
    idPrefix: "node",
    label: "5V rail",
    node: {
      kind: "powerDomain",
      label: "5V rail",
      role: "power_5v",
      voltage: "5V"
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
  { id: "pcb", label: "PCB" },
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
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("graph");
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<PendingConnectionIntent>();
  const [connectionFeedback, setConnectionFeedback] = useState<string>();

  const resolved = useMemo(() => resolveProject(source), [source]);
  const selectedChoice = selectedEdgeId
    ? (resolved.resolvedChoices.find((choice) => choice.sourceEdge === selectedEdgeId) ?? resolved.resolvedChoices[0])
    : resolved.resolvedChoices[0];
  const sourceJson = useMemo(() => JSON.stringify(source, null, 2), [source]);
  const resolvedJson = useMemo(() => JSON.stringify(resolved, null, 2), [resolved]);

  const setSelectedGraphEdge = useCallback((edgeId: string | undefined) => {
    if (edgeId) {
      setPendingConnection(undefined);
    }
    setSelectedEdgeId((currentEdgeId) => (currentEdgeId === edgeId ? currentEdgeId : edgeId));
  }, []);

  const setSelectedGraphNode = useCallback((nodeId: string | undefined) => {
    if (nodeId) {
      setPendingConnection(undefined);
    }
    setSelectedNodeId((currentNodeId) => (currentNodeId === nodeId ? currentNodeId : nodeId));
  }, []);

  function loadSource(nextSource: ProjectSource, nextPositions: NodePositions) {
    setSource(nextSource);
    setPositions(nextPositions);
    setSelectedEdgeId(undefined);
    setSelectedNodeId(undefined);
    setPendingConnection(undefined);
    setConnectionFeedback(undefined);
    setGraphRevision((revision) => revision + 1);
  }

  function resetSample() {
    loadSource(createSource(), directHdmiPositions);
  }

  function loadTxSample() {
    loadSource(createHdmiTxSliceProject(), hdmiTxPositions);
  }

  function loadRp2350TxSample() {
    loadSource(createRp2350HdmiTxSliceProject(), hdmiTxPositions);
  }

  function clearCanvas() {
    setSource(createBlankSource());
    setPositions({});
    setSelectedEdgeId(undefined);
    setSelectedNodeId(undefined);
    setPendingConnection(undefined);
    setConnectionFeedback(undefined);
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
      setConnectionFeedback("A connection requires two different compatible nodes.");
      return;
    }

    const sourceNode = source.nodes.find((node) => node.id === connection.source);
    const targetNode = source.nodes.find((node) => node.id === connection.target);

    if (!sourceNode || !targetNode) {
      setConnectionFeedback("The connection endpoints are no longer present in the project.");
      return;
    }

    if (sourceNode.kind === "component" && targetNode.kind === "component") {
      const options = componentConnectionOptionsForPair(sourceNode, targetNode, source.edges);

      if (options.length === 0) {
        setConnectionFeedback(incompatibleConnectionMessage(sourceNode, targetNode));
        setPendingConnection(undefined);
        return;
      }

      setConnectionFeedback(undefined);

      if (options.length === 1 && shouldAutoCreateConnection(options)) {
        createConnectionFromIntent(options[0], options[0].params);
        return;
      }

      setPendingConnection({
        options,
        sourceNode: sourceNode.id,
        targetNode: targetNode.id
      });
      setSelectedEdgeId(undefined);
      setSelectedNodeId(undefined);
      return;
    }

    const validation = validateNodeConnection(sourceNode, targetNode, source.edges);

    if (!validation.valid) {
      setConnectionFeedback(validation.message);
      setPendingConnection(undefined);
      return;
    }

    setConnectionFeedback(undefined);
    setPendingConnection(undefined);
    setSource((current) => {
      const edgeIds = new Set(current.edges.map((edge) => edge.id));
      const currentSourceNode = current.nodes.find((node) => node.id === connection.source);
      const currentTargetNode = current.nodes.find((node) => node.id === connection.target);

      if (!currentSourceNode || !currentTargetNode) {
        return current;
      }

      const edge = createIntentEdge(currentSourceNode, currentTargetNode, edgeIds);

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
    setSelectedNodeId(undefined);
    setPendingConnection(undefined);
  }

  function removeEdges(edgeIds: string[]) {
    const edgeIdSet = new Set(edgeIds);

    setSource((current) => ({
      ...current,
      edges: current.edges.filter((edge) => !edgeIdSet.has(edge.id))
    }));
    setSelectedEdgeId((currentEdgeId) => (currentEdgeId && edgeIdSet.has(currentEdgeId) ? undefined : currentEdgeId));
    setPendingConnection(undefined);
  }

  function setFunctionInclude(nodeId: string, feature: string, value: unknown) {
    setSource((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId && node.kind === "intent.function"
          ? {
              ...node,
              include: {
                ...node.include,
                [feature]: value
              }
            }
          : node
      )
    }));
  }

  function setEdgeAuto(edgeId: string) {
    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) => (edge.id === edgeId && edge.kind === "intent.connection" ? autoEdge(edge) : edge))
    }));
  }

  function setConnectionParam(edgeId: string, param: string, value: ContractParamValue) {
    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId && edge.kind === "intent.connection"
          ? {
              ...edge,
              params: {
                ...edge.params,
                [param]: value
              }
            }
          : edge
      )
    }));
  }

  function applyConnectionPreset(edgeId: string, params: ContractParams) {
    setSource((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId && edge.kind === "intent.connection"
          ? {
              ...edge,
              params: {
                ...edge.params,
                ...params
              }
            }
          : edge
      )
    }));
  }

  function createConnectionFromIntent(option: ConnectionIntentOption, params: ContractParams | undefined) {
    setSource((current) => {
      const edgeIds = new Set(current.edges.map((edge) => edge.id));
      const edge = createComponentConnectionEdge(option, edgeIds, params);

      return {
        ...current,
        edges: [...current.edges, edge]
      };
    });
    setPendingConnection(undefined);
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

  function setBoardComponentPlacement(nodeId: string, placement: BoardComponentPlacement) {
    setSource((current) => ({
      ...current,
      layout: {
        board: current.layout?.board ?? current.board?.id ?? "main_board",
        placements: {
          ...(current.layout?.placements ?? {}),
          [nodeId]: {
            rotation: `${roundLayoutNumber(placement.rotationDeg)}deg`,
            x: `${roundLayoutNumber(placement.xMm)}mm`,
            y: `${roundLayoutNumber(placement.yMm)}mm`
          }
        },
        routingIntent: current.layout?.routingIntent ?? []
      }
    }));
  }

  return (
    <main className="h-svh overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex h-full w-full max-w-none flex-col gap-2 overflow-hidden px-3 py-3 sm:px-4">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <div aria-label="Workspace views" className="flex flex-wrap items-center gap-1.5" role="tablist">
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
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                className="h-8 rounded-md border border-border px-3 text-xs font-medium"
                onClick={clearCanvas}
                type="button"
              >
                Clear
              </button>
              <button
                className="h-8 rounded-md border border-border px-3 text-xs font-medium"
                onClick={resetSample}
                type="button"
              >
                Load direct HDMI
              </button>
              <button
                className="h-8 rounded-md border border-border px-3 text-xs font-medium"
                onClick={loadTxSample}
                type="button"
              >
                Load FPGA via TX IC
              </button>
              <button
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
                onClick={loadRp2350TxSample}
                type="button"
              >
                Load RP2350 via TX IC
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden pt-2">
            {activeTab === "graph" ? (
              <div
                aria-labelledby="graph-tab"
                className={cn(
                  "grid h-full min-h-0 gap-2",
                  propertiesCollapsed
                    ? "lg:grid-cols-[minmax(0,1fr)_44px]"
                    : "lg:grid-cols-[minmax(0,1fr)_360px]"
                )}
                id="graph-panel"
                role="tabpanel"
              >
                <IntentGraphView
                  className="min-h-0"
                  componentTemplates={componentPalette}
                  graphRevision={graphRevision}
                  connectionFeedback={connectionFeedback}
                  isValidConnection={(connection) => isValidGraphConnection(source, connection)}
                  onAddComponent={addComponent}
                  onCanvasPaneClick={() => setPropertiesCollapsed(true)}
                  onConnectNodes={connectNodes}
                  onDismissConnectionFeedback={() => setConnectionFeedback(undefined)}
                  onInvalidConnection={(sourceNodeId, targetNodeId) => {
                    const sourceNode = source.nodes.find((node) => node.id === sourceNodeId);
                    const targetNode = source.nodes.find((node) => node.id === targetNodeId);

                    setConnectionFeedback(
                      sourceNode && targetNode
                        ? validateNodeConnection(sourceNode, targetNode, source.edges).message
                        : "These nodes do not expose a compatible connection."
                    );
                  }}
                  onRemoveEdges={removeEdges}
                  onRemoveNodes={removeNodes}
                  onPositionsChange={setPositions}
                  onSelectedEdgeChange={setSelectedGraphEdge}
                  onSelectedNodeChange={setSelectedGraphNode}
                  positions={positions}
                  resolved={resolved}
                  source={source}
                />
                {propertiesCollapsed ? (
                  <div className="flex h-9 min-h-0 items-start justify-end lg:h-auto lg:w-9 lg:justify-center">
                    <button
                      aria-label="Expand properties panel"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-card-foreground hover:bg-muted"
                      onClick={() => setPropertiesCollapsed(false)}
                      title="Expand properties panel"
                      type="button"
                    >
                      <PanelRightOpen aria-hidden="true" className="size-4" strokeWidth={1.8} />
                    </button>
                  </div>
                ) : (
                  <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:w-[360px]">
                    <div className="flex justify-end pb-2">
                      <button
                        aria-label="Collapse properties panel"
                        className="flex size-8 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setPropertiesCollapsed(true)}
                        title="Collapse properties panel"
                        type="button"
                      >
                        <PanelRightClose aria-hidden="true" className="size-4" strokeWidth={1.8} />
                      </button>
                    </div>
                    <EdgeAssignmentPanel
                      className="h-full min-h-0"
                      onApplyConnectionPreset={applyConnectionPreset}
                      onLockCurrent={lockCurrentAssignment}
                      onSetAuto={setEdgeAuto}
                      onSetConnectionParam={setConnectionParam}
                      onSetFunctionInclude={setFunctionInclude}
                      onSetManualPair={setManualPinPair}
                      onSetProviderMode={setProviderMode}
                      onSetProviderPin={setProviderPin}
                      onSetProviderPinPreset={applyProviderPinPreset}
                      resolved={resolved}
                      selectedEdgeId={selectedEdgeId}
                      selectedNodeId={selectedNodeId}
                      source={source}
                    />
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === "pcb" ? (
              <div aria-labelledby="pcb-tab" className="h-full min-h-0" id="pcb-panel" role="tabpanel">
                <PcbDesignerPanel
                  onSetComponentPlacement={setBoardComponentPlacement}
                  resolved={resolved}
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
      <ConnectionIntentDialog
        onCancel={() => setPendingConnection(undefined)}
        onCreate={createConnectionFromIntent}
        pendingConnection={pendingConnection}
        source={source}
      />
    </main>
  );
}

function workspaceTabClassName(active: boolean) {
  return active
    ? "h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
    : "h-8 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground";
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
    return undefined;
  }

  const functionNode = sourceNode.kind === "intent.function" ? sourceNode : targetNode;
  const componentNode = sourceNode.kind === "component" ? sourceNode : targetNode;
  const match = matchFunctionComponentConnection(componentNode, functionNode);

  if (!match.intent || componentNode.kind !== "component" || functionNode.kind !== "intent.function") {
    return undefined;
  }

  return match.intent.kind === "provides"
    ? createProvidesEdge(
        componentNode,
        functionNode,
        match.intent.componentPort,
        match.intent.contract,
        match.intent.providerMode,
        edgeIds
      )
    : createExposesEdge(functionNode, componentNode, match.intent.componentPort, match.intent.contract, edgeIds);
}

type NodeConnectionValidation =
  | { message: ""; valid: true }
  | { message: string; valid: false };

function validateNodeConnection(
  sourceNode: ProjectNode,
  targetNode: ProjectNode,
  currentEdges: ProjectEdge[]
): NodeConnectionValidation {
  if (sourceNode.id === targetNode.id) {
    return { message: "A node cannot connect to itself.", valid: false };
  }

  if (sourceNode.kind === "component" && targetNode.kind === "component") {
    return componentConnectionOptionsForPair(sourceNode, targetNode, currentEdges).length > 0
      ? { message: "", valid: true }
      : { message: incompatibleConnectionMessage(sourceNode, targetNode), valid: false };
  }

  const functionNode = sourceNode.kind === "intent.function" ? sourceNode : targetNode;
  const componentNode = sourceNode.kind === "component" ? sourceNode : targetNode;

  if (functionNode.kind !== "intent.function" || componentNode.kind !== "component") {
    return { message: "Only compatible components and function intents can be connected.", valid: false };
  }

  const match = matchFunctionComponentConnection(componentNode, functionNode);

  if (!match.intent) {
    const reason =
      match.reason === "ambiguous"
        ? "Multiple compatible ports were found; explicit port selection is required."
        : `${nodeDisplayName(componentNode)} does not provide or expose ${nodeDisplayName(functionNode)}.`;

    return { message: reason, valid: false };
  }

  const duplicate = currentEdges.some((edge) =>
    match.intent.kind === "provides"
      ? edge.kind === "intent.provides" &&
        edge.from.node === componentNode.id &&
        edge.to.node === functionNode.id &&
        edge.contract === match.intent.contract
      : edge.kind === "intent.exposes" &&
        edge.from.node === functionNode.id &&
        edge.to.node === componentNode.id &&
        edge.contract === match.intent.contract
  );

  return duplicate
    ? { message: `${nodeDisplayName(componentNode)} is already connected to ${nodeDisplayName(functionNode)}.`, valid: false }
    : { message: "", valid: true };
}

function isValidGraphConnection(
  source: ProjectSource,
  connection: { source: string | null; target: string | null }
) {
  const sourceNode = source.nodes.find((node) => node.id === connection.source);
  const targetNode = source.nodes.find((node) => node.id === connection.target);

  return Boolean(sourceNode && targetNode && validateNodeConnection(sourceNode, targetNode, source.edges).valid);
}

function incompatibleConnectionMessage(sourceNode: ProjectNode, targetNode: ProjectNode) {
  return `${nodeDisplayName(sourceNode)} and ${nodeDisplayName(targetNode)} do not share a compatible contract and port direction.`;
}

function nodeDisplayName(node: ProjectNode) {
  if (node.label) {
    return node.label;
  }

  if (node.kind === "component") {
    return humanIdentifier(node.component.split(":").pop() ?? node.component);
  }

  if (node.kind === "intent.function") {
    return humanIdentifier(node.function.split(":").pop() ?? node.function);
  }

  return node.voltage;
}

function createComponentConnectionEdge(
  option: ConnectionIntentOption,
  edgeIds: Set<string>,
  params: ContractParams | undefined
): IntentConnectionEdge {
  return {
    id: uniqueId(createGraphId("edge"), edgeIds),
    kind: "intent.connection",
    label: connectionLabel(option.contract),
    role: connectionRole(option.contract),
    from: option.from,
    to: option.to,
    contract: option.contract,
    params,
    strategy: {
      pinAssignment: "auto"
    }
  };
}

function componentConnectionOptionsForPair(
  sourceNode: ProjectNode,
  targetNode: ProjectNode,
  currentEdges: ProjectEdge[]
): ConnectionIntentOption[] {
  return [
    ...componentConnectionOptions(sourceNode, targetNode, currentEdges),
    ...componentConnectionOptions(targetNode, sourceNode, currentEdges)
  ];
}

function componentConnectionOptions(
  sourceNode: ProjectNode,
  targetNode: ProjectNode,
  currentEdges: ProjectEdge[]
): ConnectionIntentOption[] {
  if (sourceNode.kind !== "component" || targetNode.kind !== "component") {
    return [];
  }

  const sourceDefinition = components[sourceNode.component];
  const targetDefinition = components[targetNode.component];

  if (!sourceDefinition || !targetDefinition) {
    return [];
  }

  const existing = new Set(
    currentEdges.flatMap((edge) =>
      edge.kind === "intent.connection"
        ? [`${edge.from.node}.${edge.from.port ?? ""}->${edge.to.node}.${edge.to.port ?? ""}:${edge.contract}`]
        : []
    )
  );
  const options: ConnectionIntentOption[] = [];

  for (const [fromPort, fromDefinition] of Object.entries(sourceDefinition.ports)) {
    for (const [contract, fromMap] of Object.entries(fromDefinition.contractMaps ?? {})) {
      if (fromMap.role !== "from") {
        continue;
      }

      for (const [toPort, toDefinition] of Object.entries(targetDefinition.ports)) {
        const toMap = toDefinition.contractMaps?.[contract];

        if (toMap?.role !== "to") {
          continue;
        }

        if (existing.has(`${sourceNode.id}.${fromPort}->${targetNode.id}.${toPort}:${contract}`)) {
          continue;
        }

        options.push({
          contract,
          from: {
            node: sourceNode.id,
            port: fromPort
          },
          id: `${sourceNode.id}.${fromPort}->${targetNode.id}.${toPort}:${contract}`,
          label: connectionLabel(contract),
          params: defaultConnectionParams(contract),
          to: {
            node: targetNode.id,
            port: toPort
          }
        });
      }
    }
  }

  return [...options].sort(
    (left, right) =>
      connectionSignalCount(right.contract) - connectionSignalCount(left.contract) ||
      left.contract.localeCompare(right.contract)
  );
}

function connectionSignalCount(contractId: string) {
  return Object.keys(contracts[contractId]?.signals ?? {}).length;
}

function connectionLabel(contractId: string) {
  return contracts[contractId]?.label ?? humanIdentifier(contractId.split(":").pop() ?? contractId);
}

function connectionRole(contractId: string) {
  if (contractId === "builtin:i2c.v1") {
    return "i2c_bus";
  }

  if (contractId === "@nocad/video:pixel_stream.v1") {
    return "pixel_stream";
  }

  return "connection";
}

function shouldAutoCreateConnection(options: ConnectionIntentOption[]) {
  const onlyOption = options[0];

  return options.length === 1 && Boolean(onlyOption) && !connectionNeedsDialog(onlyOption);
}

function connectionNeedsDialog(option: ConnectionIntentOption) {
  const contract = contracts[option.contract];

  return Boolean(contract && (Object.keys(contract.params ?? {}).length > 0 || (contract.presets?.length ?? 0) > 0));
}

function defaultConnectionParams(contractId: string): ContractParams | undefined {
  const params = Object.fromEntries(
    Object.entries(contracts[contractId]?.params ?? {})
      .filter(([, definition]) => definition.default !== undefined)
      .map(([paramId, definition]) => [paramId, definition.default])
  ) as ContractParams;

  return Object.keys(params).length > 0 ? params : undefined;
}

function createProvidesEdge(
  componentNode: ProjectNode,
  functionNode: ProjectNode,
  componentPort: string,
  contract: string,
  providerMode: string | undefined,
  edgeIds: Set<string>
): IntentProvidesEdge {
  return {
    id: uniqueId(createGraphId("edge"), edgeIds),
    kind: "intent.provides",
    label: `Provides ${connectionLabel(contract)}`,
    role: "function_provider",
    from: {
      node: componentNode.id,
      port: componentPort
    },
    to: {
      node: functionNode.id,
      port: "source"
    },
    contract,
    strategy: {
      pinAssignment: "auto",
      providerMode: providerMode ?? "auto"
    }
  };
}

function createExposesEdge(
  functionNode: ProjectNode,
  componentNode: ProjectNode,
  componentPort: string,
  contract: string,
  edgeIds: Set<string>
): IntentExposesEdge {
  return {
    id: uniqueId(createGraphId("edge"), edgeIds),
    kind: "intent.exposes",
    label: `Exposes ${connectionLabel(contract)}`,
    role: "function_exposure",
    from: {
      node: functionNode.id,
      port: "connector"
    },
    to: {
      node: componentNode.id,
      port: componentPort
    },
    contract
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

function humanIdentifier(value: string) {
  return value.replaceAll(/[_-]/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function roundLayoutNumber(value: number) {
  return Number(value.toFixed(3));
}
