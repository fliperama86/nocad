export type KiCadBoardPreview = {
  bounds: {
    heightMm: number;
    widthMm: number;
  };
  footprints: KiCadFootprintPreview[];
  generatorVersion: string;
  graphics: KiCadGraphicPreview[];
  layers: string[];
  nets: string[];
  outline: KiCadPoint[];
  pads: KiCadPadPreview[];
  tracks: KiCadTrackPreview[];
  zones: KiCadZonePreview[];
};

export type KiCadPoint = {
  xMm: number;
  yMm: number;
};

export type KiCadFootprintPreview = KiCadPoint & {
  id: string;
  layer: string;
  reference: string;
  rotationDeg: number;
  value: string;
};

export type KiCadPadPreview = KiCadPoint & {
  drill?: {
    heightMm: number;
    shape: "circle" | "oval";
    widthMm: number;
  };
  footprintId: string;
  heightMm: number;
  id: string;
  layers: string[];
  net?: string;
  number: string;
  rotationDeg: number;
  shape: string;
  widthMm: number;
};

export type KiCadTrackPreview = {
  end: KiCadPoint;
  id: string;
  layer: string;
  net: string;
  start: KiCadPoint;
  widthMm: number;
};

export type KiCadGraphicPreview = {
  fill: boolean;
  id: string;
  kind: "circle" | "line" | "polygon";
  layer: string;
  points: KiCadPoint[];
  strokeWidthMm: number;
};

export type KiCadZonePreview = {
  id: string;
  layer: string;
  net: string;
  points: KiCadPoint[];
};

type SExpression = Array<string | SExpression>;

