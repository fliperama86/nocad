import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceDirectory = path.join(
  repositoryRoot,
  "references",
  "north-star",
  "pico-retrodigital-main"
);
const options = parseArguments(process.argv.slice(2));

if (!options.source || !options.kicadCli) {
  console.error(
    "Usage: node scripts/capture-north-star-schematic.mjs " +
      "--source <pico-retrodigital.kicad_sch> --kicad-cli <kicad-cli> [--output <connectivity.json>]"
  );
  process.exitCode = 2;
} else {
  const outputPath = path.resolve(
    options.output ?? path.join(referenceDirectory, "schematic-connectivity.json")
  );
  const sourcePath = path.resolve(options.source);
  const inventoryPath = path.join(referenceDirectory, "inventory.json");
  const manifestPath = path.join(referenceDirectory, "manifest.json");
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "nocad-north-star-"));

  try {
    const [sourceContents, inventoryContents, manifestContents] = await Promise.all([
      readFile(sourcePath),
      readFile(inventoryPath, "utf8"),
      readFile(manifestPath, "utf8")
    ]);
    const inventory = JSON.parse(inventoryContents);
    const manifest = JSON.parse(manifestContents);
    verifyPinnedSchematic(sourcePath, sourceContents, manifest);

    const netlistPath = path.join(temporaryDirectory, "schematic.net");
    await execFileAsync(options.kicadCli, [
      "sch",
      "export",
      "netlist",
      "--format",
      "kicadsexpr",
      "--output",
      netlistPath,
      sourcePath
    ]);

    const [schematic, netlist] = await Promise.all([
      Promise.resolve(parseSExpression(sourceContents.toString("utf8"))),
      readFile(netlistPath, "utf8").then(parseSExpression)
    ]);
    const connectivity = captureConnectivity({
      inventory,
      manifest,
      netlist,
      schematic,
      sourcePath,
      sourceSha256: sha256(sourceContents)
    });

    await writeFile(outputPath, `${JSON.stringify(connectivity, null, 2)}\n`);
    console.log(
      `Captured ${connectivity.nets.length} schematic nets, ` +
        `${connectivity.objects.wires.length} wires, and ` +
        `${connectivity.objects.virtualPowerSymbols.length} virtual power symbols in ` +
        path.relative(repositoryRoot, outputPath)
    );
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function captureConnectivity({ inventory, manifest, netlist, schematic, sourcePath, sourceSha256 }) {
  assertEqual(schematic[0], "kicad_sch", "schematic root");
  assertEqual(netlist[0], "export", "netlist root");

  const physicalByReference = new Map(
    inventory.components.map((component) => [component.referenceAtCapture, component])
  );
  const placedSymbols = directChildren(schematic, "symbol");
  const librarySymbols = new Map(
    directChildren(requiredChild(schematic, "lib_symbols"), "symbol").map((symbol) => [
      stringAt(symbol, 1, "library symbol id"),
      symbol
    ])
  );
  const netlistComponents = new Map(
    directChildren(requiredChild(netlist, "components"), "comp").map((component) => [
      requiredChildValue(component, "ref"),
      component
    ])
  );
  const exportedNets = directChildren(requiredChild(netlist, "nets"), "net").map((net) => ({
    name: requiredChildValue(net, "name"),
    nodes: directChildren(net, "node").map((node) => ({
      pin: requiredChildValue(node, "pin"),
      reference: requiredChildValue(node, "ref")
    }))
  }));
  const netByReferencePin = new Map();

  for (const net of exportedNets) {
    for (const node of net.nodes) {
      const key = referencePinKey(node.reference, node.pin);
      if (netByReferencePin.has(key)) {
        throw new Error(`netlist member occurs more than once: ${key}`);
      }
      netByReferencePin.set(key, net.name);
    }
  }

  const physicalComponents = [];
  const virtualPowerSymbols = [];
  const electricalPoints = [];

  for (const symbol of placedSymbols) {
    const schematicUuid = requiredChildValue(symbol, "uuid");
    const libId = requiredChildValue(symbol, "lib_id");
    const reference = requiredPropertyValue(symbol, "Reference");
    const value = requiredPropertyValue(symbol, "Value");
    const placement = pointFromAt(requiredChild(symbol, "at"));
    const placedPins = directChildren(symbol, "pin");
    const pinPositions = placedPinPositions(symbol, librarySymbols.get(libId));

    if (reference.startsWith("#")) {
      if (!libId.startsWith("power:")) {
        throw new Error(`${reference} is virtual but does not use a power library symbol`);
      }
      assertEqual(placedPins.length, 1, `${reference} virtual power pin count`);
      const pin = placedPins[0];
      const pinNumber = stringAt(pin, 1, `${reference} pin number`);
      const pinUuid = requiredChildValue(pin, "uuid");
      const definition = pinPositions.get(pinNumber);
      const at = definition?.at ?? placement.point;
      const captured = {
        at,
        classification: libId === "power:PWR_FLAG" ? "erc-power-flag" : "global-power",
        electricalType: definition?.electricalType ?? null,
        libId,
        net: null,
        pinUuid,
        reference,
        schematicUuid,
        value
      };
      virtualPowerSymbols.push(captured);
      electricalPoints.push({ at, kind: "power", object: captured });
      continue;
    }

    const inventoryComponent = physicalByReference.get(reference);
    if (!inventoryComponent) {
      throw new Error(`placed physical symbol is absent from inventory: ${reference}`);
    }
    assertEqual(schematicUuid, inventoryComponent.schematicUuid, `${reference} schematic UUID`);
    const exportedComponent = netlistComponents.get(reference);
    if (!exportedComponent) {
      throw new Error(`placed physical symbol is absent from exported netlist: ${reference}`);
    }
    assertEqual(requiredChildValue(exportedComponent, "tstamps"), schematicUuid, `${reference} netlist UUID`);

    const pins = placedPins
      .map((pin) => {
        const number = stringAt(pin, 1, `${reference} pin number`);
        const pinUuid = requiredChildValue(pin, "uuid");
        const net = netByReferencePin.get(referencePinKey(reference, number)) ?? null;
        const definition = pinPositions.get(number);
        if (!definition) {
          throw new Error(`${reference} pin ${number} has no embedded-library position`);
        }
        const captured = {
          at: definition.at,
          electricalType: definition.electricalType,
          hidden: definition.hidden,
          intentionalNoConnect: definition.electricalType === "no_connect" ? "intrinsic-pin-type" : null,
          name: definition.name,
          net,
          number,
          pinUuid
        };
        electricalPoints.push({ at: definition.at, kind: "physical-pin", object: captured, reference });
        return captured;
      })
      .sort(compareBy("pinUuid"));
    physicalComponents.push({ pins, reference, schematicUuid });
  }

  const wires = directChildren(schematic, "wire")
    .map((wire) => {
      const points = directChildren(requiredChild(wire, "pts"), "xy").map(pointFromXy);
      assertEqual(points.length, 2, "wire endpoint count");
      return { endpoints: points, net: null, uuid: requiredChildValue(wire, "uuid") };
    })
    .sort(compareBy("uuid"));
  const junctions = directChildren(schematic, "junction")
    .map((junction) => ({
      at: pointFromAt(requiredChild(junction, "at")).point,
      net: null,
      uuid: requiredChildValue(junction, "uuid")
    }))
    .sort(compareBy("uuid"));
  const labels = [
    ...directChildren(schematic, "global_label").map((label) => captureLabel(label, "global")),
    ...directChildren(schematic, "label").map((label) => captureLabel(label, "local"))
  ].sort(compareBy("uuid"));
  const noConnects = directChildren(schematic, "no_connect")
    .map((marker) => ({
      at: pointFromAt(requiredChild(marker, "at")).point,
      net: null,
      pinUuid: null,
      uuid: requiredChildValue(marker, "uuid")
    }))
    .sort(compareBy("uuid"));

  assignSchematicObjectNets({
    electricalPoints,
    junctions,
    labels,
    noConnects,
    virtualPowerSymbols,
    wires
  });

  const physicalPinsByUuid = new Map(
    physicalComponents.flatMap((component) => component.pins.map((pin) => [pin.pinUuid, pin]))
  );
  for (const marker of noConnects) {
    const pin = physicalPinsByUuid.get(marker.pinUuid);
    if (!pin || pin.intentionalNoConnect !== null) {
      throw new Error(`no-connect ${marker.uuid} does not resolve to one unmarked physical pin`);
    }
    pin.intentionalNoConnect = "marker";
  }

  const nets = exportedNets
    .map((exportedNet) => {
      const memberPinUuids = exportedNet.nodes
        .map(({ pin, reference }) => {
          const component = physicalComponents.find((candidate) => candidate.reference === reference);
          const placedPin = component?.pins.find((candidate) => candidate.number === pin);
          if (!placedPin) {
            throw new Error(`${exportedNet.name} refers to missing placed pin ${reference}.${pin}`);
          }
          return placedPin.pinUuid;
        })
        .sort();
      return {
        junctions: junctions
          .filter((junction) => junction.net === exportedNet.name)
          .map((junction) => junction.uuid)
          .sort(),
        labels: labels.filter((label) => label.net === exportedNet.name).map((label) => label.uuid).sort(),
        memberPinUuids,
        membershipSha256: sha256(Buffer.from(`${memberPinUuids.join("\n")}\n`)),
        name: exportedNet.name,
        noConnects: noConnects
          .filter((marker) => marker.net === exportedNet.name)
          .map((marker) => marker.uuid)
          .sort(),
        virtualPowerSymbols: virtualPowerSymbols
          .filter((symbol) => symbol.net === exportedNet.name)
          .map((symbol) => symbol.schematicUuid)
          .sort(),
        wires: wires.filter((wire) => wire.net === exportedNet.name).map((wire) => wire.uuid).sort()
      };
    })
    .sort(compareBy("name"));

  const unresolvedObjects = [
    ...wires.filter((wire) => wire.net === null).map((wire) => `wire:${wire.uuid}`),
    ...junctions.filter((junction) => junction.net === null).map((junction) => `junction:${junction.uuid}`),
    ...labels.filter((label) => label.net === null).map((label) => `label:${label.uuid}`),
    ...noConnects.filter((marker) => marker.net === null).map((marker) => `no-connect:${marker.uuid}`),
    ...virtualPowerSymbols
      .filter((symbol) => symbol.net === null)
      .map((symbol) => `power-symbol:${symbol.schematicUuid}`)
  ].sort();
  if (unresolvedObjects.length > 0) {
    throw new Error(`schematic objects have no electrical membership: ${unresolvedObjects.join(", ")}`);
  }

  const boardComparison = compareWithBoard({ inventory, physicalComponents });
  const tool = requiredChildValue(requiredChild(netlist, "design"), "tool");
  const sourceScope = {
    busEntries: directChildren(schematic, "bus_entry").length,
    buses: directChildren(schematic, "bus").length,
    childSheets: directChildren(schematic, "sheet").length,
    hierarchicalLabels: directChildren(schematic, "hierarchical_label").length,
    rootSheetInstances: directChildren(requiredChild(schematic, "sheet_instances"), "path").length,
    rootUuid: requiredChildValue(schematic, "uuid")
  };
  for (const net of nets) {
    const topologyRecords = [
      ...net.junctions.map((uuid) => `junction\0${uuid}\n`),
      ...net.labels.map((uuid) => `label\0${uuid}\n`),
      ...net.noConnects.map((uuid) => `no-connect\0${uuid}\n`),
      ...net.virtualPowerSymbols.map((uuid) => `power-symbol\0${uuid}\n`),
      ...net.wires.map((uuid) => `wire\0${uuid}\n`)
    ].sort();
    net.topologyEvidenceSha256 = sha256(Buffer.from(topologyRecords.join("")));
  }
  const schematicConnectivityEncoding =
    "nets sorted by name; each record is name + NUL + membership SHA-256 + NUL + topology-evidence SHA-256 + LF";
  const schematicConnectivitySha256 = sha256(
    Buffer.from(
      nets
        .map(
          (net) =>
            `${net.name}\0${net.membershipSha256}\0${net.topologyEvidenceSha256}\n`
        )
        .join("")
    )
  );

  return {
    schema: "nocad.north-star-schematic-connectivity.v1",
    referenceId: manifest.id,
    aggregates: {
      schematicConnectivityEncoding,
      schematicConnectivitySha256
    },
    capture: {
      method: "KiCad canonical netlist plus normalized native schematic objects",
      netlistFormat: "kicadsexpr",
      sourceFile: path.basename(sourcePath),
      sourceSha256,
      sourceScope,
      tool,
      verificationScope:
        "Repository verification checks this normalized capture and its comparison closure; it does not re-run KiCad or read the omitted source."
    },
    counts: {
      globalLabels: labels.filter((label) => label.kind === "global").length,
      hiddenPhysicalPins: physicalComponents.reduce(
        (sum, component) => sum + component.pins.filter((pin) => pin.hidden).length,
        0
      ),
      junctions: junctions.length,
      localLabels: labels.filter((label) => label.kind === "local").length,
      netMembers: nets.reduce((sum, net) => sum + net.memberPinUuids.length, 0),
      nets: nets.length,
      noConnects: noConnects.length,
      physicalComponents: physicalComponents.length,
      physicalPins: physicalComponents.reduce((sum, component) => sum + component.pins.length, 0),
      virtualPowerSymbols: virtualPowerSymbols.length,
      wires: wires.length
    },
    objects: {
      junctions,
      labels,
      noConnects,
      physicalComponents: physicalComponents.sort(compareBy("schematicUuid")),
      virtualPowerSymbols: virtualPowerSymbols.sort(compareBy("schematicUuid")),
      wires
    },
    nets,
    boardComparison
  };
}

function assignSchematicObjectNets({
  electricalPoints,
  junctions,
  labels,
  noConnects,
  virtualPowerSymbols,
  wires
}) {
  const allPoints = new Map();
  const parent = new Map();
  const ensurePoint = (point) => {
    const key = pointKey(point);
    if (!allPoints.has(key)) {
      allPoints.set(key, point);
      parent.set(key, key);
    }
    return key;
  };
  const find = (key) => {
    let current = key;
    while (parent.get(current) !== current) {
      current = parent.get(current);
    }
    let pathKey = key;
    while (parent.get(pathKey) !== current) {
      const next = parent.get(pathKey);
      parent.set(pathKey, current);
      pathKey = next;
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot < rightRoot ? leftRoot : rightRoot);
      parent.set(leftRoot, leftRoot < rightRoot ? leftRoot : rightRoot);
    }
  };

  for (const point of [
    ...electricalPoints.map((item) => item.at),
    ...junctions.map((item) => item.at),
    ...labels.map((item) => item.at),
    ...noConnects.map((item) => item.at),
    ...wires.flatMap((wire) => wire.endpoints)
  ]) {
    ensurePoint(point);
  }

  const connectionAnchors = [
    ...allPoints.entries()
      .filter(([key]) =>
        wires.some((wire) => wire.endpoints.some((endpoint) => pointKey(endpoint) === key))
      )
      .map(([, point]) => point),
    ...junctions.map((item) => item.at),
    ...electricalPoints.map((item) => item.at),
    ...labels.map((item) => item.at)
  ];

  for (const wire of wires) {
    const [start, end] = wire.endpoints;
    const startKey = ensurePoint(start);
    const endKey = ensurePoint(end);
    union(startKey, endKey);
    for (const anchor of connectionAnchors) {
      if (pointOnSegment(anchor, start, end)) {
        union(startKey, ensurePoint(anchor));
      }
    }
  }

  const namesByRoot = new Map();
  const addName = (point, net) => {
    if (net === null) {
      return;
    }
    const root = find(ensurePoint(point));
    if (!namesByRoot.has(root)) {
      namesByRoot.set(root, new Set());
    }
    namesByRoot.get(root).add(net);
  };

  for (const item of electricalPoints) {
    if (item.kind === "physical-pin") {
      addName(item.at, item.object.net);
    }
  }
  for (const label of labels) {
    addName(label.at, label.text);
  }
  for (const symbol of virtualPowerSymbols) {
    if (symbol.libId !== "power:PWR_FLAG") {
      addName(symbol.at, symbol.value);
    }
  }

  const netAt = (point, label) => {
    const names = [...(namesByRoot.get(find(ensurePoint(point))) ?? [])].sort();
    if (names.length !== 1) {
      throw new Error(`${label} resolves to ${names.length} net names: ${names.join(", ")}`);
    }
    return names[0];
  };

  for (const wire of wires) {
    wire.net = netAt(wire.endpoints[0], `wire ${wire.uuid}`);
  }
  for (const junction of junctions) {
    junction.net = netAt(junction.at, `junction ${junction.uuid}`);
  }
  for (const label of labels) {
    label.net = netAt(label.at, `label ${label.uuid}`);
  }
  for (const symbol of virtualPowerSymbols) {
    symbol.net = netAt(symbol.at, `power symbol ${symbol.reference}`);
  }
  for (const marker of noConnects) {
    marker.net = netAt(marker.at, `no-connect ${marker.uuid}`);
    const pins = electricalPoints.filter(
      (point) => point.kind === "physical-pin" && pointKey(point.at) === pointKey(marker.at)
    );
    if (pins.length !== 1) {
      throw new Error(`no-connect ${marker.uuid} touches ${pins.length} physical pins`);
    }
    marker.pinUuid = pins[0].object.pinUuid;
  }
}

