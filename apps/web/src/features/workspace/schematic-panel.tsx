import {
  createViewportTransform,
  hitTestScene,
  panViewport,
  viewportToWorld,
  zoomViewportAt
} from "@nocad/editor-core";
import type { Point, Rect, SceneSourceReference, SchematicProjection, ViewportTransform } from "@nocad/editor-core";
import { buildSchematicProjection } from "@nocad/intent-core";
import type { ProjectSource, ResolvedProject } from "@nocad/intent-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Panel } from "./panel";
import {
  renderSchematicWebgl,
  type SchematicRenderFrame
} from "./schematic-webgl-renderer";

type SchematicSelection = {
  edgeId?: string;
  nodeId?: string;
};

type PointerGesture = {
  moved: boolean;
  pointerId: number;
  previous: Point;
  start: Point;
};

const minimumZoom = 0.2;
const maximumZoom = 4;
const clickDistance = 5;

export function SchematicPanel({
  onSelectionChange,
  resolved,
  selectedEdgeId,
  selectedNodeId,
  source
}: {
  onSelectionChange: (selection: SchematicSelection) => void;
  resolved: ResolvedProject;
  selectedEdgeId?: string;
  selectedNodeId?: string;
  source: ProjectSource;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<PointerGesture | undefined>(undefined);
  const [viewport, setViewport] = useState<ViewportTransform>(() => createViewportTransform());
  const [hoveredSource, setHoveredSource] = useState<SceneSourceReference>();
  const [renderUnavailable, setRenderUnavailable] = useState(false);
  const projection = useMemo(() => buildSchematicProjection(source, resolved), [resolved, source]);
  const frame = useMemo(
    () => createRenderFrame(projection, selectedNodeId, selectedEdgeId),
    [projection, selectedEdgeId, selectedNodeId]
  );

  const fitProjection = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projection.scene.bounds) return;
    setViewport(fitBounds(projection.scene.bounds, canvas.clientWidth, canvas.clientHeight));
  }, [projection.scene.bounds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => {
      if (canvas.width === 0 || canvas.height === 0) fitProjection();
      if (!renderSchematicWebgl(canvas, frame, viewport)) setRenderUnavailable(true);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fitProjection, frame, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) renderSchematicWebgl(canvas, frame, viewport);
  }, [frame, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const factor = Math.exp(-event.deltaY * 0.0015);
      setViewport((current) =>
        zoomViewportAt(current, current.zoom * factor, point, {
          minZoom: minimumZoom,
          maxZoom: maximumZoom
        })
      );
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projection.scene.bounds) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      setViewport(fitBounds(projection.scene.bounds!, canvas.clientWidth, canvas.clientHeight));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [projection]);

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function startPointerGesture(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = { moved: false, pointerId: event.pointerId, previous: point, start: point };
  }

  function movePointerGesture(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointerPosition(event);
    const gesture = gestureRef.current;
    if (gesture?.pointerId === event.pointerId) {
      const delta = { x: point.x - gesture.previous.x, y: point.y - gesture.previous.y };
      gesture.previous = point;
      gesture.moved ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > clickDistance;
      if (gesture.moved) setViewport((current) => panViewport(current, delta));
      return;
    }
    setHoveredSource(hitSource(projection, point, viewport));
  }

  function finishPointerGesture(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointerPosition(event);
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!gesture.moved) selectSource(hitSource(projection, point, viewport), onSelectionChange);
  }

  function zoomAt(point: Point, factor: number) {
    setViewport((current) =>
      zoomViewportAt(current, current.zoom * factor, point, { minZoom: minimumZoom, maxZoom: maximumZoom })
    );
  }

  return (
    <Panel className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <div className="text-sm font-semibold">Generated schematic</div>
          <div className="text-xs text-muted-foreground">
            {projection.nodes.length} symbols, {projection.connections.length} resolved nets
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="h-7 rounded-md border border-border px-2 text-xs" onClick={() => zoomAt(canvasCenter(canvasRef.current), 1.25)} type="button">
            Zoom in
          </button>
          <button className="h-7 rounded-md border border-border px-2 text-xs" onClick={() => zoomAt(canvasCenter(canvasRef.current), 0.8)} type="button">
            Zoom out
          </button>
          <button className="h-7 rounded-md border border-border px-2 text-xs" onClick={fitProjection} type="button">
            Fit
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-950">
        <canvas
          aria-label="Read-only generated schematic. Drag to pan, scroll to zoom, and select symbols or nets."
          className="block size-full touch-none cursor-grab active:cursor-grabbing"
          onKeyDown={(event) => {
            if (event.key === "Escape") onSelectionChange({});
            if (event.key === "+" || event.key === "=") zoomAt(canvasCenter(event.currentTarget), 1.25);
            if (event.key === "-") zoomAt(canvasCenter(event.currentTarget), 0.8);
          }}
          onPointerCancel={() => { gestureRef.current = undefined; }}
          onPointerDown={startPointerGesture}
          onPointerLeave={() => setHoveredSource(undefined)}
          onPointerMove={movePointerGesture}
          onPointerUp={finishPointerGesture}
          ref={canvasRef}
          role="application"
          tabIndex={0}
        />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-slate-950/85 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 backdrop-blur">
          {renderUnavailable
            ? "WebGL2 unavailable"
            : hoveredSource
            ? `${hoveredSource.kind} ${hoveredSource.id}`
            : `WebGL2 projection / ${Math.round(viewport.zoom * 100)}%`}
        </div>
        {renderUnavailable ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-300">
            This browser could not create the WebGL2 schematic renderer.
          </div>
        ) : null}
        {projection.diagnostics.length > 0 ? (
          <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-amber-400/30 bg-amber-950/85 px-2.5 py-1.5 text-xs text-amber-100">
            {projection.diagnostics.length} projection diagnostic{projection.diagnostics.length === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function createRenderFrame(
  projection: SchematicProjection,
  selectedNodeId?: string,
  selectedEdgeId?: string
): SchematicRenderFrame {
  const labelsByPrimitive = new Map(
    projection.scene.primitives.flatMap((primitive) =>
      primitive.kind === "text"
        ? [[primitive.id, primitive.text] as const]
        : []
    )
  );

  return {
    symbols: projection.nodes.map((node) => ({
      bounds: node.bounds,
      id: node.id,
      label: labelsByPrimitive.get(`node/${encodeURIComponent(node.id)}/label`) ?? node.id,
      ports: node.ports.map(({ position }) => position),
      selected: (node.source.kind === "node" && node.source.id === selectedNodeId) ||
        (node.source.kind === "edge" && node.source.id === selectedEdgeId)
    })),
    wires: projection.connections.map((connection) => ({
      id: connection.id,
      label: labelsByPrimitive.get(`connection/${encodeURIComponent(connection.id)}/label`),
      points: connection.points,
      selected: connection.source.kind === "edge" && connection.source.id === selectedEdgeId
    }))
  };
}

function hitSource(
  projection: SchematicProjection,
  viewportPoint: Point,
  viewport: ViewportTransform
): SceneSourceReference | undefined {
  return hitTestScene(projection.scene, viewportToWorld(viewportPoint, viewport), {
    tolerance: 7 / viewport.zoom
  })[0]?.primitive.source;
}

function selectSource(
  source: SceneSourceReference | undefined,
  onSelectionChange: (selection: SchematicSelection) => void
) {
  if (source?.kind === "node") onSelectionChange({ nodeId: source.id });
  else if (source?.kind === "edge") onSelectionChange({ edgeId: source.id });
  else onSelectionChange({});
}

function fitBounds(bounds: Rect, width: number, height: number): ViewportTransform {
  const padding = 28;
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const zoom = Math.max(
    minimumZoom,
    Math.min(maximumZoom, availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height))
  );
  return createViewportTransform({
    offset: {
      x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
      y: (height - bounds.height * zoom) / 2 - bounds.y * zoom
    },
    zoom
  });
}

function canvasCenter(canvas: HTMLCanvasElement | null): Point {
  return { x: (canvas?.clientWidth ?? 0) / 2, y: (canvas?.clientHeight ?? 0) / 2 };
}
