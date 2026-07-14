import type { DefinitionCatalog, ProjectNode, ProjectSource, ResolvedProject } from "@nocad/intent-core";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type OnSelectionChangeFunc,
  useUpdateNodeInternals,
  type Viewport,
  type XYPosition
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Dispatch, SetStateAction } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Panel } from "./panel";
import { reconcileControlledSelection } from "./selection-reconciliation";
import {
  providerRequirementHandlesForNode,
  providerRequirementTargetHandle,
  type ProviderRequirementHandle
} from "./provider-requirement-handles";

type NodePositions = Record<string, XYPosition>;

type ComponentTemplate = {
  description?: string;
  id: string;
  label: string;
};

type IntentNodeData = Record<string, unknown> & {
  connectable: boolean;
  details: string[];
  physicalConnectable: boolean;
  providerRequirements: ProviderRequirementHandle[];
  subtitle: string;
  title: string;
  tone: "default" | "function" | "rail" | "warning";
};

type IntentFlowNode = Node<IntentNodeData, "intent">;

const defaultViewport: Viewport = {
  x: 0,
  y: 0,
  zoom: 1
};

const maxNodeDetailRows = 4;
const pointerIntentThreshold = 8;
const authoredNetSourceHandle = "authored-net-source";
const authoredNetTargetHandle = "authored-net-target";