function compareWithBoard({ inventory, physicalComponents }) {
  const schematicPinsByComponent = new Map(
    physicalComponents.map((component) => [component.schematicUuid, component.pins])
  );
  const matchedBoardPads = [];
  const boardOnlyPads = [];
  const duplicateImplementations = [];
  const mismatches = [];

  for (const component of inventory.components) {
    const schematicPins = schematicPinsByComponent.get(component.schematicUuid);
    if (!schematicPins) {
      throw new Error(`board comparison is missing schematic component ${component.referenceAtCapture}`);
    }
    const pinsByNumber = new Map(schematicPins.map((pin) => [pin.number, pin]));
    const padsByNumber = new Map();

    for (const footprint of component.boardFootprints) {
      for (const pad of footprint.pins) {
        const key = pad.number;
        if (!padsByNumber.has(key)) {
          padsByNumber.set(key, []);
        }
        padsByNumber.get(key).push({
          footprintReference: footprint.referenceAtCapture,
          footprintUuid: footprint.uuid,
          net: pad.net,
          number: pad.number,
          padUuid: pad.uuid
        });
      }
    }

    for (const pin of schematicPins) {
      const pads = (padsByNumber.get(pin.number) ?? []).sort(compareBy("padUuid"));
      if (pads.length === 0) {
        mismatches.push({
          actualBoardNets: [],
          expectedSchematicNet: pin.net,
          id: `${component.schematicUuid}:${pin.pinUuid}`,
          kind: "missing-board-pad",
          pinNumber: pin.number,
          reference: component.referenceAtCapture
        });
        continue;
      }
      const actualNets = [...new Set(pads.map((pad) => pad.net))].sort(compareNullableText);
      if (actualNets.length !== 1 || actualNets[0] !== pin.net) {
        mismatches.push({
          actualBoardNets: actualNets,
          expectedSchematicNet: pin.net,
          id: `${component.schematicUuid}:${pin.pinUuid}`,
          kind: "net-membership-mismatch",
          pinNumber: pin.number,
          reference: component.referenceAtCapture
        });
        continue;
      }
      for (const pad of pads) {
        matchedBoardPads.push({ padUuid: pad.padUuid, pinUuid: pin.pinUuid });
      }
      if (component.boardFootprints.length > 1) {
        duplicateImplementations.push({
          boardPads: pads.map((pad) => pad.padUuid),
          footprintUuids: [...new Set(pads.map((pad) => pad.footprintUuid))].sort(),
          net: pin.net,
          pinNumber: pin.number,
          pinUuid: pin.pinUuid,
          reference: component.referenceAtCapture,
          schematicUuid: component.schematicUuid,
          reviewedIssue: "duplicate-c5-footprint"
        });
      }
    }

    for (const pads of padsByNumber.values()) {
      if (pinsByNumber.has(pads[0].number)) {
        continue;
      }
      for (const pad of pads) {
        boardOnlyPads.push({
          footprintReference: pad.footprintReference,
          footprintUuid: pad.footprintUuid,
          net: pad.net,
          number: pad.number,
          padUuid: pad.padUuid,
          reason:
            (pad.number === "" || pad.number === "MP") && pad.net === null
              ? "mechanical-or-footprint-only"
              : "no-schematic-pin"
        });
      }
    }
  }

  const excludedBoardPads = boardOnlyPads
    .filter((pad) => pad.reason === "mechanical-or-footprint-only")
    .sort(compareBy("padUuid"));
  assertEqual(excludedBoardPads.length, 22, "exact non-electrical board-pad exclusion count");
  assertEqual(
    sha256(Buffer.from(`${excludedBoardPads.map((pad) => pad.padUuid).join("\n")}\n`)),
    "d42db0afbd6d1c78c470e355a12f982519916b5d4424cf1501dd88ffa7a91213",
    "exact non-electrical board-pad exclusion UUID digest"
  );
  const unmatchedElectricalPads = boardOnlyPads
    .filter((pad) => pad.reason === "no-schematic-pin")
    .sort(compareBy("padUuid"));
  const discrepancies = mismatches.map((mismatch) => withDiscrepancyFingerprint(mismatch));
  assertEqual(
    unmatchedElectricalPads.map((pad) => ({
      net: pad.net,
      number: pad.number,
      padUuid: pad.padUuid,
      reference: pad.footprintReference
    })),
    [
      {
        net: null,
        number: "A8",
        padUuid: "3ae45182-b4b8-4610-bb0d-0e237ee03ce7",
        reference: "J5"
      },
      {
        net: null,
        number: "B8",
        padUuid: "46918cf2-1e2c-465d-8390-5c811d6f8b43",
        reference: "J5"
      }
    ],
    "exact J5 SBU discrepancy pads"
  );
  const references = [...new Set(unmatchedElectricalPads.map((pad) => pad.footprintReference))].sort();
  discrepancies.push(
    withDiscrepancyFingerprint({
      id: "j5-sbu-footprint-only-pads",
      kind: "board-pads-without-schematic-pins",
      padUuids: unmatchedElectricalPads.map((pad) => pad.padUuid),
      references,
      detail:
        "The USB-C footprint has unconnected A8 and B8 SBU pads, while the captured USB2-only schematic symbol has no corresponding pins."
    })
  );
  discrepancies.sort(compareBy("id"));
  const waivers = discrepancies
    .filter((discrepancy) => discrepancy.id === "j5-sbu-footprint-only-pads")
    .map((discrepancy) => ({
      discrepancyFingerprint: discrepancy.fingerprint,
      id: "waive-j5-sbu-footprint-only-pads",
      justification:
        "A8 and B8 are USB-C SBU contacts intentionally unused by this USB2 design; both PCB pads are unconnected and the schematic symbol deliberately omits them."
    }));
  const waivedFingerprints = new Set(waivers.map((waiver) => waiver.discrepancyFingerprint));
  const openDiscrepancyCount = discrepancies.filter(
    (discrepancy) => !waivedFingerprints.has(discrepancy.fingerprint)
  ).length;

  return {
    discrepancies,
    duplicateImplementations: duplicateImplementations.sort(compareBy("pinUuid")),
    excludedBoardPads,
    matchedBoardPads: matchedBoardPads.sort(compareBy("padUuid")),
    status: openDiscrepancyCount === 0 ? "equivalent-with-exact-waiver" : "open-discrepancies",
    summary: {
      discrepancyCount: discrepancies.length,
      duplicateImplementationPinCount: duplicateImplementations.length,
      excludedBoardPadCount: excludedBoardPads.length,
      matchedBoardPadCount: matchedBoardPads.length,
      openDiscrepancyCount,
      schematicPinCount: physicalComponents.reduce((sum, component) => sum + component.pins.length, 0)
    },
    waivers
  };
}

