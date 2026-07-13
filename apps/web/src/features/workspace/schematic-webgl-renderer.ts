export type SchematicRenderPoint = {
  x: number;
  y: number;
};

export type SchematicRenderViewport = {
  offset: SchematicRenderPoint;
  zoom: number;
};

export type SchematicRenderSymbol = {
  bounds: { height: number; width: number; x: number; y: number };
  detail?: string;
  id: string;
  label: string;
  ports: readonly SchematicRenderPoint[];
  selected: boolean;
};

export type SchematicRenderWire = {
  id: string;
  label?: string;
  points: readonly SchematicRenderPoint[];
  selected: boolean;
};

export type SchematicRenderFrame = {
  symbols: readonly SchematicRenderSymbol[];
  wires: readonly SchematicRenderWire[];
};

type Color = readonly [number, number, number, number];

type RendererResources = {
  solidBuffer: WebGLBuffer;
  solidProgram: WebGLProgram;
  solidResolution: WebGLUniformLocation;
  solidVertexArray: WebGLVertexArrayObject;
  textBuffer: WebGLBuffer;
  textProgram: WebGLProgram;
  textResolution: WebGLUniformLocation;
  textSampler: WebGLUniformLocation;
  textTexture: WebGLTexture;
  textVertexArray: WebGLVertexArrayObject;
};

const resourcesByContext = new WeakMap<WebGL2RenderingContext, RendererResources>();
const background: Color = [0.035, 0.047, 0.065, 1];
const grid: Color = [0.13, 0.16, 0.21, 0.7];
const symbolFill: Color = [0.075, 0.095, 0.13, 1];
const symbolBorder: Color = [0.39, 0.44, 0.53, 1];
const wire: Color = [0.42, 0.76, 0.68, 1];
const selected: Color = [0.35, 0.72, 1, 1];

export function renderSchematicWebgl(
  canvas: HTMLCanvasElement,
  frame: SchematicRenderFrame,
  viewport: SchematicRenderViewport
): boolean {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: true });

  if (!gl) {
    return false;
  }

  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const drawingWidth = Math.round(width * pixelRatio);
  const drawingHeight = Math.round(height * pixelRatio);

  if (canvas.width !== drawingWidth || canvas.height !== drawingHeight) {
    canvas.width = drawingWidth;
    canvas.height = drawingHeight;
  }

  const resources = resourcesByContext.get(gl) ?? createResources(gl);
  resourcesByContext.set(gl, resources);
  gl.viewport(0, 0, drawingWidth, drawingHeight);
  gl.clearColor(...background);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const vertices: number[] = [];
  appendGrid(vertices, width, height, viewport);

  for (const currentWire of frame.wires) {
    const points = currentWire.points.map((point) => worldToScreen(point, viewport));
    for (let index = 1; index < points.length; index += 1) {
      appendSegment(vertices, points[index - 1]!, points[index]!, currentWire.selected ? 3 : 1.5, currentWire.selected ? selected : wire);
    }
  }

  for (const symbol of frame.symbols) {
    const topLeft = worldToScreen({ x: symbol.bounds.x, y: symbol.bounds.y }, viewport);
    const widthPx = symbol.bounds.width * viewport.zoom;
    const heightPx = symbol.bounds.height * viewport.zoom;
    appendRect(vertices, topLeft.x, topLeft.y, widthPx, heightPx, symbolFill);
    appendRectOutline(
      vertices,
      topLeft.x,
      topLeft.y,
      widthPx,
      heightPx,
      symbol.selected ? 3 : 1.5,
      symbol.selected ? selected : symbolBorder
    );
    for (const port of symbol.ports) {
      appendCircle(vertices, worldToScreen(port, viewport), Math.max(2.5, 4 * viewport.zoom), symbol.selected ? selected : wire);
    }
  }

  drawSolidVertices(gl, resources, vertices, width, height, pixelRatio);
  drawText(gl, resources, frame, viewport, width, height, pixelRatio);
  return true;
}

function appendGrid(
  vertices: number[],
  width: number,
  height: number,
  viewport: SchematicRenderViewport
) {
  const spacing = 24 * viewport.zoom;
  if (spacing < 8) return;
  const startX = modulo(viewport.offset.x, spacing);
  const startY = modulo(viewport.offset.y, spacing);

  for (let x = startX; x < width; x += spacing) {
    appendSegment(vertices, { x, y: 0 }, { x, y: height }, 1, grid);
  }
  for (let y = startY; y < height; y += spacing) {
    appendSegment(vertices, { x: 0, y }, { x: width, y }, 1, grid);
  }
}

function appendRect(
  vertices: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  color: Color
) {
  appendTriangle(vertices, x, y, x + width, y, x + width, y + height, color);
  appendTriangle(vertices, x, y, x + width, y + height, x, y + height, color);
}

