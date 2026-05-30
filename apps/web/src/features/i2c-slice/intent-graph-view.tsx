import type { ProjectNode, ProjectSource, ResolvedProject } from "@nocad/intent-core";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnSelectionChangeFunc,
  type Viewport,
  type XYPosition
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Dispatch, SetStateAction } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Panel, PanelHeader } from "./panel";

type NodePositions = Record<string, XYPosition>;

type ComponentTemplate = {
  id: string;
  label: string;
};

type IntentNodeData = Record<string, unknown> & {
  connectable: boolean;
  details: string[];
  generatedPowerTarget: boolean;
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

const pointerIntentThreshold = 8;

export function IntentGraphView({
  componentTemplates,
  className,
  graphRevision,
  onAddComponent,
  onConnectNodes,
  onPositionsChange,
  onRemoveEdges,
  onRemoveNodes,
  onSelectedEdgeChange,
  positions,
  resolved,
  source
}: {
  className?: string;
  componentTemplates: ComponentTemplate[];
  graphRevision: number;
  onAddComponent: (template: string) => void;
  onConnectNodes: (connection: Connection) => void;
  onPositionsChange: Dispatch<SetStateAction<NodePositions>>;
  onRemoveEdges: (edgeIds: string[]) => void;
  onRemoveNodes: (nodeIds: string[]) => void;
  onSelectedEdgeChange: (edgeId: string | undefined) => void;
  positions: NodePositions;
  resolved: ResolvedProject;
  source: ProjectSource;
}) {
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [flowReady, setFlowReady] = useState(false);
  const flowContainerRef = useRef<HTMLDivElement>(null);
  const flowModel = useMemo(() => buildFlowModel(source, resolved, positions), [positions, source, resolved]);
  const graphKey = useMemo(() => createGraphKey(source, graphRevision), [graphRevision, source]);
  const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;

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
    const nextEdgeIds = edges.filter((edge) => edge.deletable !== false).map((edge) => edge.id);

    setSelectedNodeIds((currentNodeIds) => (sameStringList(currentNodeIds, nextNodeIds) ? currentNodeIds : nextNodeIds));
    setSelectedEdgeIds((currentEdgeIds) => (sameStringList(currentEdgeIds, nextEdgeIds) ? currentEdgeIds : nextEdgeIds));
    if (nextEdgeIds.length > 0) {
      onSelectedEdgeChange(nextEdgeIds[0]);
    } else if (nextNodeIds.length > 0) {
      onSelectedEdgeChange(undefined);
    }
  }, [onSelectedEdgeChange]);

  const clearSelection = useCallback(() => {
    setSelectedEdgeIds([]);
    setSelectedNodeIds([]);
    onSelectedEdgeChange(undefined);
  }, [onSelectedEdgeChange]);

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

    if (selectedEdgeIds.length > 0) {
      onRemoveEdges(selectedEdgeIds);
    }
    if (selectedNodeIds.length > 0) {
      onRemoveNodes(selectedNodeIds);
    }
    onSelectedEdgeChange(undefined);
    setSelectedEdgeIds([]);
    setSelectedNodeIds([]);
  }, [hasSelection, onRemoveEdges, onRemoveNodes, onSelectedEdgeChange, selectedEdgeIds, selectedNodeIds]);

  const removeDeletedEdges = useCallback((deletedEdges: Edge[]) => {
    const deletableEdgeIds = deletedEdges.filter((edge) => edge.deletable !== false).map((edge) => edge.id);

    if (deletableEdgeIds.length > 0) {
      onRemoveEdges(deletableEdgeIds);
    }
    onSelectedEdgeChange(undefined);
    setSelectedEdgeIds([]);
  }, [onRemoveEdges, onSelectedEdgeChange]);

  const removeDeletedNodes = useCallback((deletedNodes: IntentFlowNode[]) => {
    onRemoveNodes(deletedNodes.map((node) => node.id));
    onSelectedEdgeChange(undefined);
    setSelectedEdgeIds([]);
    setSelectedNodeIds([]);
  }, [onRemoveNodes, onSelectedEdgeChange]);

  return (
    <Panel className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      <PanelHeader eyebrow="Source graph" title="Intent topology" />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {componentTemplates.map((template) => (
          <button
            className="h-8 rounded-md border border-border px-3 text-sm font-medium"
            key={template.id}
            onClick={() => onAddComponent(template.id)}
            type="button"
          >
            Add {template.label}
          </button>
        ))}
        <button
          className="h-8 rounded-md border border-border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasSelection}
          onClick={deleteSelection}
          type="button"
        >
          Delete selection
        </button>
      </div>
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
            defaultEdges={flowModel.edges}
            defaultNodes={flowModel.nodes}
            defaultViewport={defaultViewport}
            deleteKeyCode={["Backspace", "Delete"]}
            edgesFocusable
            elementsSelectable
            key={graphKey}
            nodesFocusable
            nodeTypes={nodeTypes}
            nodeClickDistance={pointerIntentThreshold}
            nodeDragThreshold={pointerIntentThreshold}
            onConnect={onConnectNodes}
            onEdgesDelete={removeDeletedEdges}
            onNodeDragStop={(_, node) => commitNodePosition(node)}
            onNodesDelete={removeDeletedNodes}
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

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createGraphKey(source: ProjectSource, revision: number) {
  return JSON.stringify({
    edges: source.edges.map((edge) => [
      edge.id,
      edge.kind,
      edge.label,
      edge.role,
      edge.kind === "intent.connection" ? edge.strategy?.pinAssignment : undefined,
      edge.kind === "intent.provides" ? edge.strategy?.providerMode : undefined,
      edge.kind === "intent.connection" || edge.kind === "intent.provides" ? edge.bindings : undefined
    ]),
    nodes: source.nodes.map((node) => [
      node.id,
      node.kind,
      node.label,
      node.role,
      node.kind === "intent.function" ? node.function : undefined,
      node.kind === "intent.function" ? node.include : undefined
    ]),
    revision
  });
}

const IntentGraphNode = memo(function IntentGraphNode({ data, isConnectable, selected }: NodeProps<IntentFlowNode>) {
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
          <Handle
            className="!size-3 !border-2 !border-background !bg-foreground"
            isConnectable={isConnectable}
            position={Position.Left}
            type="target"
          />
          <Handle
            className="!size-3 !border-2 !border-background !bg-foreground"
            isConnectable={isConnectable}
            position={Position.Right}
            type="source"
          />
        </>
      ) : null}

      {data.generatedPowerTarget ? (
        <Handle
          className="!size-3 !border-2 !border-background !bg-chart-2"
          id="power"
          isConnectable={false}
          position={Position.Top}
          type="target"
        />
      ) : null}

      {!data.connectable && data.tone === "rail" ? (
        <Handle
          className="!size-3 !border-2 !border-background !bg-chart-2"
          id="generated"
          isConnectable={false}
          position={Position.Bottom}
          type="source"
        />
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
    </div>
  );
});