function withDiscrepancyFingerprint(discrepancy) {
  const canonical = canonicalJson(discrepancy);
  return { ...discrepancy, fingerprint: sha256(Buffer.from(`${canonical}\n`)) };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function placedPinPositions(placedSymbol, librarySymbol) {
  if (!librarySymbol) {
    throw new Error(`placed symbol uses missing embedded library ${requiredChildValue(placedSymbol, "lib_id")}`);
  }
  const unit = Number(requiredChildValue(placedSymbol, "unit"));
  const bodyStyle = Number(requiredChildValue(placedSymbol, "body_style"));
  const placement = pointFromAt(requiredChild(placedSymbol, "at"));
  const mirror = directChildren(placedSymbol, "mirror")[0]?.[1] ?? null;
  const definitions = new Map();

  for (const childSymbol of directChildren(librarySymbol, "symbol")) {
    const name = stringAt(childSymbol, 1, "library child symbol name");
    const match = /_(\d+)_(\d+)$/u.exec(name);
    if (!match) {
      continue;
    }
    const childUnit = Number(match[1]);
    const childBodyStyle = Number(match[2]);
    if ((childUnit !== 0 && childUnit !== unit) || (childBodyStyle !== 0 && childBodyStyle !== bodyStyle)) {
      continue;
    }
    for (const pin of directChildren(childSymbol, "pin")) {
      const number = requiredChildValue(pin, "number");
      const local = pointFromAt(requiredChild(pin, "at")).point;
      const transformed = transformPoint(local, placement.point, placement.rotation, mirror);
      const definition = {
        at: transformed,
        electricalType: stringAt(pin, 1, `pin ${number} electrical type`),
        hidden: requiredChildValueOrNull(pin, "hide") === "yes",
        name: requiredChildValue(pin, "name")
      };
      const existing = definitions.get(number);
      if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) {
        throw new Error(`embedded library has conflicting positions for pin ${number}`);
      }
      definitions.set(number, definition);
    }
  }
  return definitions;
}

