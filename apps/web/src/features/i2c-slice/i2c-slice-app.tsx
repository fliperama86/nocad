import {
  components,
  contracts,
  createHdmiSliceProject,
  createHdmiTxSliceProject,
  createRp2350HdmiTxSliceProject,
  hdmiSliceIds,
  hdmiTxSliceIds,
  parseProjectSourceJson,
  ProjectDocument,
  ProjectDocumentError,
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
  ProjectPatch,
  ProjectSource,
  SignalBindings
} from "@nocad/intent-core";
import type { Connection, XYPosition } from "@xyflow/react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ChangeEvent } from "react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

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
import { bindingsForProviderMode } from "./provider-assignment";
import {
  filterConnectionOptionsForProviderRequirement,
  providerRequirementForHandle,
  providerRequirementHandlesForNode,
  providerRequirementPortFromHandle
} from "./provider-requirement-handles";
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
export function I2cSliceApp() {
  const [projectDocument] = useState(() => new ProjectDocument(createBlankSource()));
  const source = useSyncExternalStore(
    projectDocument.subscribe,
    projectDocument.getSnapshot,
    projectDocument.getSnapshot
  );
  const [jsonView, setJsonView] = useState<JsonView>("source");
  const [positions, setPositions] = useState<NodePositions>({});
  const [graphRevision, setGraphRevision] = useState(0);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("graph");
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<PendingConnectionIntent>();
  const [connectionFeedback, setConnectionFeedback] = useState<string>();
  const [projectFeedback, setProjectFeedback] = useState<{ kind: "error" | "success"; message: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolutionSnapshot = useMemo(
    () => ({ resolved: resolveProject(source), revision: projectDocument.revision }),
    [projectDocument, source]
  );
  const resolved = resolutionSnapshot.resolved;
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

  function dispatchProjectPatch(patch: ProjectPatch, expectedRevision?: number) {
    try {
      const record = projectDocument.apply(
        patch,
        expectedRevision === undefined ? undefined : { expectedRevision }
      );
      setProjectFeedback(undefined);
      return Boolean(record);
    } catch (error) {
      setProjectFeedback({ kind: "error", message: projectDocumentErrorMessage(error) });
      return false;
    }
  }

  function loadSource(nextSource: ProjectSource, nextPositions: NodePositions) {
    projectDocument.replace(nextSource);
    setPositions(nextPositions);
    setSelectedEdgeId(undefined);
    setSelectedNodeId(undefined);
    setPendingConnection(undefined);
    setConnectionFeedback(undefined);
    setProjectFeedback(undefined);
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
    loadSource(createBlankSource(), {});
  }

  function undoProjectEdit() {
    projectDocument.undo();
    setGraphRevision((revision) => revision + 1);
    setSelectedEdgeId(undefined);
    setSelectedNodeId(undefined);
    setPendingConnection(undefined);
    setConnectionFeedback(undefined);
    setProjectFeedback(undefined);
  }

  function redoProjectEdit() {
    projectDocument.redo();
    setGraphRevision((revision) => revision + 1);
    setSelectedEdgeId(undefined);
    setSelectedNodeId(undefined);
    setPendingConnection(undefined);
    setConnectionFeedback(undefined);
    setProjectFeedback(undefined);
  }

  function saveProjectFile() {
    const blob = new Blob([projectDocument.save()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");

    anchor.href = url;
    anchor.download = "project.nocad.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setProjectFeedback({ kind: "success", message: "Saved project.nocad.json." });
  }

  async function loadProjectFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    const expectedRevision = projectDocument.revision;

    try {
      const nextSource = parseProjectSourceJson(await file.text());
      projectDocument.replace(nextSource, { expectedRevision });
      setPositions({});
      setSelectedEdgeId(undefined);
      setSelectedNodeId(undefined);
      setPendingConnection(undefined);
      setConnectionFeedback(undefined);
      setGraphRevision((revision) => revision + 1);
      setProjectFeedback({ kind: "success", message: `Loaded ${file.name}.` });
    } catch (error) {
      setProjectFeedback({
        kind: "error",
        message: `Could not load ${file.name}: ${projectDocumentErrorMessage(error)}`
      });
    } finally {
      input.value = "";
    }
  }

  function addComponent(template: string) {
    if (!isComponentTemplate(template)) {
      return;
    }

    const component = componentTemplates[template];
    const id = createGraphId(component.idPrefix);

    const added = dispatchProjectPatch({
      op: "batch",
      patches: [
        ...(component.dependency
          ? ([
              {
                op: "setDependency",
                dependency: component.dependency.name,
                version: component.dependency.version
              }
            ] satisfies ProjectPatch[])
          : []),
        {
          op: "addNode",
          node: {
            ...component.node,
            id
          } as ProjectNode
        }
      ]
    });

    if (!added) {
      return;
    }

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
      const activeRequirements = providerRequirementHandlesForNode(source, targetNode);
      const requirement = providerRequirementForHandle(source, targetNode, connection.targetHandle);
      const requestedRequirementPort = providerRequirementPortFromHandle(connection.targetHandle);

      if (requestedRequirementPort && !requirement) {
        setConnectionFeedback("The selected requirement is no longer available.");
        setPendingConnection(undefined);
        return;
      }

      if (requirement?.connectedEdgeId) {
        setConnectionFeedback(`${requirement.label} is already connected.`);
        setPendingConnection(undefined);
        return;
      }

      const options = filterConnectionOptionsForProviderRequirement(
        componentConnectionOptionsForPair(sourceNode, targetNode, source.edges),
        targetNode.id,
        requirement,
        activeRequirements
      );

      if (options.length === 0) {
        setConnectionFeedback(
          requirement
            ? `${nodeDisplayName(sourceNode)} cannot satisfy ${requirement.label}.`
            : incompatibleConnectionMessage(sourceNode, targetNode)
        );
        setPendingConnection(undefined);
        return;
      }

      setConnectionFeedback(undefined);

      if (options.length === 1 && (requirement || shouldAutoCreateConnection(options))) {
        createConnectionFromIntent(options[0], options[0].params);
        return;
      }

      setPendingConnection({
        options,
        revision: projectDocument.revision,
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
    const edge = createIntentEdge(sourceNode, targetNode, new Set(source.edges.map((currentEdge) => currentEdge.id)));

    if (edge) {
      dispatchProjectPatch({ op: "addEdge", edge });
    }
  }

  function removeSelection({ edgeIds, nodeIds }: { edgeIds: string[]; nodeIds: string[] }) {
    const requestedNodeIds = new Set(nodeIds);
    const edgeIdSet = new Set(edgeIds);
    const existingNodeIds = source.nodes.filter((node) => requestedNodeIds.has(node.id)).map((node) => node.id);
    const existingNodeIdSet = new Set(existingNodeIds);
    const explicitEdgeIds = source.edges
      .filter((edge) => edgeIdSet.has(edge.id) && !edgeReferencesAnyNode(edge, existingNodeIdSet))
      .map((edge) => edge.id);
    const nextDependencies = dependenciesForNodes(
      source.nodes.filter((node) => !existingNodeIdSet.has(node.id)),
      source.dependencies
    );
    const dependencyPatches: ProjectPatch[] =
      existingNodeIds.length > 0
        ? Object.keys(source.dependencies)
            .filter((dependency) => !(dependency in nextDependencies))
            .map((dependency) => ({ op: "setDependency", dependency, version: null }))
        : [];

    if (existingNodeIds.length > 0 || explicitEdgeIds.length > 0) {
      dispatchProjectPatch({
        op: "batch",
        patches: [
          ...explicitEdgeIds.map((edge) => ({ op: "removeEdge", edge }) satisfies ProjectPatch),
          ...existingNodeIds.map((node) => ({ op: "removeNode", node }) satisfies ProjectPatch),
          ...dependencyPatches
        ]
      });
    }
    setSelectedEdgeId(undefined);
    setSelectedNodeId(undefined);
    setPendingConnection(undefined);
  }

  function setFunctionInclude(nodeId: string, feature: string, value: unknown) {
    dispatchProjectPatch({ op: "setFunctionInclude", node: nodeId, feature, value });
  }

  function setEdgeAuto(edgeId: string) {
    const edge = source.edges.find(
      (candidate): candidate is IntentConnectionEdge => candidate.id === edgeId && candidate.kind === "intent.connection"
    );

    if (!edge) {
      return;
    }

    const automatic = autoEdge(edge);
    dispatchProjectPatch({
      op: "batch",
      patches: [
        { op: "setEdgeBindings", edge: edgeId, value: null },
        { op: "setEdgeStrategy", edge: edgeId, value: automatic.strategy ?? null }
      ]
    });
  }

  function setConnectionParam(edgeId: string, param: string, value: ContractParamValue) {
    const edge = source.edges.find(
      (candidate): candidate is IntentConnectionEdge => candidate.id === edgeId && candidate.kind === "intent.connection"
    );

    if (edge) {
      dispatchProjectPatch({ op: "setEdgeParams", edge: edgeId, value: { ...edge.params, [param]: value } });
    }
  }

  function applyConnectionPreset(edgeId: string, params: ContractParams) {
    const edge = source.edges.find(
      (candidate): candidate is IntentConnectionEdge => candidate.id === edgeId && candidate.kind === "intent.connection"
    );

    if (edge) {
      dispatchProjectPatch({ op: "setEdgeParams", edge: edgeId, value: { ...edge.params, ...params } });
    }
  }

  function createConnectionFromIntent(
    option: ConnectionIntentOption,
    params: ContractParams | undefined,
    expectedRevision?: number
  ) {
    const edge = createComponentConnectionEdge(option, new Set(source.edges.map((currentEdge) => currentEdge.id)), params);

    dispatchProjectPatch({ op: "addEdge", edge }, expectedRevision);
    setPendingConnection(undefined);
  }

  function lockCurrentAssignment(edgeId: string) {
    const choice = resolved.resolvedChoices.find((resolvedChoice) => resolvedChoice.sourceEdge === edgeId);

    if (!choice) {
      return;
    }

    dispatchProjectPatch(
      {
        op: "batch",
        patches: [
          { op: "setEdgeStrategy", edge: edgeId, value: { pinAssignment: "manual" } },
          { op: "setEdgeBindings", edge: edgeId, value: choice.selected.bindings }
        ]
      },
      resolutionSnapshot.revision
    );
  }

  function setManualPinPair(edgeId: string, pair: { sda: string; scl: string }) {
    const edge = source.edges.find(
      (candidate): candidate is IntentConnectionEdge => candidate.id === edgeId && candidate.kind === "intent.connection"
    );

    if (edge) {
      dispatchProjectPatch({
        op: "batch",
        patches: [
          { op: "setEdgeStrategy", edge: edgeId, value: { pinAssignment: "manual" } },
          { op: "setEdgeBindings", edge: edgeId, value: manualBindings(edge, pair) }
        ]
      });
    }
  }

  function setProviderMode(edgeId: string, providerMode: string) {
    const edge = source.edges.find(
      (candidate): candidate is IntentProvidesEdge => candidate.id === edgeId && candidate.kind === "intent.provides"
    );

    if (edge) {
      dispatchProjectPatch({
        op: "batch",
        patches: [
          {
            op: "setEdgeBindings",
            edge: edgeId,
            value: bindingsForProviderMode(source, edge, providerMode) ?? null
          },
          {
            op: "setEdgeStrategy",
            edge: edgeId,
            value: { ...edge.strategy, providerMode }
          }
        ]
      });
    }
  }

  function setProviderPin(edgeId: string, signal: string, pin: string | undefined) {
    const edge = source.edges.find(
      (candidate): candidate is IntentProvidesEdge => candidate.id === edgeId && candidate.kind === "intent.provides"
    );

    if (!edge) {
      return;
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

    dispatchProjectPatch({
      op: "batch",
      patches: [
        {
          op: "setEdgeBindings",
          edge: edgeId,
          value: Object.keys(bindings).length > 0 ? bindings : null
        },
        { op: "setEdgeStrategy", edge: edgeId, value: { ...edge.strategy } }
      ]
    });
  }

  function applyProviderPinPreset(edgeId: string, pinsBySignal: Record<string, string>) {
    const edge = source.edges.find(
      (candidate): candidate is IntentProvidesEdge => candidate.id === edgeId && candidate.kind === "intent.provides"
    );

    if (!edge) {
      return;
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

    dispatchProjectPatch({
      op: "batch",
      patches: [
        { op: "setEdgeBindings", edge: edgeId, value: bindings },
        {
          op: "setEdgeStrategy",
          edge: edgeId,
          value: { ...edge.strategy, providerMode: "custom_gpio" }
        }
      ]
    });
  }

  function setBoardComponentPlacement(nodeId: string, placement: BoardComponentPlacement) {
    dispatchProjectPatch({
      op: "setBoardPlacement",
      object: nodeId,
      value: {
        rotation: `${roundLayoutNumber(placement.rotationDeg)}deg`,
        x: `${roundLayoutNumber(placement.xMm)}mm`,
        y: `${roundLayoutNumber(placement.yMm)}mm`
      }
    });
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
                className="h-8 rounded-md border border-border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!projectDocument.canUndo}
                onClick={undoProjectEdit}
                type="button"
              >
                Undo
              </button>
              <button
                className="h-8 rounded-md border border-border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!projectDocument.canRedo}
                onClick={redoProjectEdit}
                type="button"
              >
                Redo
              </button>
              <button
                className="h-8 rounded-md border border-border px-3 text-xs font-medium"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                Load project
              </button>
              <input
                accept=".json,application/json"
                className="sr-only"
                onChange={loadProjectFile}
                ref={fileInputRef}
                type="file"
              />
              <button
                className="h-8 rounded-md border border-border px-3 text-xs font-medium"
                onClick={saveProjectFile}
                type="button"
              >
                Save project
              </button>
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
          {projectFeedback ? (
            <div
              aria-live="polite"
              className={cn(
                "mt-2 shrink-0 rounded-md border px-3 py-2 text-xs",
                projectFeedback.kind === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              )}
              role={projectFeedback.kind === "error" ? "alert" : "status"}
            >
              {projectFeedback.message}
            </div>
          ) : null}

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
                  onInvalidConnection={(sourceNodeId, targetNodeId, targetHandle) => {
                    const sourceNode = source.nodes.find((node) => node.id === sourceNodeId);
                    const targetNode = source.nodes.find((node) => node.id === targetNodeId);

                    setConnectionFeedback(
                      sourceNode && targetNode
                        ? validateNodeConnection(sourceNode, targetNode, source.edges, targetHandle, source).message
                        : "These nodes do not expose a compatible connection."
                    );
                  }}
                  onRemoveSelection={removeSelection}
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
                <DiagnosticsPanel
                  diagnostics={resolved.diagnostics}
                  onApplySuggestion={(suggestion) =>
                    dispatchProjectPatch(suggestion.patch, resolutionSnapshot.revision)
                  }
                  source={source}
                />
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
        onCreate={(option, params) => createConnectionFromIntent(option, params, pendingConnection?.revision)}
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

function projectDocumentErrorMessage(error: unknown) {
  if (error instanceof ProjectDocumentError) {
    return `${error.message} (${error.code})`;
  }

  return error instanceof Error ? error.message : "An unknown project document error occurred.";
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
  currentEdges: ProjectEdge[],
  targetHandle?: string | null,
  source?: ProjectSource
): NodeConnectionValidation {
  if (sourceNode.id === targetNode.id) {
    return { message: "A node cannot connect to itself.", valid: false };
  }

  if (sourceNode.kind === "component" && targetNode.kind === "component") {
    const activeRequirements = source ? providerRequirementHandlesForNode(source, targetNode) : [];
    const requirement = source ? providerRequirementForHandle(source, targetNode, targetHandle) : undefined;
    const options = filterConnectionOptionsForProviderRequirement(
      componentConnectionOptionsForPair(sourceNode, targetNode, currentEdges),
      targetNode.id,
      requirement,
      activeRequirements
    );

    if (providerRequirementPortFromHandle(targetHandle) && !requirement) {
      return { message: "The selected requirement is no longer available.", valid: false };
    }

    if (requirement?.connectedEdgeId) {
      return { message: `${requirement.label} is already connected.`, valid: false };
    }

    return options.length > 0
      ? { message: "", valid: true }
      : {
          message: requirement
            ? `${nodeDisplayName(sourceNode)} cannot satisfy ${requirement.label}.`
            : incompatibleConnectionMessage(sourceNode, targetNode),
          valid: false
        };
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
  connection: {
    source: string | null;
    target: string | null;
    targetHandle?: string | null;
  }
) {
  const sourceNode = source.nodes.find((node) => node.id === connection.source);
  const targetNode = source.nodes.find((node) => node.id === connection.target);

  return Boolean(
    sourceNode &&
      targetNode &&
      validateNodeConnection(sourceNode, targetNode, source.edges, connection.targetHandle, source).valid
  );
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
  if ("from" in edge && "to" in edge && (nodeIds.has(edge.from.node) || nodeIds.has(edge.to.node))) {
    return true;
  }

  if (!("bindings" in edge) || !edge.bindings) {
    return false;
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