export function IntentGraphView({
  catalog,
  connectionFeedback,
  componentTemplates,
  className,
  fitViewOnInit,
  graphRevision,
  isValidConnection,
  onAddComponent,
  onCanvasPaneClick,
  onConnectNodes,
  onDismissConnectionFeedback,
  onInvalidConnection,
  onPositionsChange,
  onRemoveSelection,
  onSelectedEdgeChange,
  onSelectedNodeChange,
  positions,
  resolved,
  selectedEdgeId,
  selectedNodeId,
  source
}: {
  catalog: DefinitionCatalog;
  className?: string;
  connectionFeedback?: string;
  componentTemplates: ComponentTemplate[];
  fitViewOnInit?: boolean;
  graphRevision: number;
  isValidConnection: (connection: Connection | Edge) => boolean;
  onAddComponent: (template: string) => void;
  onCanvasPaneClick?: () => void;
  onConnectNodes: (connection: Connection) => void;
  onDismissConnectionFeedback: () => void;
  onInvalidConnection: (sourceNodeId: string, targetNodeId: string, targetHandle?: string | null) => void;
  onPositionsChange: Dispatch<SetStateAction<NodePositions>>;
  onRemoveSelection: (selection: { edgeIds: string[]; nodeIds: string[] }) => void;
  onSelectedEdgeChange: (edgeId: string | undefined) => void;
  onSelectedNodeChange: (nodeId: string | undefined) => void;
  positions: NodePositions;
  resolved: ResolvedProject;
  selectedEdgeId?: string;
  selectedNodeId?: string;
  source: ProjectSource;
}) {
  const [flowReady, setFlowReady] = useState(false);
  const flowContainerRef = useRef<HTMLDivElement>(null);
  const flowModel = useMemo(
    () => buildFlowModel(source, resolved, positions, catalog, selectedNodeId, selectedEdgeId),
    [catalog, positions, resolved, selectedEdgeId, selectedNodeId, source]
  );
  const [flowNodes, setFlowNodes] = useState<IntentFlowNode[]>(flowModel.nodes);
  const [flowEdges, setFlowEdges] = useState<Edge[]>(flowModel.edges);
  const previousGraphRevisionRef = useRef(graphRevision);
  const localSelectionRef = useRef({
    edgeIds: selectedEdgeId ? [selectedEdgeId] : [],
    nodeIds: selectedNodeId ? [selectedNodeId] : []
  });
  const selectedNodeIds = flowNodes.filter((node) => node.selected).map((node) => node.id);
  const selectedEdgeIds = uniqueStrings(
    flowEdges
      .filter((edge) => edge.selected && edge.deletable !== false)
      .map(flowEdgeSourceId)
  );
  const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;

  useEffect(() => {
    const shouldResetGraphState = previousGraphRevisionRef.current !== graphRevision;
    const controlledSelection = selectedEdgeId
      ? `edge:${selectedEdgeId}`
      : selectedNodeId
        ? `node:${selectedNodeId}`
        : undefined;
    const localSelection = [
      ...localSelectionRef.current.nodeIds.map((id) => `node:${id}`),
      ...localSelectionRef.current.edgeIds.map((id) => `edge:${id}`)
    ];
    const reconciledSelection = shouldResetGraphState
      ? new Set(controlledSelection ? [controlledSelection] : [])
      : reconcileControlledSelection(localSelection, controlledSelection);
    const reconciledNodeIds = new Set(
      [...reconciledSelection].filter((id) => id.startsWith("node:")).map((id) => id.slice(5))
    );
    const reconciledEdgeIds = new Set(
      [...reconciledSelection].filter((id) => id.startsWith("edge:")).map((id) => id.slice(5))
    );

    previousGraphRevisionRef.current = graphRevision;
    localSelectionRef.current = {
      edgeIds: [...reconciledEdgeIds],
      nodeIds: [...reconciledNodeIds]
    };
    setFlowNodes((currentNodes) =>
      reconcileNodes(currentNodes, flowModel.nodes, shouldResetGraphState, reconciledNodeIds)
    );
    setFlowEdges((currentEdges) =>
      reconcileEdges(currentEdges, flowModel.edges, shouldResetGraphState, reconciledEdgeIds)
    );
  }, [flowModel.edges, flowModel.nodes, graphRevision, selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    const container = flowContainerRef.current;

    if (!container) {
      return undefined;
    }

    const updateReady = () => setFlowReady(container.clientWidth > 0 && container.clientHeight > 0);
    const resizeObserver = new ResizeObserver(updateReady);

    updateReady();
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, []);

  const updateSelection = useCallback<OnSelectionChangeFunc<IntentFlowNode, Edge>>(({ edges, nodes }) => {
    const nextNodeIds = nodes.map((node) => node.id);
    const nextEdgeIds = uniqueStrings(
      edges.filter((edge) => edge.deletable !== false).map(flowEdgeSourceId)
    );
    localSelectionRef.current = { edgeIds: nextEdgeIds, nodeIds: nextNodeIds };

    if (nextEdgeIds.length > 0) {
      onSelectedEdgeChange(nextEdgeIds[0]);
      onSelectedNodeChange(undefined);
    } else if (nextNodeIds.length > 0) {
      onSelectedEdgeChange(undefined);
      onSelectedNodeChange(nextNodeIds[0]);
    } else {
      onSelectedEdgeChange(undefined);
      onSelectedNodeChange(undefined);
    }
  }, [onSelectedEdgeChange, onSelectedNodeChange]);

  const updateNodes = useCallback((changes: NodeChange<IntentFlowNode>[]) => {
    setFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  }, []);

  const updateEdges = useCallback((changes: EdgeChange<Edge>[]) => {
    setFlowEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
  }, []);

  const clearSelection = useCallback(() => {
    localSelectionRef.current = { edgeIds: [], nodeIds: [] };
    setFlowEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
    setFlowNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: false })));
    onSelectedEdgeChange(undefined);
    onSelectedNodeChange(undefined);
    onCanvasPaneClick?.();
  }, [onCanvasPaneClick, onSelectedEdgeChange, onSelectedNodeChange]);

  const commitNodePosition = useCallback((node: IntentFlowNode) => {
    onPositionsChange((currentPositions) => ({
      ...currentPositions,
      [node.id]: node.position
    }));
  }, [onPositionsChange]);

  const deleteSelection = useCallback(() => {
    if (!hasSelection) {
      return;
    }

    onRemoveSelection({ edgeIds: selectedEdgeIds, nodeIds: selectedNodeIds });
    localSelectionRef.current = { edgeIds: [], nodeIds: [] };
    onSelectedEdgeChange(undefined);
    onSelectedNodeChange(undefined);
  }, [hasSelection, onRemoveSelection, onSelectedEdgeChange, onSelectedNodeChange, selectedEdgeIds, selectedNodeIds]);

  const removeDeletedSelection = useCallback(({ edges, nodes }: { edges: Edge[]; nodes: IntentFlowNode[] }) => {
    onRemoveSelection({
      edgeIds: uniqueStrings(edges.filter((edge) => edge.deletable !== false).map(flowEdgeSourceId)),
      nodeIds: nodes.map((node) => node.id)
    });
    localSelectionRef.current = { edgeIds: [], nodeIds: [] };
    onSelectedEdgeChange(undefined);
    onSelectedNodeChange(undefined);
  }, [onRemoveSelection, onSelectedEdgeChange, onSelectedNodeChange]);

  const finishConnection = useCallback((_: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    if (connectionState.isValid === false && connectionState.fromNode && connectionState.toNode) {
      onInvalidConnection(connectionState.fromNode.id, connectionState.toNode.id, connectionState.toHandle?.id);
    }
  }, [onInvalidConnection]);

  return (
    <Panel className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-2">
        {componentTemplates.map((template) => (
          <button
            className="h-7 rounded-md border border-border px-2.5 text-xs font-medium"
            key={template.id}
            onClick={() => onAddComponent(template.id)}
            title={template.description}
            type="button"
          >
            Add {template.label}
          </button>
        ))}
        <button
          className="h-7 rounded-md border border-border px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasSelection}
          onClick={deleteSelection}
          type="button"
        >
          Delete selection
        </button>
      </div>
      {connectionFeedback ? (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          <span>{connectionFeedback}</span>
          <button
            className="shrink-0 rounded-sm px-1.5 py-0.5 font-medium hover:bg-destructive/10"
            onClick={onDismissConnectionFeedback}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div
        className="h-full min-h-0 flex-1 overflow-hidden rounded-b-md bg-muted/30"
        ref={flowContainerRef}
        style={{ height: "100%", width: "100%" }}
      >
        {flowReady ? (
          <ReactFlow<IntentFlowNode, Edge>
            className="intent-flow"
            colorMode="system"
            connectionDragThreshold={pointerIntentThreshold}
            defaultViewport={defaultViewport}
            deleteKeyCode={["Backspace", "Delete"]}
            edges={flowEdges}
            edgesFocusable
            elementsSelectable
            fitView={fitViewOnInit}
            fitViewOptions={{ padding: 0.08 }}
            key={graphRevision}
            isValidConnection={isValidConnection}
            nodes={flowNodes}
            nodesFocusable
            nodeTypes={nodeTypes}
            nodeClickDistance={pointerIntentThreshold}
            nodeDragThreshold={pointerIntentThreshold}
            onConnect={onConnectNodes}
            onConnectEnd={finishConnection}
            onDelete={removeDeletedSelection}
            onEdgesChange={updateEdges}
            onNodeDragStop={(_, node) => commitNodePosition(node)}
            onNodesChange={updateNodes}
            onPaneClick={clearSelection}
            onSelectionChange={updateSelection}
            paneClickDistance={pointerIntentThreshold}
            panOnScroll
          >
            <Background color="var(--border)" gap={18} />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>
        ) : null}
      </div>
    </Panel>
  );
}

function reconcileNodes(
  currentNodes: IntentFlowNode[],
  nextNodes: IntentFlowNode[],
  resetGraphState: boolean,
  selectedIds: ReadonlySet<string>
) {
  if (resetGraphState) {
    return nextNodes.map((node) => ({ ...node, selected: selectedIds.has(node.id) }));
  }

  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id);

    return currentNode
      ? {
          ...nextNode,
          dragging: currentNode.dragging,
          position: currentNode.position,
          selected: selectedIds.has(nextNode.id)
        }
      : nextNode;
  });
}