export function parseKiCadBoardPreview(source: string): KiCadBoardPreview {
  const board = parseSExpression(source);

  if (board[0] !== "kicad_pcb") {
    throw new Error("Expected a kicad_pcb document.");
  }

  const outline = directChildren(board, "gr_poly")
    .filter((polygon) => childValue(polygon, "layer") === "Edge.Cuts")
    .flatMap((polygon) => directChildren(directChildren(polygon, "pts")[0] ?? [], "xy"))
    .map(pointFromExpression);

  if (outline.length < 3) {
    throw new Error("The fixture preview requires a polygonal Edge.Cuts outline.");
  }

  const minX = Math.min(...outline.map((point) => point.xMm));
  const minY = Math.min(...outline.map((point) => point.yMm));
  const maxX = Math.max(...outline.map((point) => point.xMm));
  const maxY = Math.max(...outline.map((point) => point.yMm));
  const normalize = (point: KiCadPoint): KiCadPoint => ({
    xMm: point.xMm - minX,
    yMm: point.yMm - minY
  });
  const footprints: KiCadFootprintPreview[] = [];
  const graphics: KiCadGraphicPreview[] = [];
  const pads: KiCadPadPreview[] = [];

  for (const [footprintIndex, footprint] of directChildren(board, "footprint").entries()) {
    const at = numericValues(directChildren(footprint, "at")[0]);
    const footprintX = at[0] ?? 0;
    const footprintY = at[1] ?? 0;
    const footprintRotation = at[2] ?? 0;
    const footprintId = childValue(footprint, "uuid") ?? `footprint-${footprintIndex}`;
    const position = normalize({ xMm: footprintX, yMm: footprintY });

    footprints.push({
      ...position,
      id: footprintId,
      layer: childValue(footprint, "layer") ?? "F.Cu",
      reference: propertyValue(footprint, "Reference") ?? `REF${footprintIndex + 1}`,
      rotationDeg: footprintRotation,
      value: propertyValue(footprint, "Value") ?? String(footprint[1] ?? "Footprint")
    });

    for (const [padIndex, pad] of directChildren(footprint, "pad").entries()) {
      const padAt = numericValues(directChildren(pad, "at")[0]);
      const size = numericValues(directChildren(pad, "size")[0]);
      const drill = parseDrill(directChildren(pad, "drill")[0]);
      const rotated = rotatePoint(padAt[0] ?? 0, padAt[1] ?? 0, footprintRotation);
      const padPosition = normalize({ xMm: footprintX + rotated.xMm, yMm: footprintY + rotated.yMm });

      pads.push({
        ...padPosition,
        drill,
        footprintId,
        heightMm: size[1] ?? size[0] ?? 1,
        id: childValue(pad, "uuid") ?? `${footprintId}-pad-${padIndex}`,
        layers: (directChildren(pad, "layers")[0] ?? []).slice(1).filter(isString),
        net: childValue(pad, "net"),
        number: isString(pad[1]) ? pad[1] : "",
        rotationDeg: padAt[2] ?? footprintRotation,
        shape: isString(pad[3]) ? pad[3] : "rect",
        widthMm: size[0] ?? 1
      });
    }

    for (const [graphicIndex, graphic] of footprintGraphics(footprint).entries()) {
      const kind = graphic[0];
      const layer = childValue(graphic, "layer") ?? "F.SilkS";
      const graphicId = childValue(graphic, "uuid") ?? `${footprintId}-graphic-${graphicIndex}`;
      const stroke = directChildren(graphic, "stroke")[0];
      const strokeWidthMm = Number(childValue(stroke ?? [], "width") ?? 0.1);
      const localPoints = graphicPoints(graphic);
      const points = localPoints.map((point) => {
        const rotated = rotatePoint(point.xMm, point.yMm, footprintRotation);
        return normalize({ xMm: footprintX + rotated.xMm, yMm: footprintY + rotated.yMm });
      });

      if (points.length < 2) {
        continue;
      }

      graphics.push({
        fill: childValue(graphic, "fill") === "solid",
        id: graphicId,
        kind: kind === "fp_circle" ? "circle" : kind === "fp_line" ? "line" : "polygon",
        layer,
        points,
        strokeWidthMm: Number.isFinite(strokeWidthMm) ? strokeWidthMm : 0.1
      });
    }
  }

  const tracks = directChildren(board, "segment").map((segment, index): KiCadTrackPreview => ({
    end: normalize(pointFromExpression(directChildren(segment, "end")[0])),
    id: childValue(segment, "uuid") ?? `segment-${index}`,
    layer: childValue(segment, "layer") ?? "F.Cu",
    net: childValue(segment, "net") ?? "",
    start: normalize(pointFromExpression(directChildren(segment, "start")[0])),
    widthMm: Number(childValue(segment, "width") ?? 0.2)
  }));
  const nets = [...new Set([...tracks.map((track) => track.net), ...pads.map((pad) => pad.net ?? "")])]
    .filter(Boolean)
    .sort();
  const zones = directChildren(board, "zone").flatMap((zone, zoneIndex) => {
    const net = childValue(zone, "net") ?? "";
    const zoneId = childValue(zone, "uuid") ?? `zone-${zoneIndex}`;

    return directChildren(zone, "filled_polygon").map((polygon, polygonIndex): KiCadZonePreview => ({
      id: `${zoneId}-${polygonIndex}`,
      layer: childValue(polygon, "layer") ?? "F.Cu",
      net,
      points: directChildren(directChildren(polygon, "pts")[0] ?? [], "xy").map(pointFromExpression).map(normalize)
    }));
  }).filter((zone) => zone.points.length >= 3);
  const layers = [...new Set([
    ...tracks.map((track) => track.layer),
    ...zones.map((zone) => zone.layer),
    ...graphics.map((graphic) => graphic.layer)
  ])];

  return {
    bounds: {
      heightMm: maxY - minY,
      widthMm: maxX - minX
    },
    footprints,
    generatorVersion: childValue(board, "generator_version") ?? "unknown",
    graphics,
    layers,
    nets,
    outline: outline.map(normalize),
    pads,
    tracks,
    zones
  };
}

function footprintGraphics(footprint: SExpression) {
  return footprint.slice(1).filter(
    (item): item is SExpression => Array.isArray(item) && ["fp_circle", "fp_line", "fp_rect"].includes(String(item[0]))
  );
}