function appendRectOutline(
  vertices: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  color: Color
) {
  appendRect(vertices, x, y, width, thickness, color);
  appendRect(vertices, x, y + height - thickness, width, thickness, color);
  appendRect(vertices, x, y, thickness, height, color);
  appendRect(vertices, x + width - thickness, y, thickness, height, color);
}

function appendCircle(vertices: number[], center: SchematicRenderPoint, radius: number, color: Color) {
  const steps = 12;
  for (let index = 0; index < steps; index += 1) {
    const start = (index / steps) * Math.PI * 2;
    const end = ((index + 1) / steps) * Math.PI * 2;
    appendTriangle(
      vertices,
      center.x,
      center.y,
      center.x + Math.cos(start) * radius,
      center.y + Math.sin(start) * radius,
      center.x + Math.cos(end) * radius,
      center.y + Math.sin(end) * radius,
      color
    );
  }
}

function appendSegment(
  vertices: number[],
  start: SchematicRenderPoint,
  end: SchematicRenderPoint,
  thickness: number,
  color: Color
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) return;
  const offsetX = (-deltaY / length) * thickness * 0.5;
  const offsetY = (deltaX / length) * thickness * 0.5;
  const a = { x: start.x + offsetX, y: start.y + offsetY };
  const b = { x: end.x + offsetX, y: end.y + offsetY };
  const c = { x: end.x - offsetX, y: end.y - offsetY };
  const d = { x: start.x - offsetX, y: start.y - offsetY };
  appendTriangle(vertices, a.x, a.y, b.x, b.y, c.x, c.y, color);
  appendTriangle(vertices, a.x, a.y, c.x, c.y, d.x, d.y, color);
}