function reconcileEdges(
  currentEdges: Edge[],
  nextEdges: Edge[],
  resetGraphState: boolean,
  selectedIds: ReadonlySet<string>
) {
  if (resetGraphState) {
    return nextEdges.map((edge) => ({ ...edge, selected: selectedIds.has(flowEdgeSourceId(edge)) }));
  }

  const currentById = new Map(currentEdges.map((edge) => [edge.id, edge]));

  return nextEdges.map((nextEdge) => {
    const currentEdge = currentById.get(nextEdge.id);

    return currentEdge
      ? {
          ...nextEdge,
          selected: selectedIds.has(flowEdgeSourceId(nextEdge))
        }
      : nextEdge;
  });
}

const IntentGraphNode = memo(function IntentGraphNode({ data, id, isConnectable, selected }: NodeProps<IntentFlowNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const requirementHandleSignature = data.providerRequirements
    .map((requirement) => `${requirement.handleId}:${requirement.connectedEdgeId ?? "open"}`)
    .join("|");

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, requirementHandleSignature, updateNodeInternals]);

  return (
    <div
      className={cn(
        "relative w-64 rounded-md border bg-card p-3 text-card-foreground transition-[border-color,box-shadow]",
        data.tone === "warning" &&
          "border-chart-4 shadow-[0_8px_24px_color-mix(in_oklab,var(--chart-4)_18%,transparent)]",
        data.tone === "function" && "border-chart-1",
        data.tone === "rail" && "border-chart-2",
        data.tone === "default" && "border-border",
        selected &&
          "border-chart-1 shadow-[0_0_0_3px_color-mix(in_oklab,var(--chart-1)_55%,transparent),0_0_0_7px_color-mix(in_oklab,var(--chart-1)_18%,transparent),0_18px_36px_color-mix(in_oklab,var(--chart-1)_24%,transparent)]"
      )}
      data-selected={selected ? "true" : "false"}
    >
      {selected ? (
        <span className="pointer-events-none absolute -right-2 -top-2 size-4 rounded-full border-2 border-background bg-chart-1 shadow-[0_0_0_3px_color-mix(in_oklab,var(--chart-1)_35%,transparent)]" />
      ) : null}

      {data.connectable ? (
        <>
          {data.providerRequirements.length === 0 ? (
            <Handle
              className="!size-3 !border-2 !border-background !bg-foreground"
              isConnectable={isConnectable}
              position={Position.Left}
              type="target"
            />
          ) : null}
          <Handle
            className="!size-3 !border-2 !border-background !bg-foreground"
            isConnectable={isConnectable}
            position={Position.Right}
            type="source"
          />
        </>
      ) : null}
      {data.physicalConnectable ? (
        <>
          <Handle
            className="!size-2.5 !border-2 !border-background !bg-chart-2"
            id={authoredNetTargetHandle}
            isConnectable={false}
            position={Position.Top}
            type="target"
          />
          <Handle
            className="!size-2.5 !border-2 !border-background !bg-chart-2"
            id={authoredNetSourceHandle}
            isConnectable={false}
            position={Position.Bottom}
            type="source"
          />
        </>
      ) : null}

      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{data.title}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{data.subtitle}</div>
        </div>
        <span
          className={
            data.tone === "warning"
              ? "mt-1 size-2 shrink-0 rounded-full bg-chart-4"
              : data.tone === "function"
                ? "mt-1 size-2 shrink-0 rounded-full bg-chart-1"
                : data.tone === "rail"
                  ? "mt-1 size-2 shrink-0 rounded-full bg-chart-2"
                  : "mt-1 size-2 shrink-0 rounded-full bg-foreground"
          }
        />
      </div>
      <div className="mt-3 grid min-w-0 gap-1">
        {data.details.map((detail) => (
          <div
            className="min-w-0 truncate rounded-sm bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
            key={detail}
            title={detail}
          >
            {detail}
          </div>
        ))}
      </div>
      {data.providerRequirements.length > 0 ? (
        <div className="mt-3 grid gap-1.5 border-t border-border pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Requirements</div>
          {data.providerRequirements.map((requirement) => (
            <div
              className="relative flex min-h-7 items-center justify-between gap-2 rounded-sm bg-muted px-2 py-1 text-xs"
              data-provider-requirement={requirement.port}
              key={requirement.handleId}
              title={`${requirement.label}: ${requirement.acceptedContracts.join(" or ")}`}
            >
              <Handle
                aria-label={`Connect ${requirement.label}`}
                className={cn(
                  "!-left-[17px] !top-1/2 !size-3 !border-2",
                  requirement.connectedEdgeId
                    ? "!border-background !bg-chart-2"
                    : "!border-foreground !bg-background"
                )}
                id={requirement.handleId}
                isConnectable={isConnectable && !requirement.connectedEdgeId}
                position={Position.Left}
                type="target"
              />
              <span className="min-w-0 truncate font-medium">{requirement.label}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {requirement.connectedEdgeId ? "Connected" : requirement.optional ? "Optional" : "Required"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

const nodeTypes = {
  intent: IntentGraphNode
} satisfies NodeTypes;

function buildFlowModel(
  source: ProjectSource,
  resolved: ResolvedProject,
  positions: NodePositions,
  catalog: DefinitionCatalog,
  selectedNodeId?: string,
  selectedEdgeId?: string
): { edges: Edge[]; nodes: IntentFlowNode[] } {
  const reservations = collectReservations(source);
  const providerRequirementsByNode = new Map(
    source.nodes.map((node) => [node.id, providerRequirementHandlesForNode(source, node, catalog)])
  );

  const nodes: IntentFlowNode[] = source.nodes.map((node, index) => {
    const tone =
      node.kind === "component" && reservations.has(node.id)
        ? "warning"
        : node.kind === "powerDomain"
          ? "rail"
          : node.kind === "intent.function"
            ? "function"
            : "default";

    return {
      id: node.id,
      data: {
        connectable: node.kind === "component" || node.kind === "intent.function",
        details: nodeDetails(node, source.edges, reservations.get(node.id) ?? []),
        physicalConnectable: node.kind === "component" || node.kind === "powerDomain",
        providerRequirements: providerRequirementsByNode.get(node.id) ?? [],
        subtitle: nodeSubtitle(node),
        title: node.label ?? humanKind(node),
        tone
      },
      deletable: true,
      position: positions[node.id] ?? { x: 120 + index * 300, y: 160 },
      selected: node.id === selectedNodeId,
      type: "intent"
    };
  });

  const intentEdges: Edge[] = source.edges.flatMap((edge) => {
    if (edge.kind !== "intent.connection" && edge.kind !== "intent.provides" && edge.kind !== "intent.exposes") {
      return [];
    }

    const choice =
      edge.kind === "intent.connection"
        ? resolved.resolvedChoices.find((resolvedChoice) => resolvedChoice.sourceEdge === edge.id)
        : undefined;
    const edgeLabel = edge.label ?? edge.role ?? "Connection";
    const modeLabel =
      edge.kind === "intent.connection"
        ? choice?.strategy
        : edge.kind === "intent.provides"
          ? edge.strategy?.providerMode
          : undefined;
    const stroke = edge.kind === "intent.provides" ? "var(--chart-1)" : "var(--foreground)";

    return [
      {
        data: { sourceEdgeId: edge.id },
        id: edge.id,
        deletable: true,
        focusable: true,
        label: modeLabel ? `${edgeLabel} / ${modeLabel}` : edgeLabel,
        markerEnd: {
          type: MarkerType.ArrowClosed
        },
        selected: edge.id === selectedEdgeId,
        source: edge.from.node,
        style: {
          stroke,
          strokeWidth: 2
        },
        target: edge.to.node,
        targetHandle:
          edge.kind === "intent.connection"
            ? providerRequirementTargetHandle(source, edge, catalog)
            : undefined,
        type: "smoothstep"
      }
    ];
  });
  const authoredNetEdges: Edge[] = source.edges.flatMap((edge) => {
    if (edge.kind !== "net.authored") return [];
    const endpoints = [...edge.endpoints].sort(compareEndpoint);
    const root = endpoints[0];
    if (!root) return [];

    return endpoints.slice(1).map((endpoint, index) => ({
      data: { sourceEdgeId: edge.id },
      deletable: true,
      focusable: true,
      id: `authored-net/${encodeURIComponent(edge.id)}/${encodeURIComponent(endpointIdentity(endpoint))}`,
      label: index === 0 ? edge.name : undefined,
      selected: edge.id === selectedEdgeId,
      source: root.node,
      sourceHandle: authoredNetSourceHandle,
      style: {
        stroke: edge.boardKind === "power" ? "var(--chart-2)" : "var(--foreground)",
        strokeDasharray: "5 4",
        strokeWidth: edge.boardKind === "highSpeed" ? 2 : 1.5
      },
      target: endpoint.node,
      targetHandle: authoredNetTargetHandle,
      type: "straight"
    }));
  });

  return {
    edges: [...intentEdges, ...authoredNetEdges],
    nodes
  };
}

function compareEndpoint(
  left: { node: string; pin?: string; port?: string },
  right: { node: string; pin?: string; port?: string }
) {
  return left.node.localeCompare(right.node) ||
    (left.pin ?? "").localeCompare(right.pin ?? "") ||
    (left.port ?? "").localeCompare(right.port ?? "");
}

function endpointIdentity(endpoint: { node: string; pin?: string; port?: string }) {
  return `${endpoint.node}\u0000${endpoint.pin ?? ""}\u0000${endpoint.port ?? ""}`;
}

function flowEdgeSourceId(edge: Edge) {
  const sourceEdgeId = (edge.data as { sourceEdgeId?: unknown } | undefined)?.sourceEdgeId;
  return typeof sourceEdgeId === "string" ? sourceEdgeId : edge.id;
}

function nodeSubtitle(node: ProjectNode) {
  if (node.kind === "powerDomain") {
    return "power domain";
  }

  if (node.kind === "intent.function") {
    return node.function.split(":").pop() ?? node.function;
  }

  return node.component.split(":").pop() ?? node.component;
}

function nodeDetails(
  node: ProjectNode,
  sourceEdges: ProjectSource["edges"],
  reservations: string[]
) {
  if (node.kind === "powerDomain") {
    const authoredNets = authoredNetDetails(node, sourceEdges);
    return [`voltage ${node.voltage}`, ...authoredNets].slice(0, maxNodeDetailRows);
  }

  if (node.kind === "intent.function") {
    const enabledFeatures = Object.entries(node.include ?? {})
      .filter(([, value]) => Boolean(value))
      .map(([feature]) => `feature ${feature}`);

    return enabledFeatures.length > 0 ? enabledFeatures.slice(0, 4) : ["waiting for provider"];
  }

  const sourceIntentLines = [...sourceIntentDetails(node, sourceEdges), ...authoredNetDetails(node, sourceEdges)];
  const detailLines = uniqueStrings([...reservationDetails(reservations), ...sourceIntentLines]);

  return detailLines.length > 0 ? capDetailLines(detailLines) : ["no connections"];
}

function authoredNetDetails(node: ProjectNode, sourceEdges: ProjectSource["edges"]) {
  return sourceEdges.flatMap((edge) =>
    edge.kind === "net.authored" && edge.endpoints.some((endpoint) => endpoint.node === node.id)
      ? [`net ${edge.name}`]
      : []
  );
}

function capDetailLines(lines: string[]) {
  if (lines.length <= maxNodeDetailRows) {
    return lines;
  }

  return [...lines.slice(0, maxNodeDetailRows - 1), `+${lines.length - maxNodeDetailRows + 1} more`];
}

function sourceIntentDetails(node: ProjectNode, sourceEdges: ProjectSource["edges"]) {
  return sourceEdges.flatMap((edge) => {
    if (edge.kind === "intent.provides") {
      if (edge.from.node === node.id) {
        return [`provides ${humanDetailLabel(edge.from.port ?? "source")}`];
      }

      if (edge.to.node === node.id) {
        return [`provider ${humanDetailLabel(edge.to.port ?? "source")}`];
      }
    }

    if (edge.kind === "intent.exposes") {
      if (edge.from.node === node.id) {
        return [`connector ${humanDetailLabel(edge.from.port ?? "connector")}`];
      }

      if (edge.to.node === node.id) {
        return [`exposes ${humanDetailLabel(edge.to.port ?? "connector")}`];
      }
    }

    if (edge.kind === "intent.connection") {
      if (edge.from.node === node.id) {
        return [`connects to ${humanDetailLabel(edge.from.port ?? "connection")}`];
      }

      if (edge.to.node === node.id) {
        return [`connects to ${humanDetailLabel(edge.to.port ?? "connection")}`];
      }
    }

    return [];
  });
}

function reservationDetails(reservations: string[]) {
  if (reservations.length === 0) {
    return [];
  }

  return [reservations.length === 1 ? "manual pin reservation" : `${reservations.length} manual pin reservations`];
}

function humanDetailLabel(value: string) {
  return value.replaceAll("_", " ");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function collectReservations(source: ProjectSource) {
  const reservations = new Map<string, string[]>();

  for (const edge of source.edges) {
    if (edge.kind !== "net.binding") {
      continue;
    }

    for (const binding of Object.values(edge.bindings)) {
      for (const endpoint of Object.values(binding)) {
        if (!endpoint?.pin) {
          continue;
        }

        const lines = reservations.get(endpoint.node) ?? [];
        lines.push(`reserved ${endpoint.pin}`);
        reservations.set(endpoint.node, lines);
      }
    }
  }

  return reservations;
}

function humanKind(node: ProjectNode) {
  if (node.kind === "powerDomain") {
    return "Power domain";
  }

  if (node.kind === "intent.function") {
    return "Function";
  }

  return "Component";
}