const nodeTypes = {
  intent: IntentGraphNode
} satisfies NodeTypes;

function buildFlowModel(
  source: ProjectSource,
  resolved: ResolvedProject,
  positions: NodePositions
): { edges: Edge[]; nodes: IntentFlowNode[] } {
  const resolvedChoices = resolved.resolvedChoices;
  const reservations = collectReservations(source);
  const hasPullups = resolved.generated.some((item) => item.sourceMap.feature === "pullups");
  const pullupRail = source.nodes.find((node) => node.kind === "powerDomain" && node.role === "power_3v3");
  const pullupTargetIds = new Set(
    source.edges.flatMap((edge) =>
      edge.kind === "intent.connection" &&
      resolved.generated.some((item) => item.sourceMap.edge === edge.id && item.sourceMap.feature === "pullups")
        ? [edge.to.node]
        : []
    )
  );

  const nodes: IntentFlowNode[] = source.nodes.map((node, index) => {
    const tone =
      node.role === "mcu" && reservations.has(node.id)
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
        details: nodeDetails(node, source.edges, resolvedChoices, reservations.get(node.id) ?? []),
        generatedPowerTarget: hasPullups && pullupTargetIds.has(node.id),
        subtitle: nodeSubtitle(node),
        title: node.label ?? humanKind(node),
        tone
      },
      deletable: true,
      position: positions[node.id] ?? { x: 120 + index * 300, y: 160 },
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
        id: edge.id,
        deletable: true,
        focusable: true,
        label: modeLabel ? `${edgeLabel} / ${modeLabel}` : edgeLabel,
        markerEnd: {
          type: MarkerType.ArrowClosed
        },
        source: edge.from.node,
        style: {
          stroke,
          strokeWidth: 2
        },
        target: edge.to.node,
        type: "smoothstep"
      }
    ];
  });

  const generatedEdges: Edge[] =
    hasPullups && pullupRail
      ? [...pullupTargetIds].map((targetId) => ({
          id: `generated-pullups-${targetId}`,
          deletable: false,
          label: "pullups / 4.7k",
          markerEnd: {
            type: MarkerType.ArrowClosed
          },
          source: pullupRail.id,
          sourceHandle: "generated",
          style: {
            stroke: "var(--chart-2)",
            strokeDasharray: "6 4",
            strokeWidth: 2
          },
          target: targetId,
          targetHandle: "power",
          type: "smoothstep"
        }))
      : [];

  return {
    edges: [...intentEdges, ...generatedEdges],
    nodes
  };
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
  resolvedChoices: ResolvedProject["resolvedChoices"],
  reservations: string[]
) {
  if (node.kind === "powerDomain") {
    return [`voltage ${node.voltage}`];
  }

  if (node.kind === "intent.function") {
    const enabledFeatures = Object.entries(node.include ?? {})
      .filter(([, value]) => Boolean(value))
      .map(([feature]) => `feature ${feature}`);

    return enabledFeatures.length > 0 ? enabledFeatures.slice(0, 4) : ["waiting for provider"];
  }

  const bindingLines = resolvedChoices.flatMap((choice) =>
    Object.entries(choice.selected.bindings).flatMap(([signal, binding]) =>
      (["from", "to"] as const).flatMap((role) => {
        const endpoint = binding[role];

        return endpoint?.node === node.id && endpoint.pin ? [`${signal.toUpperCase()} ${endpoint.pin}`] : [];
      })
    )
  );
  const sourceIntentLines = bindingLines.length === 0 ? sourceIntentDetails(node, sourceEdges) : [];

  return [
    ...reservations,
    ...bindingLines,
    ...sourceIntentLines,
    ...(bindingLines.length === 0 && reservations.length === 0 && sourceIntentLines.length === 0 ? ["no connections"] : [])
  ];
}

function sourceIntentDetails(node: ProjectNode, sourceEdges: ProjectSource["edges"]) {
  return sourceEdges.flatMap((edge) => {
    if (edge.kind === "intent.provides") {
      if (edge.from.node === node.id) {
        return [`provides ${edge.from.port ?? "source"} / ${edge.strategy?.providerMode ?? "auto"}`];
      }

      if (edge.to.node === node.id) {
        return [`provider ${edge.to.port ?? "source"} / ${edge.strategy?.providerMode ?? "auto"}`];
      }
    }

    if (edge.kind === "intent.exposes") {
      if (edge.from.node === node.id) {
        return [`connector ${edge.from.port ?? "connector"}`];
      }

      if (edge.to.node === node.id) {
        return [`exposes ${edge.to.port ?? "connector"}`];
      }
    }

    if (edge.kind === "intent.connection") {
      if (edge.from.node === node.id) {
        return [`connects ${edge.from.port ?? "from"}`];
      }

      if (edge.to.node === node.id) {
        return [`connects ${edge.to.port ?? "to"}`];
      }
    }

    return [];
  });
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
