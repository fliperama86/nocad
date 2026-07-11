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
    const { inventory, manifest } = await loadReference(referenceDirectory);
    verifyReference(manifest, inventory, path.basename(referenceDirectory));
    runMutationChecks(manifest, inventory);
    await verifyNoSourceCopies(referenceDirectory);
    console.log(
      `PASS ${path.relative(repositoryRoot, referenceDirectory)}: ` +
        `${inventory.components.length} components, ${inventory.sourceFacts.counts.boardFootprints} footprints, ` +
        `${inventory.sourceFacts.counts.pads} pads, ${inventory.nets.length} nets`
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
  const [inventoryContents, inventoryStat] = await Promise.all([readFile(inventoryPath), stat(inventoryPath)]);

  assertEqual(inventoryStat.size, manifest.inventory?.bytes, "inventory byte size");
  assertEqual(sha256(inventoryContents), manifest.inventory?.sha256, "inventory SHA-256");

  return {
    inventory: JSON.parse(inventoryContents.toString("utf8")),
    manifest
  };
}

function verifyReference(manifest, inventory, directoryId) {
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
    "counted-not-individually-normalized",
    "schematic power-symbol coverage status"
  );
  assertEqual(inventory.sourceFacts.schematicConnectivity?.ercStatus, "unknown", "ERC status");
  if (!inventory.unsupportedOrUnknown.some((item) => item.id === "schematic-power-symbol-closure")) {
    throw new Error("unsupported/unknown register omits schematic power-symbol closure");
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

function runMutationChecks(manifest, inventory) {
  const mutations = [
    ["component canonical order", (copy) => copy.components.reverse()],
    ["net membership digest", (copy) => {
      copy.components[0].boardFootprints[0].pins[0].net = "mutation-net";
    }],
    ["cross-subsystem closure", (copy) => copy.crossSubsystemNets.pop()],
    ["boundary declaration membership", (copy) => {
      copy.crossSubsystemNets.find((item) => item.net === "AUD_CLK").declaration.id = "usb-device";
    }],
    ["package status closure", (copy) => {
      copy.components[0].nocad.status = "invented";
    }],
    ["package mapping identity", (copy) => {
      const mapped = copy.components.find((component) => component.nocad.status === "partial");
      mapped.nocad.packageId = null;
    }],
    ["contract mapping identity", (copy) => {
      const mapped = copy.interfaces.find((item) => item.nocad.status === "partial");
      mapped.nocad.contractId = null;
    }]
  ];

  for (const [label, mutate] of mutations) {
    const copy = structuredClone(inventory);
    mutate(copy);
    let rejected = false;
    try {
      verifyReference(manifest, copy, manifest.id);
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
  const allowed = new Set(["README.md", "inventory.json", "manifest.json"]);

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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}
