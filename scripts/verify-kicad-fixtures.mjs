import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = path.join(repositoryRoot, "fixtures", "kicad");
const fixtureDirectories = (await readdir(fixturesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(fixturesRoot, entry.name))
  .sort();

let failed = false;

for (const fixtureDirectory of fixtureDirectories) {
  try {
    await verifyFixture(fixtureDirectory);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${path.relative(repositoryRoot, fixtureDirectory)}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Verified ${fixtureDirectories.length} KiCad fixture${fixtureDirectories.length === 1 ? "" : "s"}.`);
}

async function verifyFixture(fixtureDirectory) {
  const manifestPath = path.join(fixtureDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assertEqual(manifest.schema, "nocad.kicad-fixture.v1", "manifest schema");

  for (const file of manifest.files) {
    const fixturePath = safeFixturePath(fixtureDirectory, file.path);
    const [contents, fileStat] = await Promise.all([readFile(fixturePath), stat(fixturePath)]);
    const digest = createHash("sha256").update(contents).digest("hex");

    assertEqual(fileStat.size, file.bytes, `${file.path} byte size`);
    assertEqual(digest, file.sha256, `${file.path} SHA-256`);
  }

  const schematicPath = fixtureFile(manifest, ".kicad_sch", fixtureDirectory);
  const boardPath = fixtureFile(manifest, ".kicad_pcb", fixtureDirectory);
  const [schematic, board] = await Promise.all([
    parseSExpression(await readFile(schematicPath, "utf8")),
    parseSExpression(await readFile(boardPath, "utf8"))
  ]);

  assertEqual(schematic[0], "kicad_sch", "schematic root");
  assertEqual(board[0], "kicad_pcb", "board root");

  const schematicSymbols = directChildren(schematic, "symbol").filter((symbol) => childValue(symbol, "lib_id"));
  const schematicComponents = schematicSymbols.filter((symbol) => {
    const reference = propertyValue(symbol, "Reference");
    return reference && !reference.startsWith("#");
  });
  const labels = ["label", "global_label", "hierarchical_label"]
    .flatMap((kind) => directChildren(schematic, kind))
    .map((label) => label[1])
    .filter((label) => typeof label === "string");
  const uniqueLabels = [...new Set(labels)].sort();

  const footprints = directChildren(board, "footprint");
  const pads = footprints.flatMap((footprint) => directChildren(footprint, "pad"));
  const copperLayers = directChildren(board, "layers")
    .flatMap((layers) => layers.slice(1))
    .filter((layer) => Array.isArray(layer) && layer[2] === "signal");
  const outline = boardOutlineSize(board);
  const expected = manifest.expected;

  assertEqual(childValue(schematic, "generator_version"), expected.kicadGeneratorVersion, "schematic generator version");
  assertEqual(childValue(board, "generator_version"), expected.kicadGeneratorVersion, "board generator version");
  assertEqual(schematicSymbols.length, expected.schematicSymbols, "schematic symbol count");
  assertEqual(schematicComponents.length, expected.schematicComponents, "schematic component count");
  assertEqual(uniqueLabels.length, expected.schematicUniqueLabels, "schematic unique label count");
  assertEqual(uniqueLabels, expected.labeledSignals, "schematic label names");
  assertEqual(copperLayers.length, expected.copperLayers, "copper layer count");
  assertEqual(footprints.length, expected.footprints, "footprint count");
  assertEqual(pads.length, expected.pads, "pad count");
  assertEqual(directChildren(board, "segment").length, expected.trackSegments, "track segment count");
  assertEqual(directChildren(board, "via").length, expected.vias, "via count");
  assertEqual(directChildren(board, "zone").length, expected.zones, "zone count");
  assertNear(outline.widthMm, expected.outlineWidthMm, "outline width");
  assertNear(outline.heightMm, expected.outlineHeightMm, "outline height");

  if (!uniqueLabels.includes(expected.selectedNetRoutingCandidate)) {
    throw new Error(`selected routing candidate ${expected.selectedNetRoutingCandidate} is not a schematic label`);
  }

  console.log(
    `PASS ${path.relative(repositoryRoot, fixtureDirectory)}: ` +
      `${schematicComponents.length} components, ${footprints.length} footprints, ${pads.length} pads, ` +
      `${directChildren(board, "segment").length} segments`
  );
}

function fixtureFile(manifest, extension, fixtureDirectory) {
  const file = manifest.files.find((candidate) => candidate.path.endsWith(extension));

  if (!file) {
    throw new Error(`manifest does not contain a ${extension} file`);
  }

  return safeFixturePath(fixtureDirectory, file.path);
}

function safeFixturePath(fixtureDirectory, relativePath) {
  const resolved = path.resolve(fixtureDirectory, relativePath);

  if (!resolved.startsWith(`${path.resolve(fixtureDirectory)}${path.sep}`)) {
    throw new Error(`fixture path escapes its directory: ${relativePath}`);
  }

  return resolved;
}

function boardOutlineSize(board) {
  const primitives = ["gr_line", "gr_rect", "gr_arc", "gr_circle", "gr_poly"]
    .flatMap((kind) => directChildren(board, kind))
    .filter((primitive) => childValue(primitive, "layer") === "Edge.Cuts");
  const coordinates = primitives.flatMap(collectCoordinates);

  if (coordinates.length === 0) {
    throw new Error("Edge.Cuts outline does not contain measurable coordinates");
  }

  const xCoordinates = coordinates.map((coordinate) => coordinate.x);
  const yCoordinates = coordinates.map((coordinate) => coordinate.y);

  return {
    heightMm: Math.max(...yCoordinates) - Math.min(...yCoordinates),
    widthMm: Math.max(...xCoordinates) - Math.min(...xCoordinates)
  };
}

function collectCoordinates(expression) {
  const coordinates = [];

  for (const item of expression.slice(1)) {
    if (!Array.isArray(item) || item.length === 0) {
      continue;
    }

    if (["start", "end", "mid", "center", "xy"].includes(item[0]) && item.length >= 3) {
      coordinates.push({ x: Number(item[1]), y: Number(item[2]) });
    }

    coordinates.push(...collectCoordinates(item));
  }

  return coordinates;
}

function directChildren(expression, head) {
  return expression.slice(1).filter((item) => Array.isArray(item) && item[0] === head);
}

function childValue(expression, head) {
  return directChildren(expression, head)[0]?.[1];
}

function propertyValue(expression, propertyName) {
  return directChildren(expression, "property").find((property) => property[1] === propertyName)?.[2];
}

function parseSExpression(source) {
  const stack = [];
  let root;

  for (const token of tokenize(source)) {
    if (token === "(") {
      const expression = [];

      if (stack.length > 0) {
        stack.at(-1).push(expression);
      } else if (root) {
        throw new Error("found more than one top-level expression");
      } else {
        root = expression;
      }

      stack.push(expression);
    } else if (token === ")") {
      if (stack.length === 0) {
        throw new Error("found an unmatched closing parenthesis");
      }

      stack.pop();
    } else {
      if (stack.length === 0) {
        throw new Error("found a token outside the top-level expression");
      }

      stack.at(-1).push(token);
    }
  }

  if (!root || stack.length !== 0) {
    throw new Error("found an incomplete S-expression");
  }

  return root;
}

function* tokenize(source) {
  let index = 0;

  while (index < source.length) {
    const character = source[index];

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

    while (index < source.length && !/[\s();]/u.test(source[index])) {
      index += 1;
    }

    yield source.slice(start, index);
  }
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertNear(actual, expected, label) {
  if (Math.abs(actual - expected) > 1e-6) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}
