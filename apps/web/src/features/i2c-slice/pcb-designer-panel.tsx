import { applyBoardComponentPlacement, buildBoardProjection } from "@nocad/intent-core";
import type {
  BoardComponentPlacement,
  BoardProjection,
  BoardRatsnestEdge,
  ProjectSource,
  ResolvedProject
} from "@nocad/intent-core";
import type { PointerEvent, ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Panel } from "./panel";

const HdmiBreakoutFixturePanel = lazy(async () => ({
  default: (await import("../kicad-fixture/hdmi-breakout-fixture-panel")).HdmiBreakoutFixturePanel
}));

export type { BoardComponentPlacement };

type BoardSelection = {
  id: string;
  kind: "component" | "ratsnest";
};

type BoardPlacementPreview = BoardComponentPlacement & {
  componentId: string;
};

type SelectedBoardObject =
  | {
      item: BoardProjection["components"][number];
      kind: "component";
    }
  | {
      item: BoardRatsnestEdge;
      kind: "ratsnest";
    }
  | undefined;

export function PcbDesignerPanel({
  onSetComponentPlacement,
  resolved,
  source
}: {
  onSetComponentPlacement: (nodeId: string, placement: BoardComponentPlacement) => void;
  resolved: ResolvedProject;
  source: ProjectSource;
}) {
  const [boardView, setBoardView] = useState<"fixture" | "intent">("intent");
  const projection = useMemo(() => buildBoardProjection(source, resolved), [resolved, source]);
  const [placementPreview, setPlacementPreview] = useState<BoardPlacementPreview>();
  const visibleProjection = useMemo(
    () => applyPlacementPreview(projection, placementPreview),
    [placementPreview, projection]
  );
  const [selection, setSelection] = useState<BoardSelection>();
  const selectedObject = useMemo(() => selectedBoardObject(visibleProjection, selection), [selection, visibleProjection]);
  const select = useCallback((nextSelection: BoardSelection | undefined) => {
    setSelection((current) =>
      current?.kind === nextSelection?.kind && current?.id === nextSelection?.id ? current : nextSelection
    );
  }, []);
  const commitComponentPlacement = useCallback((componentId: string, placement: BoardComponentPlacement) => {
    onSetComponentPlacement(componentId, placement);
    setPlacementPreview(undefined);
  }, [onSetComponentPlacement]);
  const rotateSelectedComponent = useCallback((component: BoardProjection["components"][number]) => {
    onSetComponentPlacement(component.id, {
      rotationDeg: normalizeRotation(component.rotationDeg + 90),
      xMm: component.xMm,
      yMm: component.yMm
    });
  }, [onSetComponentPlacement]);

  if (boardView === "fixture") {
    return (
      <Suspense fallback={<FixtureLoadingPanel />}>
        <HdmiBreakoutFixturePanel onShowIntentBoard={() => setBoardView("intent")} />
      </Suspense>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">PCB designer</h2>
            <p className="text-xs text-muted-foreground">Drag footprints to author board placement</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge>{formatMm(visibleProjection.board.widthMm)} x {formatMm(visibleProjection.board.heightMm)}</Badge>
            <Badge>{visibleProjection.board.layers} layers</Badge>
            <Badge>{visibleProjection.stats.unroutedNets} ratsnest</Badge>
            <button
              className="h-7 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted"
              onClick={() => setBoardView("fixture")}
              type="button"
            >
              KiCad fixture
            </button>
          </div>
        </div>
        <BoardCanvas
          onCommitComponentPlacement={commitComponentPlacement}
          onPreviewComponentPlacement={setPlacementPreview}
          onSelect={select}
          projection={visibleProjection}
          selection={selection}
        />
      </Panel>

      <Panel className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Board obligations</h2>
          <p className="text-xs text-muted-foreground">What layout still needs to satisfy</p>
        </div>
        <div className="grid content-start gap-3 overflow-auto p-3">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Components" value={visibleProjection.stats.totalComponents.toString()} />
            <Stat label="Placed" value={visibleProjection.stats.placedComponents.toString()} />
            <Stat label="Unrouted" value={visibleProjection.stats.unroutedNets.toString()} />
            <Stat label="DRC" tone={visibleProjection.stats.drcViolations > 0 ? "error" : "default"} value={visibleProjection.stats.drcViolations.toString()} />
          </div>

          <SelectionInspector onRotateComponent={rotateSelectedComponent} selectedObject={selectedObject} />

          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Footprints</h3>
            {visibleProjection.components.length > 0 ? (
              visibleProjection.components.map((component) => (
                <button
                  className={selectableRowClassName(selection?.kind === "component" && selection.id === component.id)}
                  key={component.id}
                  onClick={() => select({ id: component.id, kind: "component" })}
                  type="button"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{component.label}</span>
                    <span className={componentStatusClassName(component)}>
                      {component.violations.length > 0 ? "VIOLATION" : component.placed ? "PLACED" : "PROJECTED"}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {formatMm(component.widthMm)} x {formatMm(component.heightMm)} at {formatMm(component.xMm)}, {formatMm(component.yMm)}
                  </div>
                </button>
              ))
            ) : (
              <EmptyState text="Add components in the Graph tab to see footprints." />
            )}
          </div>

          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Open obligations</h3>
            {visibleProjection.obligations.length > 0 ? (
              visibleProjection.obligations.map((obligation) => (
                <button
                  className={obligationRowClassName(
                    selection?.kind === obligation.target.kind && selection.id === obligation.target.id,
                    obligation.severity
                  )}
                  key={obligation.id}
                  onClick={() => select(obligation.target)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{obligation.message}</span>
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {obligation.kind}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{obligation.sourceId}</div>
                </button>
              ))
            ) : (
              <EmptyState text="No board obligations for the current projection." />
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function FixtureLoadingPanel() {
  return (
    <Panel className="grid h-full place-items-center">
      <div className="text-sm text-muted-foreground">Loading content-pinned KiCad fixture...</div>
    </Panel>
  );
}

function SelectionInspector({
  onRotateComponent,
  selectedObject
}: {
  onRotateComponent: (component: BoardProjection["components"][number]) => void;
  selectedObject: SelectedBoardObject;
}) {
  if (!selectedObject) {
    return <EmptyState text="Select a footprint, ratsnest line, or obligation to inspect it." />;
  }

  if (selectedObject.kind === "component") {
    const component = selectedObject.item;

    return (
      <div className="grid gap-2 rounded-md border border-chart-1/40 bg-background px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{component.label}</h3>
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            FOOTPRINT
          </span>
        </div>
        <InspectorField label="Component" value={component.component} />
        <InspectorField label="Package" value={component.package ?? "projected"} />
        <InspectorField label="Size" value={`${formatMm(component.widthMm)} x ${formatMm(component.heightMm)}`} />
        <InspectorField label="Position" value={`${formatMm(component.xMm)}, ${formatMm(component.yMm)}`} />
        <InspectorField label="Placement" value={component.placed ? "authored" : "projected hint"} />
        <InspectorField
          label="DRC"
          value={component.violations.length > 0 ? `${component.violations.length} violation(s)` : "clean"}
        />
        <button
          className="h-8 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
          onClick={() => onRotateComponent(component)}
          type="button"
        >
          Rotate 90°
        </button>
      </div>
    );
  }

  const edge = selectedObject.item;

  return (
    <div className="grid gap-2 rounded-md border border-chart-1/40 bg-background px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{edge.name}</h3>
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
          {edge.kind}
        </span>
      </div>
      <InspectorField label="Signal" value={edge.signal} />
      <InspectorField label="Contract" value={edge.contract ?? "generated"} />
      <InspectorField label="From" value={edge.fromNode} />
      <InspectorField label="To" value={edge.toNode} />
      <InspectorField label="Source edge" value={edge.sourceEdge} />
    </div>
  );
}

function BoardCanvas({
  onCommitComponentPlacement,
  onPreviewComponentPlacement,
  onSelect,
  projection,
  selection
}: {
  onCommitComponentPlacement: (componentId: string, placement: BoardComponentPlacement) => void;
  onPreviewComponentPlacement: (preview: BoardPlacementPreview | undefined) => void;
  onSelect: (selection: BoardSelection | undefined) => void;
  projection: BoardProjection;
  selection: BoardSelection | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<ComponentDragState | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;

    if (!canvas || !container) {
      return undefined;
    }

    const render = () => drawBoard(canvas, projection, selection);
    const resizeObserver = new ResizeObserver(render);

    render();
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [projection, selection]);

  const selectAtPointer = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;

    if (!canvas || !parent) {
      return;
    }

    const rect = parent.getBoundingClientRect();
    const transform = boardTransform(projection, rect.width, rect.height);
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const hit = hitTestBoard(projection, transform, pointer.x, pointer.y);

    onSelect(hit);
    onPreviewComponentPlacement(undefined);

    if (hit?.kind !== "component") {
      dragRef.current = undefined;
      return;
    }

    const component = projection.components.find((candidate) => candidate.id === hit.id);

    if (!component) {
      return;
    }

    const boardPoint = toBoard(transform, pointer.x, pointer.y);

    dragRef.current = {
      componentId: component.id,
      offsetX: component.xMm - boardPoint.xMm,
      offsetY: component.yMm - boardPoint.yMm,
      pointerId: event.pointerId,
      rotationDeg: component.rotationDeg
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [onPreviewComponentPlacement, onSelect, projection]);

  const updateDrag = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;

    if (!drag || !canvas || !parent || drag.pointerId !== event.pointerId) {
      return;
    }

    const component = projection.components.find((candidate) => candidate.id === drag.componentId);

    if (!component) {
      return;
    }

    const rect = parent.getBoundingClientRect();
    const transform = boardTransform(projection, rect.width, rect.height);
    const boardPoint = toBoard(transform, event.clientX - rect.left, event.clientY - rect.top);
    const placement = clampComponentPlacement(projection, component, {
      rotationDeg: drag.rotationDeg,
      xMm: boardPoint.xMm + drag.offsetX,
      yMm: boardPoint.yMm + drag.offsetY
    });

    drag.lastPlacement = placement;
    onPreviewComponentPlacement({ ...placement, componentId: drag.componentId });
  }, [onPreviewComponentPlacement, projection]);

  const commitDrag = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onPreviewComponentPlacement(undefined);

    if (drag.lastPlacement) {
      onCommitComponentPlacement(drag.componentId, drag.lastPlacement);
    }
  }, [onCommitComponentPlacement, onPreviewComponentPlacement]);

  const cancelDrag = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = undefined;
    onPreviewComponentPlacement(undefined);
  }, [onPreviewComponentPlacement]);

  return (
    <div className="relative min-h-0 overflow-hidden bg-muted/20">
      <canvas
        aria-label="PCB board projection"
        className="block size-full cursor-grab active:cursor-grabbing"
        onPointerCancel={cancelDrag}
        onPointerDown={selectAtPointer}
        onPointerMove={updateDrag}
        onPointerUp={commitDrag}
        ref={canvasRef}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
        Drag footprints to write layout. Click ratsnest lines or obligations to inspect them.
      </div>
    </div>
  );
}