function appendTriangle(
  vertices: number[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  color: Color
) {
  vertices.push(
    ax, ay, ...color,
    bx, by, ...color,
    cx, cy, ...color
  );
}

function drawSolidVertices(
  gl: WebGL2RenderingContext,
  resources: RendererResources,
  vertices: number[],
  width: number,
  height: number,
  pixelRatio: number
) {
  gl.useProgram(resources.solidProgram);
  gl.bindVertexArray(resources.solidVertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.solidBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
  gl.uniform2f(resources.solidResolution, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
  gl.bindVertexArray(null);
  void pixelRatio;
}

function drawText(
  gl: WebGL2RenderingContext,
  resources: RendererResources,
  frame: SchematicRenderFrame,
  viewport: SchematicRenderViewport,
  width: number,
  height: number,
  pixelRatio: number
) {
  const symbolLabels = frame.symbols.flatMap((symbol) => {
    const origin = worldToScreen({ x: symbol.bounds.x, y: symbol.bounds.y }, viewport);
    const symbolWidth = symbol.bounds.width * viewport.zoom;
    const symbolHeight = symbol.bounds.height * viewport.zoom;
    if (symbolWidth < 42 || symbolHeight < 24) return [];
    return [
      {
        color: symbol.selected ? selected : ([0.91, 0.93, 0.97, 1] as Color),
        text: truncateToPixelWidth(symbol.label, symbolWidth - 18),
        x: origin.x + 9,
        y: origin.y + 12
      },
      ...(symbol.detail && symbolHeight >= 50
        ? [{ color: [0.58, 0.64, 0.72, 1] as Color, text: symbol.detail, x: origin.x + 10, y: origin.y + 32 }]
        : [])
    ];
  });
  const wireLabels = frame.wires.flatMap((currentWire) => {
    const center = currentWire.points[Math.floor(currentWire.points.length / 2)];
    return currentWire.label && center && (viewport.zoom >= 0.65 || currentWire.selected)
      ? [{
          color: currentWire.selected ? selected : wire,
          text: currentWire.label,
          x: worldToScreen(center, viewport).x + 4,
          y: worldToScreen(center, viewport).y - 18
        }]
      : [];
  });
  const labels = [...symbolLabels, ...wireLabels];

  if (labels.length === 0) return;
  const atlas = document.createElement("canvas");
  const atlasContext = atlas.getContext("2d");
  if (!atlasContext) return;
  const fontSize = 12;
  const rowHeight = 20;
  atlasContext.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  const measured = labels.map((label) => ({
    ...label,
    renderedText: truncateLabel(label.text),
    width: Math.ceil(atlasContext.measureText(truncateLabel(label.text)).width) + 2
  }));
  atlas.width = nextPowerOfTwo(Math.max(2, ...measured.map(({ width: labelWidth }) => labelWidth)));
  atlas.height = nextPowerOfTwo(rowHeight * measured.length);
  atlasContext.clearRect(0, 0, atlas.width, atlas.height);
  atlasContext.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  atlasContext.textBaseline = "top";
  atlasContext.fillStyle = "white";

  const vertices: number[] = [];
  for (const [index, label] of measured.entries()) {
    const atlasY = index * rowHeight;
    atlasContext.fillText(label.renderedText, 1, atlasY + 2);
    const x2 = label.x + label.width;
    const y2 = label.y + rowHeight;
    const u2 = label.width / atlas.width;
    const v1 = atlasY / atlas.height;
    const v2 = (atlasY + rowHeight) / atlas.height;
    appendTextTriangle(vertices, label.x, label.y, 0, v1, label.color, x2, label.y, u2, v1, label.color, x2, y2, u2, v2, label.color);
    appendTextTriangle(vertices, label.x, label.y, 0, v1, label.color, x2, y2, u2, v2, label.color, label.x, y2, 0, v2, label.color);
  }

  gl.useProgram(resources.textProgram);
  gl.bindVertexArray(resources.textVertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.textBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, resources.textTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.uniform1i(resources.textSampler, 0);
  gl.uniform2f(resources.textResolution, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 8);
  gl.bindVertexArray(null);
  void pixelRatio;
}

function appendTextTriangle(
  vertices: number[],
  ...values: [number, number, number, number, Color, number, number, number, number, Color, number, number, number, number, Color]
) {
  for (let index = 0; index < values.length; index += 5) {
    const color = values[index + 4] as Color;
    vertices.push(
      values[index] as number,
      values[index + 1] as number,
      values[index + 2] as number,
      values[index + 3] as number,
      ...color
    );
  }
}

function createResources(gl: WebGL2RenderingContext): RendererResources {
  const solidProgram = createProgram(gl, solidVertexShader, solidFragmentShader);
  const solidBuffer = requireGl(gl.createBuffer(), "solid buffer");
  const solidVertexArray = requireGl(gl.createVertexArray(), "solid vertex array");
  gl.bindVertexArray(solidVertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, solidBuffer);
  enableAttribute(gl, solidProgram, "a_position", 2, 6, 0);
  enableAttribute(gl, solidProgram, "a_color", 4, 6, 2);

  const textProgram = createProgram(gl, textVertexShader, textFragmentShader);
  const textBuffer = requireGl(gl.createBuffer(), "text buffer");
  const textVertexArray = requireGl(gl.createVertexArray(), "text vertex array");
  gl.bindVertexArray(textVertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, textBuffer);
  enableAttribute(gl, textProgram, "a_position", 2, 8, 0);
  enableAttribute(gl, textProgram, "a_uv", 2, 8, 2);
  enableAttribute(gl, textProgram, "a_color", 4, 8, 4);
  const textTexture = requireGl(gl.createTexture(), "text texture");
  gl.bindTexture(gl.TEXTURE_2D, textTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindVertexArray(null);

  return {
    solidBuffer,
    solidProgram,
    solidResolution: requireGl(gl.getUniformLocation(solidProgram, "u_resolution"), "solid resolution"),
    solidVertexArray,
    textBuffer,
    textProgram,
    textResolution: requireGl(gl.getUniformLocation(textProgram, "u_resolution"), "text resolution"),
    textSampler: requireGl(gl.getUniformLocation(textProgram, "u_texture"), "text sampler"),
    textTexture,
    textVertexArray
  };
}

function enableAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  size: number,
  stride: number,
  offset: number
) {
  const location = gl.getAttribLocation(program, name);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
  const program = requireGl(gl.createProgram(), "program");
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Could not link WebGL program.");
  }
  return program;
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = requireGl(gl.createShader(type), "shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Could not compile WebGL shader.");
  }
  return shader;
}

function requireGl<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Could not create WebGL ${label}.`);
  return value;
}

function worldToScreen(point: SchematicRenderPoint, viewport: SchematicRenderViewport): SchematicRenderPoint {
  return {
    x: point.x * viewport.zoom + viewport.offset.x,
    y: point.y * viewport.zoom + viewport.offset.y
  };
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function nextPowerOfTwo(value: number) {
  return 2 ** Math.ceil(Math.log2(value));
}

function truncateLabel(value: string) {
  return value.length <= 38 ? value : `${value.slice(0, 35)}...`;
}

function truncateToPixelWidth(value: string, width: number) {
  const maximumCharacters = Math.max(4, Math.floor(width / 7));
  return value.length <= maximumCharacters ? value : `${value.slice(0, maximumCharacters - 3)}...`;
}

const solidVertexShader = `#version 300 es
in vec2 a_position;
in vec4 a_color;
uniform vec2 u_resolution;
out vec4 v_color;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_color = a_color;
}`;

const solidFragmentShader = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 out_color;
void main() { out_color = v_color; }`;

const textVertexShader = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`;

const textFragmentShader = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_texture;
out vec4 out_color;
void main() {
  float alpha = texture(u_texture, v_uv).a;
  out_color = vec4(v_color.rgb, v_color.a * alpha);
}`;
