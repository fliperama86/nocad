import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import hdmiBreakoutBoardSource from "../../../../../fixtures/kicad/hdmi-breakout/hdmi_breakout.kicad_pcb?raw";
import { Panel } from "../i2c-slice/panel";
import type { KiCadBoardPreview, KiCadPadPreview, KiCadPoint } from "./kicad-preview";
import { parseKiCadBoardPreview } from "./kicad-preview";

const hdmiBreakoutPreview = parseKiCadBoardPreview(hdmiBreakoutBoardSource);
const defaultVisibleLayers = ["F.Cu", "B.Cu", "F.SilkS"];
const sourceLayers = [
  { color: "bg-red-500", label: "Front copper", layer: "F.Cu" },
  { color: "bg-blue-500", label: "Back copper", layer: "B.Cu" },
  { color: "bg-amber-300", label: "Front silkscreen", layer: "F.SilkS" },
  { color: "bg-cyan-400", label: "Front fabrication", layer: "F.Fab" },
  { color: "bg-fuchsia-400", label: "Front courtyard", layer: "F.CrtYd" },
  { color: "bg-emerald-400", label: "User drawings", layer: "Dwgs.User" },
  { color: "bg-slate-400", label: "User comments", layer: "Cmts.User" }
];

export function HdmiBreakoutFixturePanel({ onShowIntentBoard }: { onShowIntentBoard: () => void }) {
  const [selectedNet, setSelectedNet] = useState<string>();
  const [visibleLayers, setVisibleLayers] = useState(() => new Set(defaultVisibleLayers));
  const connectedPads = useMemo(
    () => selectedNet ? hdmiBreakoutPreview.pads.filter((pad) => pad.net === selectedNet).length : undefined,
    [selectedNet]
  );

  function toggleLayer(layer: string) {
    setVisibleLayers((current) => {
      const next = new Set(current);

      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }

      return next;
    });
  }

  return (
    <div className="grid h-full min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">HDMI breakout fixture</h2>
              <span className="rounded-sm bg-chart-1/10 px-1.5 py-0.5 text-[10px] font-semibold text-chart-1">
                KICAD 10
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Content-pinned source geometry, read-only research preview</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge>{formatMm(hdmiBreakoutPreview.bounds.widthMm)} x {formatMm(hdmiBreakoutPreview.bounds.heightMm)}</Badge>
            <Badge>{hdmiBreakoutPreview.footprints.length} footprints</Badge>
            <Badge>{hdmiBreakoutPreview.tracks.length} tracks</Badge>
            <Badge>{hdmiBreakoutPreview.vias.length} vias</Badge>
            <Badge>{hdmiBreakoutPreview.zones.length} fills</Badge>
            <button
              className="h-7 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted"
              onClick={onShowIntentBoard}
              type="button"
            >
              Intent board
            </button>
          </div>
        </div>
        <KiCadFixtureCanvas
          preview={hdmiBreakoutPreview}
          selectedNet={selectedNet}
          visibleLayers={visibleLayers}
        />
      </Panel>

      <Panel className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">Fixture inspector</h2>
          <p className="text-xs text-muted-foreground">Actual pads, copper fills, source drawings, outline, and nets</p>
        </div>
        <div className="grid content-start gap-3 overflow-auto p-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Pads" value={hdmiBreakoutPreview.pads.length.toString()} />
            <Stat label="Signals" value={hdmiBreakoutPreview.nets.length.toString()} />
            <Stat label="Layers" value={hdmiBreakoutPreview.layers.length.toString()} />
          </div>

          <div className="grid gap-2 rounded-md border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Source layers</h3>
                <p className="mt-1 text-xs text-muted-foreground">Toggle source layers without changing the fixture.</p>
              </div>
              <button
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setVisibleLayers(new Set(defaultVisibleLayers))}
                type="button"
              >
                Reset
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {sourceLayers.map((sourceLayer) => (
                <LayerButton
                  active={visibleLayers.has(sourceLayer.layer)}
                  color={sourceLayer.color}
                  key={sourceLayer.layer}
                  label={sourceLayer.label}
                  onClick={() => toggleLayer(sourceLayer.layer)}
                />
              ))}
            </div>
          </div>

          {selectedNet ? (
            <div className="grid gap-2 rounded-md border border-chart-1/40 bg-chart-1/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground">Selected signal</div>
                  <div className="font-mono text-sm font-semibold">{selectedNet}</div>
                </div>
                <button
                  className="h-7 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
                  onClick={() => setSelectedNet(undefined)}
                  type="button"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <InspectorMetric label="Segments" value={hdmiBreakoutPreview.tracks.filter((track) => track.net === selectedNet).length} />
                <InspectorMetric label="Pads" value={connectedPads ?? 0} />
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              Select a signal to isolate its routed copper and connected pads.
            </div>
          )}

          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Signals</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {hdmiBreakoutPreview.nets.map((net) => (
                <button
                  className={[
                    "rounded-md border px-2.5 py-2 text-left font-mono text-xs transition-colors",
                    selectedNet === net
                      ? "border-chart-1 bg-chart-1/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  ].join(" ")}
                  key={net}
                  onClick={() => setSelectedNet((current) => current === net ? undefined : net)}
                  type="button"
                >
                  {net}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Footprints</h3>
            {hdmiBreakoutPreview.footprints.map((footprint) => (
              <div className="grid gap-1 rounded-md border border-border bg-background px-3 py-2" key={footprint.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{footprint.reference}</span>
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {footprint.layer}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{footprint.value}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {formatMm(footprint.xMm)}, {formatMm(footprint.yMm)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function KiCadFixtureCanvas({
  preview,
  selectedNet,
  visibleLayers
}: {
  preview: KiCadBoardPreview;
  selectedNet: string | undefined;
  visibleLayers: Set<string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;

    if (!canvas || !container) {
      return undefined;
    }

    const render = () => drawKiCadFixture(canvas, preview, visibleLayers, selectedNet);
    const resizeObserver = new ResizeObserver(render);

    render();
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [preview, selectedNet, visibleLayers]);

  return (
    <div className="relative min-h-0 overflow-hidden bg-muted/20">
      <canvas aria-label="HDMI breakout KiCad fixture" className="block size-full" ref={canvasRef} />
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
        <Legend color="bg-red-500" label="F.Cu" />
        <Legend color="bg-blue-500" label="B.Cu" />
        <Legend color="bg-amber-300" label="F.SilkS" />
        <Legend color="bg-amber-400" label="Selected signal" />
      </div>
    </div>
  );
}

function drawKiCadFixture(
  canvas: HTMLCanvasElement,
  preview: KiCadBoardPreview,
  visibleLayers: Set<string>,
  selectedNet: string | undefined
) {
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

  const styles = getComputedStyle(canvas);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  const transform = fixtureTransform(preview, rect.width, rect.height);

  context.fillStyle = color("--background");
  context.fillRect(0, 0, rect.width, rect.height);
  drawFixtureGrid(context, preview, transform, color("--border"));
  drawFixtureOutline(context, preview.outline, transform, color("--card"), color("--foreground"));

  for (const zone of preview.zones) {
    if (!visibleLayers.has(zone.layer)) {
      continue;
    }

    const highlighted = selectedNet === zone.net;
    const dimmed = Boolean(selectedNet && !highlighted);
    drawFixturePolygon(
      context,
      zone.points,
      transform,
      highlighted ? "#fbbf24" : zone.layer === "B.Cu" ? "#3b82f6" : "#ef4444",
      dimmed ? 0.04 : highlighted ? 0.32 : 0.16
    );
  }

  for (const graphic of preview.graphics) {
    if (!visibleLayers.has(graphic.layer) || graphic.layer === "F.SilkS") {
      continue;
    }

    drawFixtureGraphic(context, graphic, transform);
  }

  for (const track of preview.tracks) {
    if (!visibleLayers.has(track.layer)) {
      continue;
    }

    const highlighted = selectedNet === track.net;
    const dimmed = Boolean(selectedNet && !highlighted);
    const start = fixturePoint(transform, track.start);
    const end = fixturePoint(transform, track.end);

    context.save();
    context.strokeStyle = highlighted ? "#fbbf24" : track.layer === "B.Cu" ? "#3b82f6" : "#ef4444";
    context.globalAlpha = dimmed ? 0.12 : highlighted ? 1 : 0.8;
    context.lineWidth = Math.max(1.25, track.widthMm * transform.scale);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.restore();
  }

  for (const via of preview.vias) {
    if (!via.layers.some((layer) => visibleLayers.has(layer))) {
      continue;
    }

    const center = fixturePoint(transform, via);
    const highlighted = selectedNet === via.net;
    const dimmed = Boolean(selectedNet && !highlighted);

    context.save();
    context.globalAlpha = dimmed ? 0.16 : 1;
    context.fillStyle = highlighted ? "#fbbf24" : "#f87171";
    context.strokeStyle = highlighted ? "#f59e0b" : color("--foreground");
    context.lineWidth = highlighted ? 2 : 0.7;
    context.beginPath();
    context.arc(center.x, center.y, Math.max(2, via.sizeMm * transform.scale / 2), 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = color("--card");
    context.beginPath();
    context.arc(center.x, center.y, Math.max(1, via.drillMm * transform.scale / 2), 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  for (const pad of preview.pads) {
    const padVisible = pad.layers.includes("*.Cu") || [...visibleLayers].some((layer) => pad.layers.includes(layer));

    if (!padVisible) {
      continue;
    }

    drawFixturePad(context, pad, transform, selectedNet, color("--foreground"), color("--card"));
  }

  for (const graphic of preview.graphics) {
    if (!visibleLayers.has(graphic.layer) || graphic.layer !== "F.SilkS") {
      continue;
    }

    drawFixtureGraphic(context, graphic, transform);
  }

  for (const footprint of preview.footprints) {
    const center = fixturePoint(transform, footprint);

    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color("--foreground");
    context.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.shadowBlur = 5;
    context.shadowColor = color("--card");
    context.fillText(footprint.reference, center.x, center.y - 12);
    context.restore();
  }
}

function drawFixturePolygon(
  context: CanvasRenderingContext2D,
  points: KiCadPoint[],
  transform: FixtureTransform,
  fill: string,
  alpha: number
) {
  const first = points[0];

  if (!first) {
    return;
  }

  context.save();
  context.fillStyle = fill;
  context.globalAlpha = alpha;
  context.beginPath();
  const origin = fixturePoint(transform, first);
  context.moveTo(origin.x, origin.y);

  for (const point of points.slice(1)) {
    const position = fixturePoint(transform, point);
    context.lineTo(position.x, position.y);
  }

  context.closePath();
  context.fill("evenodd");
  context.restore();
}

function drawFixtureGraphic(
  context: CanvasRenderingContext2D,
  graphic: KiCadBoardPreview["graphics"][number],
  transform: FixtureTransform
) {
  const layerColors: Record<string, string> = {
    "Cmts.User": "#94a3b8",
    "Dwgs.User": "#34d399",
    "F.CrtYd": "#e879f9",
    "F.Fab": "#22d3ee",
    "F.SilkS": "#fde68a"
  };
  const first = graphic.points[0];
  const second = graphic.points[1];

  if (!first || !second) {
    return;
  }

  context.save();
  context.strokeStyle = layerColors[graphic.layer] ?? "#cbd5e1";
  context.fillStyle = context.strokeStyle;
  context.globalAlpha = graphic.layer === "F.SilkS" ? 0.95 : 0.72;
  context.lineWidth = Math.max(1, graphic.strokeWidthMm * transform.scale);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  if (graphic.kind === "circle") {
    const center = fixturePoint(transform, first);
    const edge = fixturePoint(transform, second);
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  } else {
    const origin = fixturePoint(transform, first);
    context.moveTo(origin.x, origin.y);

    for (const point of graphic.points.slice(1)) {
      const position = fixturePoint(transform, point);
      context.lineTo(position.x, position.y);
    }

    if (graphic.kind === "polygon") {
      context.closePath();
    }
  }

  if (graphic.fill) {
    context.fill();
  }

  context.stroke();
  context.restore();
}

function drawFixturePad(
  context: CanvasRenderingContext2D,
  pad: KiCadPadPreview,
  transform: FixtureTransform,
  selectedNet: string | undefined,
  foreground: string,
  card: string
) {
  const center = fixturePoint(transform, pad);
  const highlighted = Boolean(selectedNet && selectedNet === pad.net);
  const dimmed = Boolean(selectedNet && !highlighted);
  const width = Math.max(3, pad.widthMm * transform.scale);
  const height = Math.max(3, pad.heightMm * transform.scale);

  context.save();
  context.translate(center.x, center.y);
  context.rotate((pad.rotationDeg * Math.PI) / 180);
  context.globalAlpha = dimmed ? 0.18 : 1;
  context.fillStyle = highlighted ? "#fbbf24" : pad.layers.includes("B.Cu") ? "#60a5fa" : "#f87171";
  context.strokeStyle = highlighted ? "#f59e0b" : foreground;
  context.lineWidth = highlighted ? 2 : 0.7;
  context.beginPath();

  if (pad.shape === "circle") {
    context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else if (pad.shape === "oval") {
    context.roundRect(-width / 2, -height / 2, width, height, Math.min(width, height) / 2);
  } else if (pad.shape === "roundrect") {
    context.roundRect(-width / 2, -height / 2, width, height, Math.min(width, height) * 0.25);
  } else {
    context.rect(-width / 2, -height / 2, width, height);
  }

  context.fill();
  context.stroke();

  if (pad.drill) {
    const drillWidth = Math.max(1, pad.drill.widthMm * transform.scale);
    const drillHeight = Math.max(1, pad.drill.heightMm * transform.scale);

    context.fillStyle = card;
    context.beginPath();

    if (pad.drill.shape === "oval") {
      context.roundRect(
        -drillWidth / 2,
        -drillHeight / 2,
        drillWidth,
        drillHeight,
        Math.min(drillWidth, drillHeight) / 2
      );
    } else {
      context.ellipse(0, 0, drillWidth / 2, drillHeight / 2, 0, 0, Math.PI * 2);
    }

    context.fill();
  }

  context.restore();
}

type FixtureTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

function fixtureTransform(preview: KiCadBoardPreview, canvasWidth: number, canvasHeight: number): FixtureTransform {
  const padding = 58;
  const scale = Math.max(
    1,
    Math.min(
      (canvasWidth - padding * 2) / preview.bounds.widthMm,
      (canvasHeight - padding * 2) / preview.bounds.heightMm
    )
  );

  return {
    offsetX: (canvasWidth - preview.bounds.widthMm * scale) / 2,
    offsetY: (canvasHeight - preview.bounds.heightMm * scale) / 2,
    scale
  };
}

function fixturePoint(transform: FixtureTransform, point: KiCadPoint) {
  return {
    x: transform.offsetX + point.xMm * transform.scale,
    y: transform.offsetY + point.yMm * transform.scale
  };
}

function drawFixtureGrid(
  context: CanvasRenderingContext2D,
  preview: KiCadBoardPreview,
  transform: FixtureTransform,
  color: string
) {
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.22;
  context.lineWidth = 1;

  for (let x = 0; x <= preview.bounds.widthMm; x += 2) {
    const start = fixturePoint(transform, { xMm: x, yMm: 0 });
    const end = fixturePoint(transform, { xMm: x, yMm: preview.bounds.heightMm });
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  for (let y = 0; y <= preview.bounds.heightMm; y += 2) {
    const start = fixturePoint(transform, { xMm: 0, yMm: y });
    const end = fixturePoint(transform, { xMm: preview.bounds.widthMm, yMm: y });
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  context.restore();
}

function drawFixtureOutline(
  context: CanvasRenderingContext2D,
  outline: KiCadPoint[],
  transform: FixtureTransform,
  fill: string,
  stroke: string
) {
  const first = outline[0];

  if (!first) {
    return;
  }

  context.save();
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = 1.6;
  context.beginPath();
  const origin = fixturePoint(transform, first);
  context.moveTo(origin.x, origin.y);

  for (const point of outline.slice(1)) {
    const position = fixturePoint(transform, point);
    context.lineTo(position.x, position.y);
  }

  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]">{children}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function LayerButton({ active, color, label, onClick }: { active: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button
      className={[
        "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors",
        active ? "border-foreground/30 bg-muted" : "border-border bg-background text-muted-foreground opacity-60"
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      <span className={`size-2.5 rounded-full ${color}`} />
      {label}
    </button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function InspectorMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/70 bg-background px-2.5 py-2">
      <div className="text-base font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function formatMm(value: number) {
  return `${Number(value.toFixed(2))}mm`;
}