function drawBoard(canvas: HTMLCanvasElement, projection: BoardProjection, selection: BoardSelection | undefined) {
  const parent = canvas.parentElement;

  if (!parent) {
    return;
  }

  const rect = parent.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const colors = canvasColors(canvas);
  const transform = boardTransform(projection, rect.width, rect.height);

  context.fillStyle = colors.background;
  context.fillRect(0, 0, rect.width, rect.height);

  drawGrid(context, projection, transform, colors);
  drawBoardOutline(context, projection, transform, colors);
  projection.ratsnest.forEach((edge) =>
    drawRatsnestEdge(context, edge, transform, colors, selection?.kind === "ratsnest" && selection.id === edge.id)
  );
  projection.components.forEach((component) =>
    drawComponent(context, component, transform, colors, selection?.kind === "component" && selection.id === component.id)
  );
}

function drawGrid(
  context: CanvasRenderingContext2D,
  projection: BoardProjection,
  transform: BoardTransform,
  colors: CanvasColors
) {
  context.save();
  context.strokeStyle = colors.border;
  context.globalAlpha = 0.26;
  context.lineWidth = 1;

  for (let x = 0; x <= projection.board.widthMm; x += 5) {
    const start = toCanvas(transform, x, 0);
    const end = toCanvas(transform, x, projection.board.heightMm);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  for (let y = 0; y <= projection.board.heightMm; y += 5) {
    const start = toCanvas(transform, 0, y);
    const end = toCanvas(transform, projection.board.widthMm, y);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  context.restore();
}

function drawBoardOutline(
  context: CanvasRenderingContext2D,
  projection: BoardProjection,
  transform: BoardTransform,
  colors: CanvasColors
) {
  const origin = toCanvas(transform, 0, 0);
  const far = toCanvas(transform, projection.board.widthMm, projection.board.heightMm);

  context.save();
  context.fillStyle = colors.card;
  context.strokeStyle = colors.foreground;
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(origin.x, origin.y, far.x - origin.x, far.y - origin.y, 12);
  context.fill();
  context.stroke();
  context.restore();
}

function drawRatsnestEdge(
  context: CanvasRenderingContext2D,
  edge: BoardRatsnestEdge,
  transform: BoardTransform,
  colors: CanvasColors,
  selected: boolean
) {
  const from = toCanvas(transform, edge.from.xMm, edge.from.yMm);
  const to = toCanvas(transform, edge.to.xMm, edge.to.yMm);

  context.save();
  context.strokeStyle = selected
    ? colors.selected
    : edge.kind === "highSpeed"
      ? colors.highSpeed
      : edge.kind === "power"
        ? colors.power
        : colors.signal;
  context.globalAlpha = selected ? 1 : edge.kind === "signal" ? 0.34 : 0.72;
  context.lineWidth = selected ? 3 : edge.kind === "highSpeed" ? 1.8 : 1.2;
  context.setLineDash(selected ? [] : [5, 5]);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}

function drawComponent(
  context: CanvasRenderingContext2D,
  component: BoardProjection["components"][number],
  transform: BoardTransform,
  colors: CanvasColors,
  selected: boolean
) {
  const center = toCanvas(transform, component.xMm, component.yMm);
  const width = component.widthMm * transform.scale;
  const height = component.heightMm * transform.scale;

  context.save();
  context.translate(center.x, center.y);
  context.rotate((component.rotationDeg * Math.PI) / 180);
  context.fillStyle = colors.componentFill;
  context.strokeStyle = component.violations.length > 0
    ? colors.drc
    : selected
      ? colors.selected
      : component.placed
        ? colors.foreground
        : colors.mutedForeground;
  context.lineWidth = selected ? 3 : component.placed ? 1.8 : 1.3;
  context.shadowBlur = selected || component.violations.length > 0 ? 16 : 0;
  context.shadowColor = component.violations.length > 0 ? colors.drc : selected ? colors.selected : "transparent";
  context.setLineDash(component.placed ? [] : [6, 4]);
  context.beginPath();
  context.roundRect(-width / 2, -height / 2, width, height, 8);
  context.fill();
  context.stroke();

  context.setLineDash([]);
  context.fillStyle = colors.foreground;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "600 12px Inter, ui-sans-serif, system-ui";
  context.fillText(component.refdesHint ?? component.label, 0, -5, Math.max(24, width - 8));
  context.fillStyle = colors.mutedForeground;
  context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillText(component.package ?? component.role ?? "component", 0, 10, Math.max(24, width - 8));
  context.restore();
}

type BoardTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

type ComponentDragState = {
  componentId: string;
  lastPlacement?: BoardComponentPlacement;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  rotationDeg: number;
};

type CanvasColors = {
  background: string;
  border: string;
  card: string;
  componentFill: string;
  drc: string;
  foreground: string;
  highSpeed: string;
  mutedForeground: string;
  power: string;
  selected: string;
  signal: string;
};

function boardTransform(projection: BoardProjection, canvasWidth: number, canvasHeight: number): BoardTransform {
  const padding = 42;
  const scale = Math.max(
    1,
    Math.min(
      (canvasWidth - padding * 2) / projection.board.widthMm,
      (canvasHeight - padding * 2) / projection.board.heightMm
    )
  );
  const renderedWidth = projection.board.widthMm * scale;
  const renderedHeight = projection.board.heightMm * scale;

  return {
    offsetX: (canvasWidth - renderedWidth) / 2,
    offsetY: (canvasHeight - renderedHeight) / 2,
    scale
  };
}

function toCanvas(transform: BoardTransform, xMm: number, yMm: number) {
  return {
    x: transform.offsetX + xMm * transform.scale,
    y: transform.offsetY + yMm * transform.scale
  };
}

function toBoard(transform: BoardTransform, x: number, y: number) {
  return {
    xMm: (x - transform.offsetX) / transform.scale,
    yMm: (y - transform.offsetY) / transform.scale
  };
}

function clampComponentPlacement(
  projection: BoardProjection,
  component: BoardProjection["components"][number],
  placement: BoardComponentPlacement
): BoardComponentPlacement {
  return {
    rotationDeg: normalizeRotation(placement.rotationDeg),
    xMm: clampCenter(placement.xMm, component.widthMm, projection.board.widthMm),
    yMm: clampCenter(placement.yMm, component.heightMm, projection.board.heightMm)
  };
}

function hitTestBoard(
  projection: BoardProjection,
  transform: BoardTransform,
  x: number,
  y: number
): BoardSelection | undefined {
  for (let index = projection.components.length - 1; index >= 0; index -= 1) {
    const component = projection.components[index];

    if (!component) {
      continue;
    }

    const center = toCanvas(transform, component.xMm, component.yMm);
    const width = component.widthMm * transform.scale;
    const height = component.heightMm * transform.scale;

    if (Math.abs(x - center.x) <= width / 2 + 4 && Math.abs(y - center.y) <= height / 2 + 4) {
      return { id: component.id, kind: "component" };
    }
  }

  for (let index = projection.ratsnest.length - 1; index >= 0; index -= 1) {
    const edge = projection.ratsnest[index];

    if (!edge) {
      continue;
    }

    const from = toCanvas(transform, edge.from.xMm, edge.from.yMm);
    const to = toCanvas(transform, edge.to.xMm, edge.to.yMm);

    if (distanceToSegment({ x, y }, from, to) <= 7) {
      return { id: edge.id, kind: "ratsnest" };
    }
  }

  return undefined;
}

function distanceToSegment(point: BoardCanvasPoint, start: BoardCanvasPoint, end: BoardCanvasPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projected = {
    x: start.x + t * dx,
    y: start.y + t * dy
  };

  return Math.hypot(point.x - projected.x, point.y - projected.y);
}

type BoardCanvasPoint = {
  x: number;
  y: number;
};

function applyPlacementPreview(
  projection: BoardProjection,
  preview: BoardPlacementPreview | undefined
): BoardProjection {
  if (!preview) {
    return projection;
  }

  return applyBoardComponentPlacement(projection, preview.componentId, preview);
}

function clampCenter(value: number, size: number, boardSize: number) {
  const margin = Math.min(1, boardSize / 20);
  const min = size / 2 + margin;
  const max = boardSize - size / 2 - margin;

  if (max < min) {
    return boardSize / 2;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeRotation(value: number) {
  return ((value % 360) + 360) % 360;
}

function canvasColors(canvas: HTMLCanvasElement): CanvasColors {
  const styles = getComputedStyle(canvas);
  const color = (name: string) => styles.getPropertyValue(name).trim();

  return {
    background: color("--background"),
    border: color("--border"),
    card: color("--card"),
    componentFill: color("--secondary"),
    drc: color("--destructive"),
    foreground: color("--foreground"),
    highSpeed: color("--chart-1"),
    mutedForeground: color("--muted-foreground"),
    power: color("--chart-2"),
    selected: color("--chart-1"),
    signal: color("--foreground")
  };
}

function Stat({ label, tone = "default", value }: { label: string; tone?: "default" | "error"; value: string }) {
  return (
    <div
      className={[
        "rounded-md border bg-background px-3 py-2",
        tone === "error" ? "border-destructive/50 text-destructive" : "border-border"
      ].join(" ")}
    >
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function InspectorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="break-all font-mono text-xs text-foreground">{value}</div>
    </div>
  );
}

function selectableRowClassName(selected: boolean) {
  return [
    "grid w-full gap-1 rounded-md border bg-background px-3 py-2 text-left transition-colors",
    selected ? "border-chart-1 shadow-[0_0_0_1px_var(--chart-1)]" : "border-border hover:bg-muted/60"
  ].join(" ");
}

function obligationRowClassName(selected: boolean, severity: "error" | "info" | "warning") {
  return [
    "grid w-full gap-1 rounded-md border bg-background px-3 py-2 text-left transition-colors",
    selected && "border-chart-1 shadow-[0_0_0_1px_var(--chart-1)]",
    !selected && severity === "error" && "border-destructive/50 hover:bg-destructive/5",
    !selected && severity !== "error" && "border-border hover:bg-muted/60"
  ]
    .filter(Boolean)
    .join(" ");
}

function componentStatusClassName(component: BoardProjection["components"][number]) {
  return [
    "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold",
    component.violations.length > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
  ].join(" ");
}

function selectedBoardObject(projection: BoardProjection, selection: BoardSelection | undefined): SelectedBoardObject {
  if (!selection) {
    return undefined;
  }

  if (selection.kind === "component") {
    const component = projection.components.find((candidate) => candidate.id === selection.id);

    return component ? { item: component, kind: "component" } : undefined;
  }

  const edge = projection.ratsnest.find((candidate) => candidate.id === selection.id);

  return edge ? { item: edge, kind: "ratsnest" } : undefined;
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-border bg-background px-2 py-1 font-mono">{children}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{text}</div>;
}

function formatMm(value: number) {
  return `${Number.isInteger(value) ? value.toString() : value.toFixed(1)}mm`;
}
