import type { Point, Rect } from "./geometry";

export type SceneSourceReference = Readonly<{
  id: string;
  kind: string;
  path?: readonly (number | string)[];
}>;

export type ScenePickMode = "fill" | "fill-and-stroke" | "none" | "stroke";

type ScenePrimitiveBase = Readonly<{
  id: string;
  interactive?: boolean;
  layer: string;
  pickMode?: ScenePickMode;
  source: SceneSourceReference;
  zIndex: number;
}>;

export type LineScenePrimitive = ScenePrimitiveBase &
  Readonly<{
    end: Point;
    kind: "line";
    start: Point;
    strokeWidth?: number;
  }>;

export type PolylineScenePrimitive = ScenePrimitiveBase &
  Readonly<{
    closed?: boolean;
    kind: "polyline";
    points: readonly Point[];
    strokeWidth?: number;
  }>;

export type RectScenePrimitive = ScenePrimitiveBase &
  Readonly<{
    bounds: Rect;
    cornerRadius?: number;
    kind: "rect";
    strokeWidth?: number;
  }>;

export type CircleScenePrimitive = ScenePrimitiveBase &
  Readonly<{
    center: Point;
    kind: "circle";
    radius: number;
    strokeWidth?: number;
  }>;

export type TextScenePrimitive = ScenePrimitiveBase &
  Readonly<{
    anchor: Point;
    bounds: Rect;
    kind: "text";
    text: string;
  }>;

export type ScenePrimitive =
  | CircleScenePrimitive
  | LineScenePrimitive
  | PolylineScenePrimitive
  | RectScenePrimitive
  | TextScenePrimitive;

export type Scene = Readonly<{
  bounds?: Rect;
  primitives: readonly ScenePrimitive[];
}>;