function transformPoint(local, origin, rotation, mirror) {
  const [x, y] = local;
  if (mirror !== null && mirror !== "x" && mirror !== "y") {
    throw new Error(`unsupported symbol mirror ${mirror}`);
  }
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const rotated =
    normalizedRotation === 0
      ? [x, -y]
      : normalizedRotation === 90
        ? [-y, -x]
        : normalizedRotation === 180
          ? [-x, y]
          : normalizedRotation === 270
            ? [y, x]
            : null;
  if (!rotated) {
    throw new Error(`unsupported symbol rotation ${rotation}`);
  }
  if (mirror === "x") {
    rotated[1] = -rotated[1];
  } else if (mirror === "y") {
    rotated[0] = -rotated[0];
  }
  return normalizePoint([origin[0] + rotated[0], origin[1] + rotated[1]]);
}

function captureLabel(label, kind) {
  const placement = pointFromAt(requiredChild(label, "at"));
  return {
    at: placement.point,
    kind,
    net: null,
    orientation: placement.rotation,
    shape: requiredChildValueOrNull(label, "shape"),
    text: stringAt(label, 1, `${kind} label text`),
    uuid: requiredChildValue(label, "uuid")
  };
}

function pointFromXy(expression) {
  return normalizePoint([
    Number(stringAt(expression, 1, "point x")),
    Number(stringAt(expression, 2, "point y"))
  ]);
}

