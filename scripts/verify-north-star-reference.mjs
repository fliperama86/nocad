import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referencesRoot = path.join(repositoryRoot, "references", "north-star");
const referenceDirectories = (await readdir(referencesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(referencesRoot, entry.name))
  .sort();

let failed = false;

for (const referenceDirectory of referenceDirectories) {
  try {
    const { connectivity, inventory, manifest } = await loadReference(referenceDirectory);
    verifyReference(manifest, inventory, connectivity, path.basename(referenceDirectory));
    runMutationChecks(manifest, inventory, connectivity);
    await verifyNoSourceCopies(referenceDirectory);
    console.log(
      `PASS ${path.relative(repositoryRoot, referenceDirectory)}: ` +
        `${inventory.components.length} components, ${inventory.sourceFacts.counts.boardFootprints} footprints, ` +
        `${inventory.sourceFacts.counts.pads} pads, ${inventory.nets.length} nets, ` +
        `${connectivity.objects.virtualPowerSymbols.length} virtual power symbols`
    );
  } catch (error) {
    failed = true;
    console.error(`FAIL ${path.relative(repositoryRoot, referenceDirectory)}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${referenceDirectories.length} north-star reference${referenceDirectories.length === 1 ? "" : "s"}.`
  );
}

async function loadReference(referenceDirectory) {
  const manifestPath = path.join(referenceDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const inventoryPath = safeReferencePath(referenceDirectory, manifest.inventory?.path);
  const connectivityPath = safeReferencePath(
    referenceDirectory,
    manifest.schematicConnectivity?.path
  );
  const [inventoryContents, inventoryStat, connectivityContents, connectivityStat] = await Promise.all([
    readFile(inventoryPath),
    stat(inventoryPath),
    readFile(connectivityPath),
    stat(connectivityPath)
  ]);

  assertEqual(inventoryStat.size, manifest.inventory?.bytes, "inventory byte size");
  assertEqual(sha256(inventoryContents), manifest.inventory?.sha256, "inventory SHA-256");
  assertEqual(
    connectivityStat.size,
    manifest.schematicConnectivity?.bytes,
    "schematic-connectivity byte size"
  );
  assertEqual(
    sha256(connectivityContents),
    manifest.schematicConnectivity?.sha256,
    "schematic-connectivity SHA-256"
  );

  return {
    connectivity: JSON.parse(connectivityContents.toString("utf8")),
    inventory: JSON.parse(inventoryContents.toString("utf8")),
    manifest
  };
}

function verifyReference(manifest, inventory, connectivity, directoryId) {
  assertEqual(manifest.schema, "nocad.north-star-reference.v1", "manifest schema");
  assertEqual(inventory.schema, "nocad.north-star-inventory.v1", "inventory schema");
  assertEqual(manifest.id, directoryId, "manifest id and directory");
  assertEqual(inventory.referenceId, manifest.id, "inventory reference id");
  assertText(inventory.captureBasis, "inventory capture basis");

  if (!inventory.captureBasis.includes("does not re-prove extraction")) {
    throw new Error("inventory must state that verification does not re-prove omitted-source extraction");
  }

  verifyPin(manifest.pin);
  verifyRightsAndQualification(manifest);
  verifyInventory(inventory);
  verifySchematicConnectivity(connectivity, inventory, manifest);
}

function verifyPin(pin) {
  assertEqual(pin?.algorithm, "sha256", "pin algorithm");
  assertText(pin.aggregateEncoding, "pin aggregate encoding");
  assertSha256(pin.designAggregateSha256, "design aggregate SHA-256");
  assertSha256(pin.evidenceAggregateSha256, "evidence aggregate SHA-256");
  assertCanonicalObjects(pin.files, "path", "pinned files");
  assertUniqueStrings(pin.designFilePaths, "design file paths");
  assertEqual(pin.designFilePaths, [...pin.designFilePaths].sort(), "design file path canonical order");

  const paths = new Set();
  const statuses = new Set(["ignored-stale", "tracked-clean", "tracked-modified", "untracked"]);

  for (const file of pin.files) {
    assertSafeRelativePath(file.path, "pinned file path");
    assertText(file.role, `${file.path} role`);
    assertEnum(file.status, statuses, `${file.path} status`);
    assertPositiveInteger(file.bytes, `${file.path} bytes`);
    assertSha256(file.sha256, `${file.path} SHA-256`);

    if (paths.has(file.path)) {
      throw new Error(`pinned file path is duplicated: ${file.path}`);
    }
    paths.add(file.path);
  }

  for (const requiredPath of ["pico-retrodigital.kicad_pcb", "pico-retrodigital.kicad_sch"]) {
    if (!paths.has(requiredPath)) {
      throw new Error(`pin is missing required primary source ${requiredPath}`);
    }
  }

  const record = (file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`;
  const designFiles = pin.designFilePaths.map((designPath) => {
    const file = pin.files.find((candidate) => candidate.path === designPath);
    if (!file) {
      throw new Error(`design aggregate refers to missing pinned file ${designPath}`);
    }
    if (file.status === "ignored-stale" || file.status === "untracked") {
      throw new Error(`design aggregate includes non-authoritative file ${designPath}`);
    }
    return file;
  });
  assertEqual(
    sha256(Buffer.from(designFiles.map(record).join(""))),
    pin.designAggregateSha256,
    "design aggregate SHA-256"
  );
  assertEqual(
    sha256(Buffer.from(pin.files.map(record).join(""))),
    pin.evidenceAggregateSha256,
    "evidence aggregate SHA-256"
  );
}

function verifyRightsAndQualification(manifest) {
  assertEqual(manifest.source?.captureBasis, "working-tree-content", "source capture basis");
  assertEqual(manifest.source?.cleanAtCapture, false, "source clean-at-capture status");
  assertCanonicalObjects(manifest.source?.workspaceStatus, "path", "source workspace status");
  assertEqual(manifest.rights?.license, "NOASSERTION", "reference license");
  assertEqual(manifest.rights?.copyrightHolder, "NOASSERTION", "reference copyright holder");
  assertEqual(manifest.rights?.sourceFilesCopied, false, "source files copied flag");
  assertEqual(manifest.qualification?.golden, false, "golden qualification");
  assertEqual(manifest.qualification?.fabricated, "unknown", "fabrication qualification");
  assertEqual(manifest.qualification?.hardwareTested, "unknown", "hardware-test qualification");
  assertEqual(manifest.qualification?.currentDrc, "unknown", "current DRC qualification");
  assertEqual(manifest.qualification?.drcBaseline?.appliesToPinnedBoard, false, "stale DRC applicability");
  assertEqual(
    manifest.qualification?.fabricationBaseline?.appliesToPinnedBoard,
    false,
    "stale fabrication applicability"
  );
  assertCanonicalObjects(manifest.knownIssues, "id", "known issues");
}

function verifyInventory(inventory) {
  const counts = inventory.sourceFacts?.counts;
  const packageStatuses = new Set(["available", "partial", "planned", "unknown", "unsupported"]);
  const subsystemIds = new Set();

  assertCanonicalObjects(inventory.subsystems, "id", "subsystems");
  for (const subsystem of inventory.subsystems) {
    assertText(subsystem.id, "subsystem id");
    assertEnum(subsystem.nocadStatus, packageStatuses, `${subsystem.id} nocad status`);
    assertUniqueStrings(subsystem.componentReferences, `${subsystem.id} component references`);
    subsystemIds.add(subsystem.id);
  }

  assertCanonicalObjects(inventory.components, "schematicUuid", "components");
  const componentUuids = new Set();
  const componentOwnerByUuid = new Map();
  const footprintUuids = new Set();
  const padUuids = new Set();
  const referencesBySubsystem = new Map([...subsystemIds].map((id) => [id, []]));
  const netMembers = new Map();
  const netOwners = new Map();
  let footprintCount = 0;
  let padCount = 0;
  let assignedPadCount = 0;

  for (const component of inventory.components) {
    assertUuid(component.schematicUuid, `${component.referenceAtCapture} schematic UUID`);
    assertText(component.referenceAtCapture, `${component.schematicUuid} reference`);
    verifyImplementationMapping(
      component.nocad,
      "packageId",
      packageStatuses,
      `${component.referenceAtCapture} package mapping`
    );
    assertText(component.nocad?.note, `${component.referenceAtCapture} package status note`);

    if (componentUuids.has(component.schematicUuid)) {
      throw new Error(`schematic UUID is duplicated: ${component.schematicUuid}`);
    }
    componentUuids.add(component.schematicUuid);
    componentOwnerByUuid.set(component.schematicUuid, component.ownerSubsystem);

    if (!subsystemIds.has(component.ownerSubsystem)) {
      throw new Error(`${component.referenceAtCapture} has unknown subsystem owner ${component.ownerSubsystem}`);
    }
    referencesBySubsystem.get(component.ownerSubsystem).push(component.referenceAtCapture);

    assertCanonicalObjects(component.boardFootprints, "uuid", `${component.referenceAtCapture} footprints`);
    if (component.boardFootprints.length === 0) {
      throw new Error(`${component.referenceAtCapture} has no captured board footprint`);
    }

    for (const footprint of component.boardFootprints) {
      footprintCount += 1;
      assertUuid(footprint.uuid, `${component.referenceAtCapture} footprint UUID`);
      assertEqual(footprint.path, `/${component.schematicUuid}`, `${footprint.uuid} schematic path`);
      if (footprintUuids.has(footprint.uuid)) {
        throw new Error(`footprint UUID is duplicated: ${footprint.uuid}`);
      }
      footprintUuids.add(footprint.uuid);
      assertCanonicalObjects(footprint.pins, "uuid", `${footprint.uuid} pins`);

      for (const pin of footprint.pins) {
        padCount += 1;
        assertUuid(pin.uuid, `${footprint.uuid} pad UUID`);
        assertText(pin.number, `${pin.uuid} captured pad number`, { allowEmpty: true });
        if (padUuids.has(pin.uuid)) {
          throw new Error(`pad UUID is duplicated: ${pin.uuid}`);
        }
        padUuids.add(pin.uuid);

        if (pin.net !== null) {
          assignedPadCount += 1;
          assertText(pin.net, `${pin.uuid} net`);
          appendMapValue(netMembers, pin.net, pin.uuid);
          appendMapValue(netOwners, pin.net, component.ownerSubsystem);
        }
      }
    }
  }

  assertEqual(inventory.components.length, counts.schematicComponents, "schematic component count");
  assertEqual(footprintCount, counts.boardFootprints, "board footprint count");
  assertEqual(padCount, counts.pads, "pad count");
  assertEqual(assignedPadCount, counts.netAssignedPads, "net-assigned pad count");
  assertEqual(padCount - assignedPadCount, counts.unassignedPads, "unassigned pad count");
  assertEqual(padUuids.size, padCount, "stable pad UUID count");

  for (const subsystem of inventory.subsystems) {
    assertEqual(
      [...referencesBySubsystem.get(subsystem.id)].sort(),
      [...subsystem.componentReferences].sort(),
      `${subsystem.id} component ownership closure`
    );
  }

  verifyNetsAndCrossings(inventory, netMembers, netOwners);
  verifyInterfaces(inventory, componentOwnerByUuid, subsystemIds, netMembers, netOwners);
  verifyPowerDomains(inventory, netMembers);
  verifyBoardConstraints(inventory, netMembers);
  verifySupportCircuits(inventory, new Set(inventory.components.map((component) => component.referenceAtCapture)), netMembers);
  verifyIdentityAnomalies(inventory, componentUuids, footprintUuids);
  verifyStatusRegister(inventory.unsupportedOrUnknown);
  assertEqual(
    counts.schematicComponents + counts.schematicVirtualPowerSymbols,
    counts.schematicSymbolsTotal,
    "schematic physical/virtual symbol closure"
  );
  assertEqual(
    inventory.sourceFacts.schematicConnectivity?.powerSymbolCoverage,
    "individually-normalized",
    "schematic power-symbol coverage status"
  );
  assertEqual(inventory.sourceFacts.schematicConnectivity?.ercStatus, "unknown", "ERC status");
  assertEqual(
    inventory.sourceFacts.schematicConnectivity?.comparisonStatus,
    "equivalent-with-exact-waiver",
    "schematic/board comparison status"
  );
  if (inventory.unsupportedOrUnknown.some((item) => item.id === "schematic-power-symbol-closure")) {
    throw new Error("closed schematic power-symbol work remains in unsupported/unknown register");
  }
}

function verifyNetsAndCrossings(inventory, netMembers, netOwners) {
  assertCanonicalObjects(inventory.nets, "name", "nets");
  assertEqual(inventory.nets.length, inventory.sourceFacts.counts.boardNets, "board net count");
  assertEqual(
    inventory.nets.map((net) => net.name),
    [...netMembers.keys()].sort(),
    "net name closure"
  );

  for (const net of inventory.nets) {
    const members = [...netMembers.get(net.name)].sort();
    const owners = [...new Set(netOwners.get(net.name))].sort();
    assertEqual(net.memberCount, members.length, `${net.name} member count`);
    assertEqual(sha256(Buffer.from(`${members.join("\n")}\n`)), net.membershipSha256, `${net.name} membership digest`);
    assertEqual(net.ownerSubsystem, owners.length === 1 ? owners[0] : null, `${net.name} owner`);
  }

  const connectivityCanonical = inventory.nets
    .map((net) => `${net.name}\0${net.memberCount}\0${net.membershipSha256}\n`)
    .join("");
  assertEqual(
    sha256(Buffer.from(connectivityCanonical)),
    inventory.sourceFacts.connectivityAggregateSha256,
    "electrical connectivity aggregate SHA-256"
  );
  assertText(inventory.sourceFacts.connectivityAggregateEncoding, "electrical connectivity aggregate encoding");

  const derivedCrossings = [...netMembers.keys()]
    .flatMap((net) => {
      const subsystems = [...new Set(netOwners.get(net))].sort();
      return subsystems.length > 1 ? [{ net, subsystems }] : [];
    })
    .sort((left, right) => (left.net < right.net ? -1 : left.net > right.net ? 1 : 0));

  assertCanonicalObjects(inventory.crossSubsystemNets, "net", "cross-subsystem nets");
  assertEqual(
    inventory.crossSubsystemNets.map(({ net, subsystems }) => ({ net, subsystems })),
    derivedCrossings,
    "cross-subsystem net closure"
  );

  const interfacesById = new Map(inventory.interfaces.map((item) => [item.id, item]));
  const powerDomainIds = new Set(inventory.powerDomains.map((item) => item.net));
  for (const crossing of inventory.crossSubsystemNets) {
    if (crossing.declaration?.kind === "interface") {
      const boundary = interfacesById.get(crossing.declaration.id);
      if (!boundary || !boundary.nets.includes(crossing.net)) {
        throw new Error(`${crossing.net} has an unknown interface declaration`);
      }
    } else if (crossing.declaration?.kind === "powerDomain") {
      if (!powerDomainIds.has(crossing.declaration.id) || crossing.declaration.id !== crossing.net) {
        throw new Error(`${crossing.net} has an unknown power-domain declaration`);
      }
    } else {
      throw new Error(`${crossing.net} does not have exactly one supported boundary declaration`);
    }
  }
}

function verifyInterfaces(inventory, componentOwnerByUuid, subsystemIds, netMembers, netOwners) {
  const statuses = new Set(["available", "partial", "planned", "unknown", "unsupported"]);
  assertCanonicalObjects(inventory.interfaces, "id", "interfaces");

  for (const item of inventory.interfaces) {
    verifyImplementationMapping(item.nocad, "contractId", statuses, `${item.id} contract mapping`);
    assertText(item.nocad?.note, `${item.id} contract status note`);
    assertUniqueStrings(item.nets, `${item.id} nets`);
    for (const net of item.nets) {
      if (!netMembers.has(net)) {
        throw new Error(`${item.id} refers to unknown net ${net}`);
      }
    }

    if (item.kind === "external") {
      if (
        componentOwnerByUuid.get(item.connectorComponent) !== item.subsystem ||
        !subsystemIds.has(item.subsystem)
      ) {
        throw new Error(`${item.id} has an invalid external connector or subsystem`);
      }
    } else if (item.kind === "internal") {
      if (!subsystemIds.has(item.fromSubsystem) || !subsystemIds.has(item.toSubsystem)) {
        throw new Error(`${item.id} has an invalid internal subsystem endpoint`);
      }
      for (const net of item.nets) {
        const owners = new Set(netOwners.get(net));
        if (!owners.has(item.fromSubsystem) || !owners.has(item.toSubsystem)) {
          throw new Error(`${item.id} net ${net} does not cross both declared subsystems`);
        }
      }
    } else {
      throw new Error(`${item.id} has unsupported interface kind ${item.kind}`);
    }
  }
}

function verifyBoardConstraints(inventory, netMembers) {
  const constraints = inventory.sourceFacts.boardConstraints;
  assertEqual(constraints?.status, "captured", "board-constraint capture status");
  assertEnum(
    constraints?.nocadStatus,
    new Set(["available", "partial", "planned", "unknown", "unsupported"]),
    "board-constraint nocad status"
  );
  assertEqual(constraints.stackup?.declaredThicknessMm, inventory.sourceFacts.kicad.board.thicknessMm, "stackup thickness");
  assertCanonicalObjects(constraints.stackup?.copperLayers, "name", "stackup copper layers");
  assertEqual(constraints.stackup?.copperLayers.length, inventory.sourceFacts.counts.copperLayers, "stackup copper count");
  assertCanonicalObjects(constraints.netClasses, "name", "net classes");
  const netClassIds = new Set(constraints.netClasses.map((item) => item.name));
  assertCanonicalObjects(constraints.netClassAssignments, "net", "net-class assignments");
  for (const assignment of constraints.netClassAssignments) {
    if (!netMembers.has(assignment.net) || !netClassIds.has(assignment.netClass)) {
      throw new Error(`invalid net-class assignment for ${assignment.net}`);
    }
  }
  assertCanonicalObjects(constraints.netClassPatterns, "pattern", "net-class patterns");
  for (const pattern of constraints.netClassPatterns) {
    if (!netClassIds.has(pattern.netClass)) {
      throw new Error(`invalid patterned net class ${pattern.netClass}`);
    }
  }
  assertCanonicalObjects(constraints.differentialPairs, "id", "differential pairs");
  const assignmentByNet = new Map(
    constraints.netClassAssignments.map((assignment) => [assignment.net, assignment.netClass])
  );
  for (const pair of constraints.differentialPairs) {
    if (!netMembers.has(pair.positiveNet) || !netMembers.has(pair.negativeNet)) {
      throw new Error(`${pair.id} differential pair refers to an unknown net`);
    }
    assertEqual(assignmentByNet.get(pair.positiveNet), pair.netClass, `${pair.id} positive net class`);
    assertEqual(assignmentByNet.get(pair.negativeNet), pair.netClass, `${pair.id} negative net class`);
  }
  assertCanonicalObjects(constraints.customRules, "id", "custom board rules");
  for (const rule of constraints.customRules) {
    assertUniqueStrings(rule.netAllowlist, `${rule.id} net allowlist`);
    for (const net of rule.netAllowlist) {
      if (!netMembers.has(net)) {
        throw new Error(`${rule.id} refers to unknown net ${net}`);
      }
    }
    assertEnum(rule.nocadStatus, new Set(["available", "partial", "planned", "unknown", "unsupported"]), `${rule.id} nocad status`);
  }
  assertCanonicalObjects(constraints.zones, "uuid", "board zones");
  assertEqual(constraints.zones.length, inventory.sourceFacts.counts.zones, "zone count");
  assertEqual(
    constraints.zones.reduce((sum, zone) => sum + zone.filledPolygons, 0),
    inventory.sourceFacts.counts.filledPolygons,
    "filled-polygon count"
  );
  assertEqual(
    constraints.zones.filter((zone) => zone.keepout).length,
    constraints.keepoutZoneCount,
    "keepout-zone count"
  );
  for (const zone of constraints.zones) {
    assertUuid(zone.uuid, "zone UUID");
    if (!netMembers.has(zone.net)) {
      throw new Error(`zone ${zone.uuid} refers to unknown net ${zone.net}`);
    }
  }
}

function verifySupportCircuits(inventory, componentReferences, netMembers) {
  const statuses = new Set(["available", "partial", "planned", "unknown", "unsupported"]);
  assertCanonicalObjects(inventory.supportCircuits, "id", "support circuits");
  for (const circuit of inventory.supportCircuits) {
    assertEnum(circuit.nocadStatus, statuses, `${circuit.id} nocad status`);
    assertUniqueStrings(circuit.componentReferences, `${circuit.id} component references`);
    assertUniqueStrings(circuit.nets, `${circuit.id} nets`);
    for (const reference of circuit.componentReferences) {
      if (!componentReferences.has(reference)) {
        throw new Error(`${circuit.id} refers to unknown component ${reference}`);
      }
    }
    for (const net of circuit.nets) {
      if (!netMembers.has(net)) {
        throw new Error(`${circuit.id} refers to unknown net ${net}`);
      }
    }
  }
}

function verifyPowerDomains(inventory, netMembers) {
  const statuses = new Set(["available", "partial", "planned", "unknown", "unsupported"]);
  assertCanonicalObjects(inventory.powerDomains, "net", "power domains");
  for (const domain of inventory.powerDomains) {
    if (!netMembers.has(domain.net)) {
      throw new Error(`power domain refers to unknown net ${domain.net}`);
    }
    assertEqual(domain.status, "captured-name-only", `${domain.net} power-domain status`);
    assertText(domain.note, `${domain.net} power-domain note`);
    assertEnum(domain.nocad?.status, statuses, `${domain.net} power-domain nocad status`);
    assertEqual(domain.nocad?.nodeKind, "powerDomain", `${domain.net} planned node kind`);
    assertText(domain.nocad?.note, `${domain.net} power-domain nocad note`);
  }
}

function verifyIdentityAnomalies(inventory, componentUuids, footprintUuids) {
  assertCanonicalObjects(inventory.identityAnomalies, "id", "identity anomalies");
  const nonUnitMappings = inventory.components.filter((component) => component.boardFootprints.length !== 1);
  const aliasMappings = inventory.components.flatMap((component) =>
    component.boardFootprints.filter(
      (footprint) => footprint.referenceAtCapture !== component.referenceAtCapture
    )
  );

  assertEqual(nonUnitMappings.length, 1, "non-1:1 schematic-to-footprint mapping count");
  assertEqual(aliasMappings.length, 2, "schematic-to-footprint reference alias count");

  for (const anomaly of inventory.identityAnomalies) {
    assertEnum(anomaly.status, new Set(["captured-alias", "known-issue"]), `${anomaly.id} status`);
    assertText(anomaly.detail, `${anomaly.id} detail`);
    if (!componentUuids.has(anomaly.schematicUuid)) {
      throw new Error(`${anomaly.id} refers to unknown schematic UUID ${anomaly.schematicUuid}`);
    }
    assertUniqueStrings(anomaly.footprintUuids, `${anomaly.id} footprint UUIDs`);
    for (const uuid of anomaly.footprintUuids) {
      if (!footprintUuids.has(uuid)) {
        throw new Error(`${anomaly.id} refers to unknown footprint UUID ${uuid}`);
      }
    }
  }

  const duplicateAnomaly = inventory.identityAnomalies.find((item) => item.id === "duplicate-c5-footprint");
  assertEqual(duplicateAnomaly?.schematicUuid, nonUnitMappings[0].schematicUuid, "1:N identity anomaly component");
  assertEqual(
    duplicateAnomaly?.footprintUuids,
    nonUnitMappings[0].boardFootprints.map((footprint) => footprint.uuid).sort(),
    "1:N identity anomaly footprints"
  );
  assertEqual(
    inventory.identityAnomalies
      .filter((item) => item.status === "captured-alias")
      .flatMap((item) => item.footprintUuids)
      .sort(),
    aliasMappings.map((footprint) => footprint.uuid).sort(),
    "captured reference-alias anomaly closure"
  );
}

function verifyStatusRegister(items) {
  const statuses = new Set(["partial", "unknown", "unsupported"]);
  assertCanonicalObjects(items, "id", "unsupported/unknown register");
  for (const item of items) {
    assertEnum(item.status, statuses, `${item.id} status`);
    assertText(item.detail, `${item.id} detail`);
  }
}

function verifySchematicConnectivity(connectivity, inventory, manifest) {
  assertEqual(
    connectivity.schema,
    "nocad.north-star-schematic-connectivity.v1",
    "schematic-connectivity schema"
  );
  assertEqual(connectivity.referenceId, manifest.id, "schematic-connectivity reference id");
  assertEqual(
    connectivity.capture?.sourceFile,
    "pico-retrodigital.kicad_sch",
    "schematic-connectivity source file"
  );
  const pinnedSchematic = manifest.pin.files.find(
    (file) => file.path === "pico-retrodigital.kicad_sch" && file.role === "schematic-source"
  );
  if (!pinnedSchematic) {
    throw new Error("manifest has no exact pinned schematic source");
  }
  assertEqual(
    connectivity.capture?.sourceSha256,
    pinnedSchematic.sha256,
    "schematic-connectivity source pin"
  );
  assertEqual(
    inventory.sourceFacts.schematicConnectivity?.artifact,
    manifest.schematicConnectivity?.path,
    "inventory schematic-connectivity artifact path"
  );
  assertEqual(connectivity.capture?.netlistFormat, "kicadsexpr", "schematic netlist format");
  assertText(connectivity.capture?.method, "schematic capture method");
  assertText(connectivity.capture?.tool, "schematic capture tool");
  if (!connectivity.capture?.verificationScope?.includes("does not re-run KiCad")) {
    throw new Error("schematic capture must state the source-free verification boundary");
  }
  assertUuid(connectivity.capture?.sourceScope?.rootUuid, "schematic root UUID");
  assertEqual(connectivity.capture?.sourceScope?.rootSheetInstances, 1, "root sheet-instance count");
  assertEqual(connectivity.capture?.sourceScope?.childSheets, 0, "child schematic-sheet count");
  assertEqual(connectivity.capture?.sourceScope?.hierarchicalLabels, 0, "hierarchical-label count");
  assertEqual(connectivity.capture?.sourceScope?.buses, 0, "schematic bus count");
  assertEqual(connectivity.capture?.sourceScope?.busEntries, 0, "schematic bus-entry count");

  const objects = connectivity.objects;
  const counts = connectivity.counts;
  const inventoryCounts = inventory.sourceFacts.counts;
  const netNames = new Set(connectivity.nets.map((net) => net.name));
  const physicalPins = new Map();
  const physicalPinsByComponentAndNumber = new Map();
  const componentByUuid = new Map(inventory.components.map((component) => [component.schematicUuid, component]));
  const physicalComponentPairs = [];
  let markerNoConnectCount = 0;
  let intrinsicNoConnectCount = 0;

  assertCanonicalObjects(objects.physicalComponents, "schematicUuid", "schematic physical components");
  for (const component of objects.physicalComponents) {
    assertUuid(component.schematicUuid, `${component.reference} schematic UUID`);
    assertText(component.reference, `${component.schematicUuid} schematic reference`);
    const inventoryComponent = componentByUuid.get(component.schematicUuid);
    assertEqual(component.reference, inventoryComponent?.referenceAtCapture, `${component.schematicUuid} reference mapping`);
    physicalComponentPairs.push(`${component.schematicUuid}\0${component.reference}`);
    assertCanonicalObjects(component.pins, "pinUuid", `${component.reference} schematic pins`);
    const pinNumbers = new Set();
    for (const pin of component.pins) {
      assertUuid(pin.pinUuid, `${component.reference}.${pin.number} pin UUID`);
      assertText(pin.number, `${component.reference}.${pin.pinUuid} pin number`);
      assertText(pin.name, `${component.reference}.${pin.number} pin name`, { allowEmpty: true });
      assertText(pin.electricalType, `${component.reference}.${pin.number} electrical type`);
      assertEqual(typeof pin.hidden, "boolean", `${component.reference}.${pin.number} hidden state`);
      assertPoint(pin.at, `${component.reference}.${pin.number} coordinate`);
      assertText(pin.net, `${component.reference}.${pin.number} schematic net`);
      if (!netNames.has(pin.net)) {
        throw new Error(`${component.reference}.${pin.number} refers to unknown schematic net ${pin.net}`);
      }
      if (physicalPins.has(pin.pinUuid)) {
        throw new Error(`schematic physical pin UUID is duplicated: ${pin.pinUuid}`);
      }
      if (pinNumbers.has(pin.number)) {
        throw new Error(`${component.reference} has duplicated placed pin number ${pin.number}`);
      }
      pinNumbers.add(pin.number);
      physicalPins.set(pin.pinUuid, { ...pin, component });
      physicalPinsByComponentAndNumber.set(`${component.schematicUuid}\0${pin.number}`, pin);
      if (pin.intentionalNoConnect === "marker") {
        markerNoConnectCount += 1;
      } else if (pin.intentionalNoConnect === "intrinsic-pin-type") {
        intrinsicNoConnectCount += 1;
        assertEqual(pin.electricalType, "no_connect", `${component.reference}.${pin.number} intrinsic no-connect type`);
      } else {
        assertEqual(pin.intentionalNoConnect, null, `${component.reference}.${pin.number} no-connect classification`);
      }
    }
  }
  assertEqual(
    physicalComponentPairs,
    inventory.components.map((component) => `${component.schematicUuid}\0${component.referenceAtCapture}`),
    "schematic/inventory physical-component closure"
  );

  verifySchematicObjectArray(objects.wires, "uuid", "schematic wires", netNames, (wire) => {
    assertEqual(wire.endpoints?.length, 2, `${wire.uuid} wire endpoint count`);
    wire.endpoints.forEach((point, index) => assertPoint(point, `${wire.uuid} endpoint ${index}`));
  });
  verifySchematicObjectArray(objects.junctions, "uuid", "schematic junctions", netNames, (junction) => {
    assertPoint(junction.at, `${junction.uuid} junction coordinate`);
  });
  verifySchematicObjectArray(objects.labels, "uuid", "schematic labels", netNames, (label) => {
    assertEnum(label.kind, new Set(["global", "local"]), `${label.uuid} label kind`);
    assertText(label.text, `${label.uuid} label text`);
    assertPoint(label.at, `${label.uuid} label coordinate`);
    if (!Number.isFinite(label.orientation)) {
      throw new Error(`${label.uuid} label orientation must be finite`);
    }
    if (label.kind === "global") {
      assertText(label.shape, `${label.uuid} global-label shape`);
    } else {
      assertEqual(label.shape, null, `${label.uuid} local-label shape`);
    }
  });
  verifySchematicObjectArray(objects.noConnects, "uuid", "schematic no-connects", netNames, (marker) => {
    assertPoint(marker.at, `${marker.uuid} no-connect coordinate`);
    assertUuid(marker.pinUuid, `${marker.uuid} no-connect pin UUID`);
    const pin = physicalPins.get(marker.pinUuid);
    assertEqual(pin?.intentionalNoConnect, "marker", `${marker.uuid} no-connect target`);
    assertEqual(marker.net, pin?.net, `${marker.uuid} no-connect net`);
  });

  assertCanonicalObjects(
    objects.virtualPowerSymbols,
    "schematicUuid",
    "schematic virtual power symbols"
  );
  const virtualPowerByUuid = new Map();
  const allPinUuids = new Set(physicalPins.keys());
  for (const symbol of objects.virtualPowerSymbols) {
    assertUuid(symbol.schematicUuid, `${symbol.reference} virtual symbol UUID`);
    assertUuid(symbol.pinUuid, `${symbol.reference} virtual pin UUID`);
    assertText(symbol.reference, `${symbol.schematicUuid} virtual reference`);
    assertText(symbol.value, `${symbol.reference} virtual value`);
    assertText(symbol.libId, `${symbol.reference} virtual library id`);
    if (!symbol.libId.startsWith("power:")) {
      throw new Error(`${symbol.reference} is not a power-library symbol`);
    }
    assertEnum(
      symbol.classification,
      new Set(["erc-power-flag", "global-power"]),
      `${symbol.reference} virtual classification`
    );
    if (symbol.classification === "erc-power-flag") {
      assertEqual(symbol.libId, "power:PWR_FLAG", `${symbol.reference} ERC flag library identity`);
      assertEqual(symbol.electricalType, "power_out", `${symbol.reference} ERC flag electrical type`);
    } else {
      if (symbol.libId === "power:PWR_FLAG") {
        throw new Error(`${symbol.reference} PWR_FLAG must be classified as an ERC power flag`);
      }
      assertEqual(symbol.electricalType, "power_in", `${symbol.reference} global-power electrical type`);
      assertEqual(symbol.value, symbol.net, `${symbol.reference} global-power net name`);
    }
    assertPoint(symbol.at, `${symbol.reference} virtual coordinate`);
    if (!netNames.has(symbol.net)) {
      throw new Error(`${symbol.reference} refers to unknown schematic net ${symbol.net}`);
    }
    if (virtualPowerByUuid.has(symbol.schematicUuid) || allPinUuids.has(symbol.pinUuid)) {
      throw new Error(`${symbol.reference} has duplicated virtual identity`);
    }
    virtualPowerByUuid.set(symbol.schematicUuid, symbol);
    allPinUuids.add(symbol.pinUuid);
  }

  assertCanonicalObjects(connectivity.nets, "name", "schematic nets");
  const seenMemberPins = new Set();
  for (const net of connectivity.nets) {
    assertUniqueStrings(net.memberPinUuids, `${net.name} schematic members`);
    assertEqual(net.memberPinUuids, [...net.memberPinUuids].sort(), `${net.name} member order`);
    const derivedMembers = [...physicalPins.entries()]
      .filter(([, pin]) => pin.net === net.name)
      .map(([uuid]) => uuid)
      .sort();
    assertEqual(net.memberPinUuids, derivedMembers, `${net.name} physical-pin closure`);
    for (const pinUuid of net.memberPinUuids) {
      if (seenMemberPins.has(pinUuid)) {
        throw new Error(`schematic pin occurs in more than one net: ${pinUuid}`);
      }
      seenMemberPins.add(pinUuid);
    }
    assertEqual(
      net.membershipSha256,
      sha256(Buffer.from(`${net.memberPinUuids.join("\n")}\n`)),
      `${net.name} schematic membership digest`
    );
    verifyObjectMembership(net, "wires", objects.wires, "uuid");
    verifyObjectMembership(net, "junctions", objects.junctions, "uuid");
    verifyObjectMembership(net, "labels", objects.labels, "uuid");
    verifyObjectMembership(net, "noConnects", objects.noConnects, "uuid");
    verifyObjectMembership(
      net,
      "virtualPowerSymbols",
      objects.virtualPowerSymbols,
      "schematicUuid"
    );
    const topologyRecords = [
      ...net.junctions.map((uuid) => `junction\0${uuid}\n`),
      ...net.labels.map((uuid) => `label\0${uuid}\n`),
      ...net.noConnects.map((uuid) => `no-connect\0${uuid}\n`),
      ...net.virtualPowerSymbols.map((uuid) => `power-symbol\0${uuid}\n`),
      ...net.wires.map((uuid) => `wire\0${uuid}\n`)
    ].sort();
    assertEqual(
      net.topologyEvidenceSha256,
      sha256(Buffer.from(topologyRecords.join(""))),
      `${net.name} topology-evidence digest`
    );
  }
  assertEqual(seenMemberPins.size, physicalPins.size, "schematic physical-pin net closure");
  const aggregateCanonical = connectivity.nets
    .map((net) => `${net.name}\0${net.membershipSha256}\0${net.topologyEvidenceSha256}\n`)
    .join("");
  assertText(
    connectivity.aggregates?.schematicConnectivityEncoding,
    "schematic connectivity aggregate encoding"
  );
  assertEqual(
    connectivity.aggregates?.schematicConnectivitySha256,
    sha256(Buffer.from(aggregateCanonical)),
    "schematic connectivity aggregate SHA-256"
  );
  assertEqual(
    connectivity.aggregates?.schematicConnectivitySha256,
    manifest.schematicConnectivity?.aggregateSha256,
    "manifest schematic connectivity aggregate"
  );
  assertEqual(
    connectivity.aggregates?.schematicConnectivitySha256,
    inventory.sourceFacts.schematicConnectivity?.aggregateSha256,
    "inventory schematic connectivity aggregate"
  );

  assertEqual(counts.physicalComponents, objects.physicalComponents.length, "schematic component count");
  assertEqual(counts.physicalPins, physicalPins.size, "schematic pin count");
  assertEqual(
    counts.hiddenPhysicalPins,
    [...physicalPins.values()].filter((pin) => pin.hidden).length,
    "hidden schematic pin count"
  );
  assertEqual(counts.hiddenPhysicalPins, 17, "captured hidden schematic pin count");
  assertEqual(counts.virtualPowerSymbols, objects.virtualPowerSymbols.length, "virtual power-symbol count");
  assertEqual(counts.wires, objects.wires.length, "schematic wire count");
  assertEqual(counts.junctions, objects.junctions.length, "schematic junction count");
  assertEqual(counts.localLabels, objects.labels.filter((label) => label.kind === "local").length, "local label count");
  assertEqual(counts.globalLabels, objects.labels.filter((label) => label.kind === "global").length, "global label count");
  assertEqual(counts.noConnects, objects.noConnects.length, "schematic no-connect count");
  assertEqual(counts.nets, connectivity.nets.length, "schematic net count");
  assertEqual(counts.netMembers, physicalPins.size, "schematic net-member count");
  assertEqual(markerNoConnectCount, counts.noConnects, "marker no-connect pin closure");
  assertEqual(intrinsicNoConnectCount, 3, "intrinsic no-connect pin count");
  assertEqual(counts.physicalComponents, inventoryCounts.schematicComponents, "inventory schematic component count");
  assertEqual(counts.physicalPins, inventoryCounts.schematicPhysicalPins, "inventory schematic pin count");
  assertEqual(
    counts.hiddenPhysicalPins,
    inventoryCounts.schematicHiddenPhysicalPins,
    "inventory hidden schematic pin count"
  );
  assertEqual(
    intrinsicNoConnectCount,
    inventoryCounts.schematicIntrinsicNoConnectPins,
    "inventory intrinsic no-connect pin count"
  );
  assertEqual(counts.virtualPowerSymbols, inventoryCounts.schematicVirtualPowerSymbols, "inventory virtual symbol count");
  assertEqual(counts.wires, inventoryCounts.schematicWires, "inventory schematic wire count");
  assertEqual(counts.junctions, inventoryCounts.schematicJunctions, "inventory schematic junction count");
  assertEqual(counts.noConnects, inventoryCounts.schematicNoConnectMarkers, "inventory no-connect marker count");
  assertEqual(counts.localLabels, inventoryCounts.schematicLocalLabels, "inventory local label count");
  assertEqual(counts.globalLabels, inventoryCounts.schematicGlobalLabels, "inventory global label count");
  assertEqual(counts.nets, inventoryCounts.boardNets, "schematic/board net count");
  assertEqual(counts.nets, inventoryCounts.schematicNets, "inventory schematic net count");

  verifyNormalizedSchematicTopology(objects);
  verifySchematicBoardComparison(connectivity, inventory, physicalPinsByComponentAndNumber);
  assertEqual(
    connectivity.boardComparison.status,
    manifest.schematicConnectivity?.comparisonStatus,
    "manifest schematic/board comparison status"
  );
}

function verifyNormalizedSchematicTopology(objects) {
  const physicalPins = objects.physicalComponents.flatMap((component) => component.pins);
  const points = new Map();
  const parent = new Map();
  const ensurePoint = (point) => {
    const key = normalizedPointKey(point);
    if (!points.has(key)) {
      points.set(key, point);
      parent.set(key, key);
    }
    return key;
  };
  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) {
      root = parent.get(root);
    }
    let current = key;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      return;
    }
    const root = leftRoot < rightRoot ? leftRoot : rightRoot;
    parent.set(leftRoot, root);
    parent.set(rightRoot, root);
  };
  const allObjectPoints = [
    ...physicalPins.map((pin) => pin.at),
    ...objects.virtualPowerSymbols.map((symbol) => symbol.at),
    ...objects.wires.flatMap((wire) => wire.endpoints),
    ...objects.junctions.map((junction) => junction.at),
    ...objects.labels.map((label) => label.at),
    ...objects.noConnects.map((marker) => marker.at)
  ];
  allObjectPoints.forEach(ensurePoint);
  const connectionAnchors = [
    ...objects.wires.flatMap((wire) => wire.endpoints),
    ...objects.junctions.map((junction) => junction.at),
    ...objects.labels.map((label) => label.at),
    ...objects.virtualPowerSymbols.map((symbol) => symbol.at),
    ...physicalPins.map((pin) => pin.at)
  ];

  for (const wire of objects.wires) {
    const [start, end] = wire.endpoints;
    const startKey = ensurePoint(start);
    union(startKey, ensurePoint(end));
    for (const anchor of connectionAnchors) {
      if (normalizedPointOnSegment(anchor, start, end)) {
        union(startKey, ensurePoint(anchor));
      }
    }
  }

  const namesByRoot = new Map();
  const addName = (point, name) => {
    const root = find(ensurePoint(point));
    if (!namesByRoot.has(root)) {
      namesByRoot.set(root, new Set());
    }
    namesByRoot.get(root).add(name);
  };
  for (const pin of physicalPins) {
    addName(pin.at, pin.net);
  }
  for (const label of objects.labels) {
    addName(label.at, label.text);
  }
  for (const symbol of objects.virtualPowerSymbols) {
    if (symbol.classification === "global-power") {
      addName(symbol.at, symbol.value);
    }
  }
  const netAt = (point, label) => {
    const names = [...(namesByRoot.get(find(ensurePoint(point))) ?? [])].sort();
    if (names.length !== 1) {
      throw new Error(`${label} has ambiguous normalized topology: ${names.join(", ")}`);
    }
    return names[0];
  };

  for (const wire of objects.wires) {
    assertEqual(wire.net, netAt(wire.endpoints[0], `wire ${wire.uuid}`), `${wire.uuid} geometric net`);
  }
  for (const junction of objects.junctions) {
    const incidentWires = objects.wires.filter((wire) =>
      normalizedPointOnSegment(junction.at, wire.endpoints[0], wire.endpoints[1])
    );
    if (incidentWires.length === 0) {
      throw new Error(`junction ${junction.uuid} is orphaned`);
    }
    assertEqual(junction.net, netAt(junction.at, `junction ${junction.uuid}`), `${junction.uuid} geometric net`);
  }
  for (const label of objects.labels) {
    assertEqual(label.net, netAt(label.at, `label ${label.uuid}`), `${label.uuid} geometric net`);
  }
  for (const symbol of objects.virtualPowerSymbols) {
    assertEqual(
      symbol.net,
      netAt(symbol.at, `virtual power symbol ${symbol.schematicUuid}`),
      `${symbol.schematicUuid} geometric net`
    );
  }
  for (const marker of objects.noConnects) {
    const targetPins = physicalPins.filter(
      (pin) => normalizedPointKey(pin.at) === normalizedPointKey(marker.at)
    );
    assertEqual(targetPins.length, 1, `${marker.uuid} geometric no-connect target count`);
    assertEqual(marker.pinUuid, targetPins[0].pinUuid, `${marker.uuid} geometric no-connect target`);
    assertEqual(marker.net, targetPins[0].net, `${marker.uuid} geometric no-connect net`);
  }
}

function verifySchematicBoardComparison(connectivity, inventory, physicalPinsByComponentAndNumber) {
  const comparison = connectivity.boardComparison;
  const matchedBoardPads = [];
  const excludedBoardPads = [];
  const unmatchedElectricalPads = [];
  const logicalBoardMembers = new Map();
  const duplicateImplementations = [];

  for (const component of inventory.components) {
    const padsByNumber = new Map();
    for (const footprint of component.boardFootprints) {
      for (const pad of footprint.pins) {
        if (!padsByNumber.has(pad.number)) {
          padsByNumber.set(pad.number, []);
        }
        padsByNumber.get(pad.number).push({ footprint, pad });
      }
    }

    for (const [number, pads] of padsByNumber) {
      const schematicPin = physicalPinsByComponentAndNumber.get(`${component.schematicUuid}\0${number}`);
      if (!schematicPin) {
        for (const { footprint, pad } of pads) {
          const captured = {
            footprintReference: footprint.referenceAtCapture,
            footprintUuid: footprint.uuid,
            net: pad.net,
            number: pad.number,
            padUuid: pad.uuid,
            reason:
              (pad.number === "" || pad.number === "MP") && pad.net === null
                ? "mechanical-or-footprint-only"
                : "no-schematic-pin"
          };
          (captured.reason === "mechanical-or-footprint-only"
            ? excludedBoardPads
            : unmatchedElectricalPads
          ).push(captured);
        }
        continue;
      }

      const padNets = [...new Set(pads.map(({ pad }) => pad.net))].sort(compareNullableText);
      assertEqual(padNets, [schematicPin.net], `${component.referenceAtCapture}.${number} PCB net closure`);
      if (!logicalBoardMembers.has(schematicPin.net)) {
        logicalBoardMembers.set(schematicPin.net, new Set());
      }
      logicalBoardMembers.get(schematicPin.net).add(schematicPin.pinUuid);
      for (const { pad } of pads) {
        matchedBoardPads.push({ padUuid: pad.uuid, pinUuid: schematicPin.pinUuid });
      }
      if (component.boardFootprints.length > 1) {
        duplicateImplementations.push({
          boardPads: pads.map(({ pad }) => pad.uuid).sort(),
          footprintUuids: [...new Set(pads.map(({ footprint }) => footprint.uuid))].sort(),
          net: schematicPin.net,
          pinNumber: number,
          pinUuid: schematicPin.pinUuid,
          reference: component.referenceAtCapture,
          schematicUuid: component.schematicUuid,
          reviewedIssue: "duplicate-c5-footprint"
        });
      }
    }
  }

  matchedBoardPads.sort(compareByKey("padUuid"));
  excludedBoardPads.sort(compareByKey("padUuid"));
  unmatchedElectricalPads.sort(compareByKey("padUuid"));
  duplicateImplementations.sort(compareByKey("pinUuid"));
  assertEqual(comparison.matchedBoardPads, matchedBoardPads, "schematic/board pad crosswalk");
  assertEqual(comparison.excludedBoardPads, excludedBoardPads, "non-electrical board-pad exclusions");
  assertEqual(comparison.duplicateImplementations, duplicateImplementations, "duplicate-footprint comparison");
  assertEqual(excludedBoardPads.length, 22, "exact non-electrical board-pad exclusion count");
  assertEqual(
    sha256(Buffer.from(`${excludedBoardPads.map((pad) => pad.padUuid).join("\n")}\n`)),
    "d42db0afbd6d1c78c470e355a12f982519916b5d4424cf1501dd88ffa7a91213",
    "exact non-electrical board-pad exclusion UUID digest"
  );

  for (const net of connectivity.nets) {
    assertEqual(
      [...(logicalBoardMembers.get(net.name) ?? [])].sort(),
      net.memberPinUuids,
      `${net.name} schematic/PCB logical partition`
    );
  }
  assertEqual(
    [...logicalBoardMembers.keys()].sort(),
    connectivity.nets.map((net) => net.name),
    "schematic/PCB named-net closure"
  );

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
  const discrepancy = {
    detail:
      "The USB-C footprint has unconnected A8 and B8 SBU pads, while the captured USB2-only schematic symbol has no corresponding pins.",
    id: "j5-sbu-footprint-only-pads",
    kind: "board-pads-without-schematic-pins",
    padUuids: unmatchedElectricalPads.map((pad) => pad.padUuid),
    references: [...new Set(unmatchedElectricalPads.map((pad) => pad.footprintReference))].sort()
  };
  const expectedDiscrepancies = [{
    ...discrepancy,
    fingerprint: sha256(Buffer.from(`${canonicalJson(discrepancy)}\n`))
  }];
  expectedDiscrepancies.sort(compareByKey("id"));
  assertCanonicalObjects(comparison.discrepancies, "id", "schematic/board discrepancies");
  assertEqual(comparison.discrepancies, expectedDiscrepancies, "schematic/board discrepancy closure");
  assertCanonicalObjects(comparison.waivers, "id", "schematic/board waivers");
  assertEqual(comparison.waivers.length, 1, "exact schematic/board waiver count");
  assertEqual(
    comparison.waivers[0]?.id,
    "waive-j5-sbu-footprint-only-pads",
    "exact schematic/board waiver id"
  );
  const discrepancyFingerprints = new Set(comparison.discrepancies.map((item) => item.fingerprint));
  const waivedFingerprints = new Set();
  for (const waiver of comparison.waivers) {
    assertText(waiver.justification, `${waiver.id} justification`);
    assertSha256(waiver.discrepancyFingerprint, `${waiver.id} discrepancy fingerprint`);
    if (!discrepancyFingerprints.has(waiver.discrepancyFingerprint)) {
      throw new Error(`${waiver.id} refers to a stale or unknown discrepancy`);
    }
    if (waivedFingerprints.has(waiver.discrepancyFingerprint)) {
      throw new Error(`${waiver.id} duplicates a discrepancy waiver`);
    }
    waivedFingerprints.add(waiver.discrepancyFingerprint);
  }
  const openDiscrepancyCount = comparison.discrepancies.filter(
    (item) => !waivedFingerprints.has(item.fingerprint)
  ).length;
  assertEqual(openDiscrepancyCount, 0, "open schematic/board discrepancy count");
  assertEqual(comparison.status, "equivalent-with-exact-waiver", "schematic/board comparison status");
  assertEqual(
    comparison.summary.openDiscrepancyCount,
    openDiscrepancyCount,
    "schematic/board open discrepancy summary"
  );
  assertEqual(
    comparison.summary.openDiscrepancyCount,
    inventory.sourceFacts.schematicConnectivity?.comparisonOpenDiscrepancies,
    "inventory open schematic/board discrepancy count"
  );
  assertEqual(
    comparison.waivers.length,
    inventory.sourceFacts.schematicConnectivity?.comparisonExactWaivers,
    "inventory exact schematic/board waiver count"
  );
  assertEqual(comparison.summary, {
    discrepancyCount: comparison.discrepancies.length,
    duplicateImplementationPinCount: duplicateImplementations.length,
    excludedBoardPadCount: excludedBoardPads.length,
    matchedBoardPadCount: matchedBoardPads.length,
    openDiscrepancyCount,
    schematicPinCount: connectivity.counts.physicalPins
  }, "schematic/board comparison summary");
}

function verifySchematicObjectArray(items, key, label, netNames, verifyObject) {
  assertCanonicalObjects(items, key, label);
  for (const item of items) {
    assertUuid(item[key], `${label} ${key}`);
    if (!netNames.has(item.net)) {
      throw new Error(`${label} ${item[key]} refers to unknown net ${item.net}`);
    }
    verifyObject(item);
  }
}

function verifyObjectMembership(net, field, objects, objectKey) {
  assertUniqueStrings(net[field], `${net.name} ${field}`);
  assertEqual(net[field], [...net[field]].sort(), `${net.name} ${field} order`);
  assertEqual(
    net[field],
    objects.filter((item) => item.net === net.name).map((item) => item[objectKey]).sort(),
    `${net.name} ${field} closure`
  );
}

function assertPoint(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
  ) {
    throw new Error(`${label} must be a finite [x, y] point`);
  }
}

function normalizedPointKey(point) {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
}

function normalizedPointOnSegment(point, start, end) {
  const cross =
    (point[0] - start[0]) * (end[1] - start[1]) -
    (point[1] - start[1]) * (end[0] - start[0]);
  return (
    Math.abs(cross) <= 1e-6 &&
    point[0] >= Math.min(start[0], end[0]) - 1e-6 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-6 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-6 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-6
  );
}

function compareByKey(key) {
  return (left, right) =>
    String(left[key]) < String(right[key]) ? -1 : String(left[key]) > String(right[key]) ? 1 : 0;
}

function compareNullableText(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
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

function runMutationChecks(manifest, inventory, connectivity) {
  const mutations = [
    ["component canonical order", (inventoryCopy) => inventoryCopy.components.reverse()],
    ["net membership digest", (inventoryCopy) => {
      inventoryCopy.components[0].boardFootprints[0].pins[0].net = "mutation-net";
    }],
    ["cross-subsystem closure", (inventoryCopy) => inventoryCopy.crossSubsystemNets.pop()],
    ["boundary declaration membership", (inventoryCopy) => {
      inventoryCopy.crossSubsystemNets.find((item) => item.net === "AUD_CLK").declaration.id = "usb-device";
    }],
    ["package status closure", (inventoryCopy) => {
      inventoryCopy.components[0].nocad.status = "invented";
    }],
    ["package mapping identity", (inventoryCopy) => {
      const mapped = inventoryCopy.components.find((component) => component.nocad.status === "partial");
      mapped.nocad.packageId = null;
    }],
    ["contract mapping identity", (inventoryCopy) => {
      const mapped = inventoryCopy.interfaces.find((item) => item.nocad.status === "partial");
      mapped.nocad.contractId = null;
    }],
    ["schematic pin reassignment", (_inventoryCopy, connectivityCopy) => {
      const pin = connectivityCopy.objects.physicalComponents[0].pins[0];
      pin.net = pin.net === "+1V1" ? "+3V3" : "+1V1";
    }],
    ["schematic pin canonical order", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.objects.physicalComponents.find((component) => component.pins.length > 1).pins.reverse();
    }],
    ["schematic net canonical order", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.nets.reverse();
    }],
    ["schematic source identity", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.capture.sourceFile = "unknown.kicad_sch";
      connectivityCopy.capture.sourceSha256 = undefined;
    }],
    ["schematic no-connect coordinate", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.objects.noConnects[0].at[0] += 1;
    }],
    ["schematic junction removal", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.objects.junctions.pop();
    }],
    ["power flag global merge", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.objects.virtualPowerSymbols.find(
        (symbol) => symbol.classification === "erc-power-flag"
      ).classification = "global-power";
    }],
    ["power flag library identity", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.objects.virtualPowerSymbols.find(
        (symbol) => symbol.classification === "erc-power-flag"
      ).libId = "power:GND";
    }],
    ["duplicate footprint net conflict", (inventoryCopy) => {
      const component = inventoryCopy.components.find((item) => item.referenceAtCapture === "C5");
      component.boardFootprints[1].pins.find((pin) => pin.number === "1").net = "GND";
    }],
    ["missing exact waiver", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.boardComparison.waivers.pop();
    }],
    ["stale exact waiver", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.boardComparison.waivers[0].discrepancyFingerprint = "0".repeat(64);
    }],
    ["renamed exact waiver", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.boardComparison.waivers[0].id = "generic-waiver";
    }],
    ["removed exact SBU discrepancy", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.boardComparison.discrepancies = [];
      connectivityCopy.boardComparison.waivers = [];
      connectivityCopy.boardComparison.summary.discrepancyCount = 0;
      connectivityCopy.boardComparison.summary.openDiscrepancyCount = 0;
    }],
    ["missing mechanical exclusion", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.boardComparison.excludedBoardPads.pop();
    }],
    ["netted mechanical exclusion", (_inventoryCopy, connectivityCopy) => {
      connectivityCopy.boardComparison.excludedBoardPads[0].net = "GND";
    }],
    ["widened exact waiver", (_inventoryCopy, connectivityCopy) => {
      const discrepancy = connectivityCopy.boardComparison.discrepancies[0];
      discrepancy.padUuids.push(connectivityCopy.boardComparison.excludedBoardPads[0].padUuid);
      discrepancy.padUuids.sort();
      const withoutFingerprint = { ...discrepancy };
      delete withoutFingerprint.fingerprint;
      discrepancy.fingerprint = sha256(Buffer.from(`${canonicalJson(withoutFingerprint)}\n`));
      connectivityCopy.boardComparison.waivers[0].discrepancyFingerprint = discrepancy.fingerprint;
    }]
  ];

  for (const [label, mutate] of mutations) {
    const inventoryCopy = structuredClone(inventory);
    const connectivityCopy = structuredClone(connectivity);
    mutate(inventoryCopy, connectivityCopy);
    let rejected = false;
    try {
      verifyReference(manifest, inventoryCopy, connectivityCopy, manifest.id);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`verifier mutation check was not rejected: ${label}`);
    }
  }
}

async function verifyNoSourceCopies(referenceDirectory) {
  const entries = await readdir(referenceDirectory, { withFileTypes: true });
  const allowed = new Set([
    "README.md",
    "inventory.json",
    "manifest.json",
    "schematic-connectivity.json"
  ]);

  for (const entry of entries) {
    if (!entry.isFile() || !allowed.has(entry.name)) {
      throw new Error(`north-star reference contains unexpected copied content: ${entry.name}`);
    }
  }

  assertEqual(
    entries.map((entry) => entry.name).sort(),
    [...allowed].sort(),
    "north-star reference file closure"
  );
}

function safeReferencePath(referenceDirectory, relativePath) {
  assertSafeRelativePath(relativePath, "inventory path");
  const resolved = path.resolve(referenceDirectory, relativePath);
  if (!resolved.startsWith(`${path.resolve(referenceDirectory)}${path.sep}`)) {
    throw new Error(`inventory path escapes its reference directory: ${relativePath}`);
  }
  return resolved;
}

function appendMapValue(map, key, value) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
}

function assertCanonicalObjects(items, key, label) {
  if (!Array.isArray(items)) {
    throw new Error(`${label} must be an array`);
  }
  const values = items.map((item) => item?.[key]);
  assertUniqueStrings(values, `${label} ${key} values`);
  assertEqual(values, [...values].sort(), `${label} canonical order`);
}

function assertUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new Error(`${label} must contain strings`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicates`);
  }
}

function assertSafeRelativePath(value, label) {
  assertText(value, label);
  if (!/^[\x20-\x7e]+$/u.test(value) || path.isAbsolute(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error(`${label} must be a safe relative path`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertUuid(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase UUID`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertText(value, label, options = {}) {
  if (typeof value !== "string" || (!options.allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${options.allowEmpty ? "a string" : "a non-empty string"}`);
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new Error(`${label}: unsupported value ${JSON.stringify(value)}`);
  }
}

function verifyImplementationMapping(mapping, identityField, statuses, label) {
  assertEnum(mapping?.status, statuses, `${label} status`);
  const identity = mapping?.[identityField];
  if (mapping.status === "available" || mapping.status === "partial") {
    assertText(identity, `${label} ${identityField}`);
  } else {
    assertEqual(identity, null, `${label} ${identityField}`);
  }
}

function assertEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