function graphicPoints(graphic: SExpression): KiCadPoint[] {
  if (graphic[0] === "fp_circle") {
    return [
      pointFromExpression(directChildren(graphic, "center")[0]),
      pointFromExpression(directChildren(graphic, "end")[0])
    ];
  }

  const start = pointFromExpression(directChildren(graphic, "start")[0]);
  const end = pointFromExpression(directChildren(graphic, "end")[0]);

  if (graphic[0] === "fp_rect") {
    return [
      start,
      { xMm: end.xMm, yMm: start.yMm },
      end,
      { xMm: start.xMm, yMm: end.yMm }
    ];
  }

  return [start, end];
}

function rotatePoint(xMm: number, yMm: number, rotationDeg: number): KiCadPoint {
  const angle = (-rotationDeg * Math.PI) / 180;

  return {
    xMm: xMm * Math.cos(angle) - yMm * Math.sin(angle),
    yMm: xMm * Math.sin(angle) + yMm * Math.cos(angle)
  };
}

function parseDrill(expression: SExpression | undefined): KiCadPadPreview["drill"] {
  if (!expression) {
    return undefined;
  }

  if (expression[1] === "oval") {
    const widthMm = Number(expression[2]);
    const heightMm = Number(expression[3]);

    if (Number.isFinite(widthMm) && Number.isFinite(heightMm)) {
      return { heightMm, shape: "oval", widthMm };
    }

    return undefined;
  }

  const diameterMm = Number(expression[1]);

  return Number.isFinite(diameterMm)
    ? { heightMm: diameterMm, shape: "circle", widthMm: diameterMm }
    : undefined;
}

function pointFromExpression(expression: SExpression | undefined): KiCadPoint {
  const values = numericValues(expression);

  return {
    xMm: values[0] ?? 0,
    yMm: values[1] ?? 0
  };
}

function numericValues(expression: SExpression | undefined) {
  return (expression ?? []).slice(1).filter(isString).map(Number).filter(Number.isFinite);
}

function directChildren(expression: SExpression, head: string): SExpression[] {
  return expression.slice(1).filter((item): item is SExpression => Array.isArray(item) && item[0] === head);
}

function childValue(expression: SExpression, head: string) {
  const value = directChildren(expression, head)[0]?.[1];
  return isString(value) ? value : undefined;
}

function propertyValue(expression: SExpression, propertyName: string) {
  const value = directChildren(expression, "property").find((property) => property[1] === propertyName)?.[2];
  return isString(value) ? value : undefined;
}

function isString(value: string | SExpression | undefined): value is string {
  return typeof value === "string";
}

function parseSExpression(source: string): SExpression {
  const stack: SExpression[] = [];
  let root: SExpression | undefined;

  for (const token of tokenize(source)) {
    if (token === "(") {
      const expression: SExpression = [];

      if (stack.length > 0) {
        stack.at(-1)?.push(expression);
      } else if (root) {
        throw new Error("Found more than one top-level KiCad expression.");
      } else {
        root = expression;
      }

      stack.push(expression);
    } else if (token === ")") {
      if (stack.length === 0) {
        throw new Error("Found an unmatched closing parenthesis in KiCad source.");
      }

      stack.pop();
    } else {
      stack.at(-1)?.push(token);
    }
  }

  if (!root || stack.length !== 0) {
    throw new Error("Found an incomplete KiCad expression.");
  }

  return root;
}

function* tokenize(source: string): Generator<string> {
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (!character) {
      break;
    }

    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }

    if (character === ";") {
      const newline = source.indexOf("\n", index);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }

    if (character === "(" || character === ")") {
      yield character;
      index += 1;
      continue;
    }

    if (character === '"') {
      let value = "";
      index += 1;

      while (index < source.length) {
        const quotedCharacter = source[index];

        if (quotedCharacter === '"') {
          index += 1;
          break;
        }

        if (quotedCharacter === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
        } else {
          value += quotedCharacter;
          index += 1;
        }
      }

      yield value;
      continue;
    }

    const start = index;

    while (index < source.length && !/[\s();]/u.test(source[index] ?? "")) {
      index += 1;
    }

    yield source.slice(start, index);
  }
}