function pointFromAt(expression) {
  return {
    point: normalizePoint([
      Number(stringAt(expression, 1, "point x")),
      Number(stringAt(expression, 2, "point y"))
    ]),
    rotation: Number(expression[3] ?? "0")
  };
}

function normalizePoint([x, y]) {
  return [normalizeNumber(x), normalizeNumber(y)];
}

function normalizeNumber(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`invalid coordinate ${value}`);
  }
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function pointKey(point) {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
}

function pointOnSegment(point, start, end) {
  const cross =
    (point[0] - start[0]) * (end[1] - start[1]) -
    (point[1] - start[1]) * (end[0] - start[0]);
  if (Math.abs(cross) > 1e-6) {
    return false;
  }
  return (
    point[0] >= Math.min(start[0], end[0]) - 1e-6 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-6 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-6 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-6
  );
}

function verifyPinnedSchematic(sourcePath, sourceContents, manifest) {
  const sourceName = path.basename(sourcePath);
  const pin = manifest.pin?.files?.find((file) => file.path === sourceName);
  if (!pin) {
    throw new Error(`manifest does not pin ${sourceName}`);
  }
  assertEqual(sourceContents.byteLength, pin.bytes, `${sourceName} byte size`);
  assertEqual(sha256(sourceContents), pin.sha256, `${sourceName} SHA-256`);
}

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!value || !["--source", "--kicad-cli", "--output"].includes(flag)) {
      return {};
    }
    parsed[flag.slice(2).replace("kicad-cli", "kicadCli")] = value;
  }
  return parsed;
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

function directChildren(expression, head) {
  return expression.slice(1).filter((item) => Array.isArray(item) && item[0] === head);
}

function requiredChild(expression, head) {
  const children = directChildren(expression, head);
  if (children.length !== 1) {
    throw new Error(`${expression[0]} must have exactly one ${head} child`);
  }
  return children[0];
}

function requiredChildValue(expression, head) {
  return stringAt(requiredChild(expression, head), 1, `${head} value`);
}

function requiredChildValueOrNull(expression, head) {
  const children = directChildren(expression, head);
  if (children.length > 1) {
    throw new Error(`${expression[0]} must not have more than one ${head} child`);
  }
  return children.length === 0 ? null : stringAt(children[0], 1, `${head} value`);
}

function requiredPropertyValue(expression, propertyName) {
  const property = directChildren(expression, "property").find((item) => item[1] === propertyName);
  return stringAt(property, 2, `${propertyName} property value`);
}

function stringAt(expression, index, label) {
  const value = expression?.[index];
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function referencePinKey(reference, pin) {
  return `${reference}\0${pin}`;
}

function compareBy(key) {
  return (left, right) => (String(left[key]) < String(right[key]) ? -1 : String(left[key]) > String(right[key]) ? 1 : 0);
}

function compareNullableText(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
