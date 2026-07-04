import { buildBoardProjection } from "@nocad/intent-core";
import type { BoardProjection, BoardRatsnestEdge, ProjectSource, ResolvedProject } from "@nocad/intent-core";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

import { Panel } from "./panel";

export function PcbDesignerPanel({ resolved, source }: { resolved: ResolvedProject; source: ProjectSource }) {
  const projection = useMemo(() => buildBoardProjection(source, resolved), [resolved, source]);

  return (
    <div className="grid h-full min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">PCB designer</h2>
            <p className="text-xs text-muted-foreground">Read-only board projection from intent and resolved nets</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge>{formatMm(projection.board.widthMm)} x {formatMm(projection.board.heightMm)}</Badge>
            <Badge>{projection.board.layers} layers</Badge>
            <Badge>{projection.stats.unroutedNets} ratsnest</Badge>
          </div>
        </div>
        <BoardCanvas projection={projection} />
      </Panel>

      <Panel className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Board obligations</h2>
          <p className="text-xs text-muted-foreground">What layout still needs to satisfy</p>
        </div>
        <div className="grid content-start gap-3 overflow-auto p-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Components" value={projection.stats.totalComponents.toString()} />
            <Stat label="Placed" value={projection.stats.placedComponents.toString()} />
            <Stat label="Unrouted" value={projection.stats.unroutedNets.toString()} />
          </div>

          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Footprints</h3>
            {projection.components.length > 0 ? (
              projection.components.map((component) => (
                <div className="grid gap-1 rounded-md border border-border bg-background px-3 py-2" key={component.id}>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{component.label}</span>
                    <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {component.placed ? "PLACED" : "PROJECTED"}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {formatMm(component.widthMm)} x {formatMm(component.heightMm)} at {formatMm(component.xMm)}, {formatMm(component.yMm)}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState text="Add components in the Graph tab to see footprints." />
            )}
          </div>

          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Open obligations</h3>
            {projection.obligations.length > 0 ? (
              projection.obligations.map((obligation) => (
                <div className="grid gap-1 rounded-md border border-border bg-background px-3 py-2" key={obligation.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{obligation.message}</span>
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {obligation.kind}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">{obligation.sourceId}</div>
                </div>
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

function BoardCanvas({ projection }: { projection: BoardProjection }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;

    if (!canvas || !container) {
      return undefined;
    }

    const render = () => drawBoard(canvas, projection);
    const resizeObserver = new ResizeObserver(render);

    render();
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [projection]);

  return (
    <div className="relative min-h-0 overflow-hidden bg-muted/20">
      <canvas aria-label="PCB board projection" className="block size-full" ref={canvasRef} />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
        Placement editing next. This view renders footprint envelopes and unrouted nets only.
      </div>
    </div>
  );
}

function drawBoard(canvas: HTMLCanvasElement, projection: BoardProjection) {
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
  projection.ratsnest.forEach((edge) => drawRatsnestEdge(context, edge, transform, colors));
  projection.components.forEach((component) => drawComponent(context, component, transform, colors));
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
  colors: CanvasColors
) {
  const from = toCanvas(transform, edge.from.xMm, edge.from.yMm);
  const to = toCanvas(transform, edge.to.xMm, edge.to.yMm);

  context.save();
  context.strokeStyle = edge.kind === "highSpeed" ? colors.highSpeed : edge.kind === "power" ? colors.power : colors.signal;
  context.globalAlpha = edge.kind === "signal" ? 0.34 : 0.72;
  context.lineWidth = edge.kind === "highSpeed" ? 1.8 : 1.2;
  context.setLineDash([5, 5]);
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
  colors: CanvasColors
) {
  const center = toCanvas(transform, component.xMm, component.yMm);
  const width = component.widthMm * transform.scale;
  const height = component.heightMm * transform.scale;

  context.save();
  context.translate(center.x, center.y);
  context.rotate((component.rotationDeg * Math.PI) / 180);
  context.fillStyle = colors.componentFill;
  context.strokeStyle = component.placed ? colors.foreground : colors.mutedForeground;
  context.lineWidth = component.placed ? 1.8 : 1.3;
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

type CanvasColors = {
  background: string;
  border: string;
  card: string;
  componentFill: string;
  foreground: string;
  highSpeed: string;
  mutedForeground: string;
  power: string;
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

function canvasColors(canvas: HTMLCanvasElement): CanvasColors {
  const styles = getComputedStyle(canvas);
  const color = (name: string) => styles.getPropertyValue(name).trim();

  return {
    background: color("--background"),
    border: color("--border"),
    card: color("--card"),
    componentFill: color("--secondary"),
    foreground: color("--foreground"),
    highSpeed: color("--chart-1"),
    mutedForeground: color("--muted-foreground"),
    power: color("--chart-2"),
    signal: color("--foreground")
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
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
