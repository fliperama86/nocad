import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();
const fixturesRoot = path.join(repositoryRoot, "fixtures", "semantic");
const manifestPaths = await findNamedFiles(fixturesRoot, "manifest.json");

if (manifestPaths.length === 0) fail("no semantic fixture manifests found");

for (const manifestPath of manifestPaths.sort()) await verifyFixture(manifestPath);

console.log(
  `Verified ${manifestPaths.length} source-free semantic fixture${manifestPaths.length === 1 ? "" : "s"}.`
);

async function verifyFixture(manifestPath) {
  const directory = path.dirname(manifestPath);
  const manifest = await readJson(manifestPath);
  assertEqual(manifest.schema, "nocad.semantic-fixture-manifest.v1", `${manifestPath} schema`);
  assertText(manifest.id, `${manifestPath} id`);
  assertText(manifest.project, `${manifestPath} project`);
  assertText(manifest.expectation, `${manifestPath} expectation`);

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail(`${manifestPath} files must be a non-empty array`);
  }
  const filePaths = manifest.files.map((entry) => entry.path);
  assertCanonicalUniqueOrder(filePaths, `${manifestPath} files`);
  const directoryEntries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  assertDeepEqual(directoryEntries, ["manifest.json", ...filePaths].sort(), `${manifestPath} file closure`);

  for (const entry of manifest.files) {
    assertRelativePath(entry.path, `${manifestPath} file path`);
    assertText(entry.role, `${manifestPath} file role`);
    assertSha256(entry.sha256, `${manifestPath} ${entry.path} sha256`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      fail(`${manifestPath} ${entry.path} bytes must be a non-negative safe integer`);
    }
    const target = path.join(directory, entry.path);
    const content = await readFile(target);
    assertEqual(content.byteLength, entry.bytes, `${manifestPath} ${entry.path} bytes`);
    assertEqual(sha256(content), entry.sha256, `${manifestPath} ${entry.path} hash`);
  }

  const projectEntry = singleRole(manifest.files, "project", manifestPath);
  const expectationEntry = singleRole(manifest.files, "expectation", manifestPath);
  assertEqual(projectEntry.path, manifest.project, `${manifestPath} project role path`);
  assertEqual(expectationEntry.path, manifest.expectation, `${manifestPath} expectation role path`);
  const project = await readJson(path.join(directory, manifest.project));
  const expectation = await readJson(path.join(directory, manifest.expectation));
  assertEqual(project.schema, "nocad.project.v0", `${manifestPath} project schema`);
  assertEqual(project.id, manifest.id, `${manifestPath} project id`);
  assertEqual(
    expectation.schema,
    "nocad.semantic-fixture-expectation.v2",
    `${manifestPath} expectation schema`
  );
  assertEqual(expectation.project, manifest.id, `${manifestPath} expectation project`);
  verifyExpectation(expectation, project, manifestPath);

  if (!Array.isArray(manifest.definitionPackages)) {
    fail(`${manifestPath} definitionPackages must be an array`);
  }
  assertCanonicalUniqueOrder(manifest.definitionPackages, `${manifestPath} definitionPackages`);

  if (!isRecord(manifest.status)) fail(`${manifestPath} status must be an object`);
  if (typeof manifest.status.exactPhysicalParity !== "boolean") {
    fail(`${manifestPath} exactPhysicalParity must be boolean`);
  }
  if (typeof manifest.status.golden !== "boolean" || typeof manifest.status.hardwareQualified !== "boolean") {
    fail(`${manifestPath} golden and hardwareQualified must be boolean`);
  }
  if (!manifest.status.exactPhysicalParity && (manifest.status.golden || manifest.status.hardwareQualified)) {
    fail(`${manifestPath} cannot be golden or hardware-qualified without exact physical parity`);
  }
  assertText(manifest.status.scope, `${manifestPath} status scope`);
  assertText(manifest.status.license, `${manifestPath} status license`);
  if (!manifest.status.exactPhysicalParity && (!Array.isArray(manifest.limitations) || manifest.limitations.length === 0)) {
    fail(`${manifestPath} must record limitations when exact physical parity is false`);
  }
  for (const [index, limitation] of (manifest.limitations ?? []).entries()) {
    if (!isRecord(limitation)) fail(`${manifestPath} limitation ${index} must be an object`);
    assertText(limitation.id, `${manifestPath} limitation ${index} id`);
    assertText(limitation.status, `${manifestPath} limitation ${index} status`);
    assertText(limitation.detail, `${manifestPath} limitation ${index} detail`);
  }

  if (!isRecord(manifest.provenance) || manifest.provenance.sourceFree !== true) {
    fail(`${manifestPath} provenance must declare sourceFree true`);
  }
  if (manifest.provenance.reprovesExtraction !== false) {
    fail(`${manifestPath} source-free provenance must declare reproof of extraction false`);
  }
  assertText(manifest.provenance.derivation, `${manifestPath} provenance derivation`);
  assertText(manifest.provenance.referenceId, `${manifestPath} provenance referenceId`);
  if (!Array.isArray(manifest.provenance.artifacts) || manifest.provenance.artifacts.length === 0) {
    fail(`${manifestPath} provenance artifacts must be a non-empty array`);
  }
  const artifactPaths = manifest.provenance.artifacts.map((entry) => entry.path);
  assertCanonicalUniqueOrder(artifactPaths, `${manifestPath} provenance artifacts`);
  for (const artifact of manifest.provenance.artifacts) {
    assertRelativePath(artifact.path, `${manifestPath} provenance artifact path`);
    assertText(artifact.role, `${manifestPath} provenance artifact role`);
    assertSha256(artifact.sha256, `${manifestPath} provenance artifact hash`);
    const target = path.resolve(repositoryRoot, artifact.path);
    if (!isWithin(repositoryRoot, target)) fail(`${manifestPath} provenance artifact escapes repository root`);
    const metadata = await stat(target);
    if (!metadata.isFile()) fail(`${manifestPath} provenance artifact is not a file: ${artifact.path}`);
    assertEqual(sha256(await readFile(target)), artifact.sha256, `${manifestPath} ${artifact.path} hash`);
  }

  for (const definitionPackagePath of manifest.definitionPackages) {
    assertRelativePath(definitionPackagePath, `${manifestPath} definition package path`);
    const artifact = manifest.provenance.artifacts.find(({ path: artifactPath }) =>
      artifactPath === definitionPackagePath
    );
    if (artifact?.role !== "captured-definition-package") {
      fail(`${manifestPath} definition package ${definitionPackagePath} must be a pinned provenance artifact`);
    }
    const packageManifest = await verifyCapturedDefinitionPackage(
      definitionPackagePath,
      `${manifestPath} ${definitionPackagePath}`
    );
    assertEqual(
      project.dependencies?.[packageManifest.package.name],
      packageManifest.package.version,
      `${manifestPath} ${definitionPackagePath} explicit dependency`
    );
  }
}

async function verifyCapturedDefinitionPackage(manifestRelativePath, label) {
  const manifestPath = path.resolve(repositoryRoot, manifestRelativePath);
  if (!isWithin(repositoryRoot, manifestPath)) fail(`${label} manifest escapes repository root`);
  const packageRoot = path.dirname(manifestPath);
  const manifest = await readJson(manifestPath);
  const normalized = validateCapturedPackageManifestMetadata(manifest, label);

  const definitionEntries = [
    ...normalized.components.map((descriptor) => ({ descriptor, kind: "component" })),
    ...normalized.functions.map((descriptor) => ({ descriptor, kind: "function" }))
  ];
  const definitionPaths = definitionEntries.map(({ descriptor }) => descriptor.definitionPath);
  const packageTree = await listPackageTree(packageRoot);
  const allowedFiles = ["manifest.json", ...definitionPaths];
  if (packageTree.files.includes("README.md")) allowedFiles.push("README.md");
  assertDeepEqual(packageTree.files, allowedFiles.sort(), `${label} package file closure`);
  const allowedDirectories = [...new Set(definitionPaths.flatMap(parentDirectories))].sort();
  assertDeepEqual(packageTree.directories, allowedDirectories, `${label} package directory closure`);

  for (const { descriptor, kind } of definitionEntries) {
    const definitionPath = path.resolve(packageRoot, descriptor.definitionPath);
    if (!isWithin(packageRoot, definitionPath)) {
      fail(`${label} ${kind} ${descriptor.id} definitionPath escapes its package`);
    }
    const definition = await readJson(definitionPath);
    if (!isRecord(definition)) fail(`${label} ${descriptor.definitionPath} payload must be an object`);
    assertEqual(definition.id, descriptor.id, `${label} ${descriptor.definitionPath} definition id`);
    assertEqual(
      canonicalSha256(definition),
      descriptor.definitionHash,
      `${label} ${descriptor.definitionPath} canonical definition hash`
    );
  }

  for (const evidence of normalized.evidence) {
    const evidencePath = path.resolve(repositoryRoot, evidence.path);
    if (!isWithin(repositoryRoot, evidencePath)) fail(`${label} evidence escapes repository root`);
    const metadata = await stat(evidencePath);
    if (!metadata.isFile()) fail(`${label} evidence is not a file: ${evidence.path}`);
    assertEqual(
      `sha256:${sha256(await readFile(evidencePath))}`,
      evidence.sha256,
      `${label} ${evidence.path} evidence hash`
    );
  }

  runCapturedPackageMutationChecks(manifest, label);
  return normalized;
}

function validateCapturedPackageManifestMetadata(manifest, label) {
  if (!isRecord(manifest)) fail(`${label} manifest must be an object`);
  assertOnlyKeys(manifest, ["components", "evidence", "functions", "package", "schema"], label);
  assertEqual(manifest.schema, "nocad.captured-definition-package.v1", `${label} schema`);
  if (!isRecord(manifest.package)) fail(`${label} package must be an object`);
  assertOnlyKeys(manifest.package, ["contentHash", "name", "version"], `${label} package`);
  const packageDescriptor = {
    contentHash: assertPrefixedSha256(manifest.package.contentHash, `${label} package contentHash`),
    name: assertText(manifest.package.name, `${label} package name`),
    version: assertText(manifest.package.version, `${label} package version`)
  };

  if (!Array.isArray(manifest.evidence) || manifest.evidence.length === 0) {
    fail(`${label} evidence must be a non-empty array`);
  }
  const evidence = manifest.evidence.map((candidate, index) => {
    const entryLabel = `${label} evidence[${index}]`;
    if (!isRecord(candidate)) fail(`${entryLabel} must be an object`);
    assertOnlyKeys(candidate, ["path", "sha256"], entryLabel);
    assertRelativePath(candidate.path, `${entryLabel} path`);
    return {
      path: candidate.path,
      sha256: assertPrefixedSha256(candidate.sha256, `${entryLabel} sha256`)
    };
  });
  assertUniqueValues(evidence.map(({ path: evidencePath }) => evidencePath), `${label} evidence paths`);

  if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
    fail(`${label} components must be a non-empty array`);
  }
  const components = manifest.components.map((candidate, index) =>
    validateCapturedComponentDescriptor(candidate, `${label} components[${index}]`)
  );
  if (manifest.functions !== undefined && !Array.isArray(manifest.functions)) {
    fail(`${label} functions must be an array`);
  }
  const functions = (manifest.functions ?? []).map((candidate, index) =>
    validateCapturedFunctionDescriptor(candidate, `${label} functions[${index}]`)
  );

  const identities = [
    ...components.map(({ id }) => `component:${id}`),
    ...functions.map(({ id }) => `function:${id}`)
  ];
  assertUniqueValues(identities, `${label} definition identities`);
  assertUniqueValues(
    [...components, ...functions].map(({ definitionPath }) => definitionPath),
    `${label} definition paths`
  );

  const content = {
    components: [...components].sort((left, right) => left.id.localeCompare(right.id)),
    evidence: [...evidence].sort((left, right) => left.path.localeCompare(right.path)),
    functions: [...functions].sort((left, right) => left.id.localeCompare(right.id)),
    package: {
      name: packageDescriptor.name,
      version: packageDescriptor.version
    },
    schema: "nocad.captured-definition-package.v1"
  };
  assertEqual(canonicalSha256(content), packageDescriptor.contentHash, `${label} canonical package contentHash`);

  return { ...content, package: packageDescriptor };
}

function validateCapturedComponentDescriptor(candidate, label) {
  if (!isRecord(candidate)) fail(`${label} must be an object`);
  assertOnlyKeys(candidate, [
    "capture",
    "coverage",
    "definitionHash",
    "definitionPath",
    "description",
    "id",
    "origin",
    "provenance",
    "sourceIdentity",
    "visibility"
  ], label);
  assertEqual(candidate.origin, "captured-instance", `${label} origin`);
  assertEqual(candidate.visibility, "dependency-only", `${label} visibility`);
  assertEqual(candidate.coverage, "interface", `${label} coverage`);
  const id = assertText(candidate.id, `${label} id`);
  const definitionPath = assertPackageDefinitionPath(candidate.definitionPath, `${label} definitionPath`);
  const definitionHash = assertPrefixedSha256(candidate.definitionHash, `${label} definitionHash`);
  const description = assertText(candidate.description, `${label} description`);

  if (!isRecord(candidate.sourceIdentity)) fail(`${label} sourceIdentity must be an object`);
  assertOnlyKeys(candidate.sourceIdentity, ["kind", "referenceId", "uuid"], `${label} sourceIdentity`);
  assertEqual(candidate.sourceIdentity.kind, "kicad-schematic-symbol", `${label} sourceIdentity kind`);
  const sourceIdentity = {
    kind: "kicad-schematic-symbol",
    referenceId: assertText(candidate.sourceIdentity.referenceId, `${label} sourceIdentity referenceId`),
    uuid: assertUuid(candidate.sourceIdentity.uuid, `${label} sourceIdentity uuid`)
  };
  if (!id.endsWith(`:${sourceIdentity.uuid}`)) fail(`${label} id must be keyed by its source UUID`);

  return {
    capture: validateCapturedFacts(candidate.capture, `${label} capture`),
    coverage: "interface",
    definitionHash,
    definitionPath,
    description,
    id,
    origin: "captured-instance",
    provenance: validateDefinitionProvenance(candidate.provenance, `${label} provenance`),
    sourceIdentity,
    visibility: "dependency-only"
  };
}

function validateCapturedFunctionDescriptor(candidate, label) {
  if (!isRecord(candidate)) fail(`${label} must be an object`);
  assertOnlyKeys(candidate, [
    "defaultInclude",
    "defaultRequirements",
    "definitionHash",
    "definitionPath",
    "id",
    "kind",
    "label",
    "origin",
    "provenance",
    "sourceIdentity",
    "visibility"
  ], label);
  assertEqual(candidate.kind, "function", `${label} kind`);
  assertEqual(candidate.origin, "reference", `${label} origin`);
  assertEqual(candidate.visibility, "dependency-only", `${label} visibility`);
  if (!isRecord(candidate.sourceIdentity)) fail(`${label} sourceIdentity must be an object`);
  assertOnlyKeys(candidate.sourceIdentity, ["kind", "referenceId"], `${label} sourceIdentity`);
  assertEqual(candidate.sourceIdentity.kind, "reference-design", `${label} sourceIdentity kind`);
  if (candidate.defaultInclude !== undefined && !isRecord(candidate.defaultInclude)) {
    fail(`${label} defaultInclude must be an object`);
  }
  if (candidate.defaultRequirements !== undefined && !isRecord(candidate.defaultRequirements)) {
    fail(`${label} defaultRequirements must be an object`);
  }
  return {
    ...(candidate.defaultInclude === undefined ? {} : { defaultInclude: candidate.defaultInclude }),
    ...(candidate.defaultRequirements === undefined ? {} : { defaultRequirements: candidate.defaultRequirements }),
    definitionHash: assertPrefixedSha256(candidate.definitionHash, `${label} definitionHash`),
    definitionPath: assertPackageDefinitionPath(candidate.definitionPath, `${label} definitionPath`),
    id: assertText(candidate.id, `${label} id`),
    kind: "function",
    label: assertText(candidate.label, `${label} label`),
    origin: "reference",
    provenance: validateDefinitionProvenance(candidate.provenance, `${label} provenance`),
    sourceIdentity: {
      kind: "reference-design",
      referenceId: assertText(candidate.sourceIdentity.referenceId, `${label} sourceIdentity referenceId`)
    },
    visibility: "dependency-only"
  };
}

function validateCapturedFacts(candidate, label) {
  if (!isRecord(candidate)) fail(`${label} must be an object`);
  assertOnlyKeys(candidate, [
    "boardFootprint",
    "footprintLibraryIdAtCapture",
    "referenceAtCapture",
    "symbolLibraryIdAtCapture",
    "valueAtCapture"
  ], label);
  if (!isRecord(candidate.boardFootprint)) fail(`${label} boardFootprint must be an object`);
  assertOnlyKeys(candidate.boardFootprint, ["pads", "uuid"], `${label} boardFootprint`);
  if (!Array.isArray(candidate.boardFootprint.pads) || candidate.boardFootprint.pads.length === 0) {
    fail(`${label} boardFootprint pads must be a non-empty array`);
  }
  const pads = candidate.boardFootprint.pads.map((pad, index) => {
    const padLabel = `${label} boardFootprint pads[${index}]`;
    if (!isRecord(pad)) fail(`${padLabel} must be an object`);
    assertOnlyKeys(pad, ["number", "uuid"], padLabel);
    return {
      number: assertText(pad.number, `${padLabel} number`),
      uuid: assertUuid(pad.uuid, `${padLabel} uuid`)
    };
  });
  assertUniqueValues(pads.map(({ uuid }) => uuid), `${label} boardFootprint pad UUIDs`);
  return {
    boardFootprint: {
      pads,
      uuid: assertUuid(candidate.boardFootprint.uuid, `${label} boardFootprint uuid`)
    },
    footprintLibraryIdAtCapture: assertText(
      candidate.footprintLibraryIdAtCapture,
      `${label} footprintLibraryIdAtCapture`
    ),
    referenceAtCapture: assertText(candidate.referenceAtCapture, `${label} referenceAtCapture`),
    symbolLibraryIdAtCapture: assertText(candidate.symbolLibraryIdAtCapture, `${label} symbolLibraryIdAtCapture`),
    valueAtCapture: assertText(candidate.valueAtCapture, `${label} valueAtCapture`)
  };
}

function validateDefinitionProvenance(candidate, label) {
  if (!Array.isArray(candidate) || candidate.length === 0) fail(`${label} must be a non-empty array`);
  return candidate.map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    if (!isRecord(entry)) fail(`${entryLabel} must be an object`);
    assertOnlyKeys(entry, ["title", "uri"], entryLabel);
    return {
      title: assertText(entry.title, `${entryLabel} title`),
      uri: assertText(entry.uri, `${entryLabel} uri`)
    };
  });
}

async function listPackageTree(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      directories.push(relativePath);
      const nested = await listPackageTree(target, relativePath);
      directories.push(...nested.directories);
      files.push(...nested.files);
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      fail(`captured definition package contains unsupported filesystem entry: ${relativePath}`);
    }
  }
  return { directories: directories.sort(), files: files.sort() };
}

function parentDirectories(filePath) {
  const segments = filePath.split("/");
  return segments.slice(0, -1).map((_segment, index) => segments.slice(0, index + 1).join("/"));
}

function runCapturedPackageMutationChecks(manifest, label) {
  const mutations = [
    ["changed content hash", (copy) => { copy.package.contentHash = `sha256:${"0".repeat(64)}`; }],
    ["palette-visible captured component", (copy) => { copy.components[0].visibility = "palette"; }],
    ["escaping definition path", (copy) => { copy.components[0].definitionPath = "../outside.json"; }],
    ["changed evidence hash", (copy) => { copy.evidence[0].sha256 = `sha256:${"0".repeat(64)}`; }],
    ["non-POSIX evidence path", (copy) => { copy.evidence[0].path = "references\\outside.json"; }]
  ];
  if (manifest.components.length > 1) {
    mutations.push([
      "duplicate definition path",
      (copy) => { copy.components[1].definitionPath = copy.components[0].definitionPath; }
    ]);
  }

  for (const [mutationLabel, mutate] of mutations) {
    const copy = structuredClone(manifest);
    mutate(copy);
    let rejected = false;
    try {
      validateCapturedPackageManifestMetadata(copy, label);
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`${label} package mutation was not rejected: ${mutationLabel}`);
  }
}

function verifyExpectation(expectation, project, manifestPath) {
  if (!isRecord(expectation.counts)) fail(`${manifestPath} expectation counts must be an object`);
  for (const field of ["authoredComponents", "authoredNets", "resolvedNets"]) {
    if (!Number.isSafeInteger(expectation.counts[field]) || expectation.counts[field] < 0) {
      fail(`${manifestPath} expectation counts.${field} must be a non-negative safe integer`);
    }
  }

  if (!Array.isArray(project.nodes)) fail(`${manifestPath} project nodes must be an array`);
  const componentNodes = project.nodes.filter((node) => isRecord(node) && node.kind === "component");
  assertEqual(
    expectation.counts.authoredComponents,
    componentNodes.length,
    `${manifestPath} authored component count`
  );
  if (!Array.isArray(project.edges)) fail(`${manifestPath} project edges must be an array`);
  const authoredNets = project.edges.filter((edge) => isRecord(edge) && edge.kind === "net.authored");
  assertEqual(expectation.counts.authoredNets, authoredNets.length, `${manifestPath} authored net count`);

  if (!Array.isArray(expectation.components)) fail(`${manifestPath} expectation components must be an array`);
  assertEqual(
    expectation.components.length,
    expectation.counts.authoredComponents,
    `${manifestPath} expectation component inventory count`
  );
  const componentIds = expectation.components.map((component, index) => {
    if (!isRecord(component)) fail(`${manifestPath} expectation component ${index} must be an object`);
    assertText(component.node, `${manifestPath} expectation component ${index} node`);
    assertText(component.component, `${manifestPath} expectation component ${index} definition`);
    if (component.refdesHint !== undefined) {
      assertText(component.refdesHint, `${manifestPath} expectation component ${index} refdesHint`);
    }
    return component.node;
  });
  assertCanonicalUniqueOrder(componentIds, `${manifestPath} expectation components`);
  const projectComponentIds = componentNodes.map((node) => node.id).sort();
  assertDeepEqual(componentIds, projectComponentIds, `${manifestPath} expected component closure`);

  if (!Array.isArray(expectation.nets)) fail(`${manifestPath} expectation nets must be an array`);
  assertEqual(
    expectation.nets.length,
    expectation.counts.resolvedNets,
    `${manifestPath} expectation resolved net count`
  );
  const netIds = expectation.nets.map((net, index) => {
    if (!isRecord(net)) fail(`${manifestPath} expectation net ${index} must be an object`);
    for (const field of ["id", "name", "direction", "sourceEdge"]) {
      assertText(net[field], `${manifestPath} expectation net ${index} ${field}`);
    }
    if (!isRecord(net.sourceMap)) fail(`${manifestPath} expectation net ${index} sourceMap must be an object`);
    assertText(net.sourceMap.edge, `${manifestPath} expectation net ${index} sourceMap.edge`);
    assertText(net.sourceMap.signal, `${manifestPath} expectation net ${index} sourceMap.signal`);
    if (net.sourceMap.feature !== undefined) {
      assertText(net.sourceMap.feature, `${manifestPath} expectation net ${index} sourceMap.feature`);
    }
    if (net.sourceMap.segment !== undefined) {
      assertSegment(net.sourceMap.segment, `${manifestPath} expectation net ${index} sourceMap.segment`);
    }
    if (net.realizes !== undefined) {
      if (!isRecord(net.realizes)) fail(`${manifestPath} expectation net ${index} realizes must be an object`);
      assertText(net.realizes.edge, `${manifestPath} expectation net ${index} realizes.edge`);
      assertText(net.realizes.signal, `${manifestPath} expectation net ${index} realizes.signal`);
      if (net.realizes.feature !== undefined) {
        assertText(net.realizes.feature, `${manifestPath} expectation net ${index} realizes.feature`);
      }
      if (net.realizes.segment !== undefined) {
        assertSegment(net.realizes.segment, `${manifestPath} expectation net ${index} realizes.segment`);
      }
    }
    if (!Array.isArray(net.endpoints) || net.endpoints.length < 2) {
      fail(`${manifestPath} expectation net ${index} endpoints must contain at least two entries`);
    }
    for (const [endpointIndex, endpoint] of net.endpoints.entries()) {
      if (!isRecord(endpoint)) {
        fail(`${manifestPath} expectation net ${index} endpoint ${endpointIndex} must be an object`);
      }
      assertText(endpoint.node, `${manifestPath} expectation net ${index} endpoint ${endpointIndex} node`);
      if (endpoint.pin !== undefined) {
        assertText(endpoint.pin, `${manifestPath} expectation net ${index} endpoint ${endpointIndex} pin`);
      }
      if (endpoint.port !== undefined) {
        assertText(endpoint.port, `${manifestPath} expectation net ${index} endpoint ${endpointIndex} port`);
      }
    }
    return net.id;
  });
  assertCanonicalUniqueOrder(netIds, `${manifestPath} expectation nets`);
}

function assertSegment(value, label) {
  if (value !== "connector" && value !== "provider") fail(`${label} must be connector or provider`);
}

async function findNamedFiles(directory, name) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return findNamedFiles(target, name);
      return entry.isFile() && entry.name === name ? [target] : [];
    })
  );
  return nested.flat();
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function singleRole(files, role, manifestPath) {
  const matches = files.filter((entry) => entry.role === role);
  if (matches.length !== 1) fail(`${manifestPath} must contain exactly one ${role} file`);
  return matches[0];
}

function assertRelativePath(value, label) {
  assertText(value, label);
  const segments = value.split("/");
  if (
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value !== path.posix.normalize(value) ||
    segments.includes(".") ||
    segments.includes("..") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    fail(`${label} must be a normalized repository-relative path`);
  }
  return value;
}

function assertCanonicalUniqueOrder(values, label) {
  if (values.some((value) => typeof value !== "string")) fail(`${label} must contain string paths`);
  const sorted = [...new Set(values)].sort();
  assertDeepEqual(values, sorted, `${label} canonical unique order`);
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(`${label} must be lowercase SHA-256`);
}

function assertPrefixedSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail(`${label} must be a lowercase sha256 hash`);
  }
  return value;
}

function assertText(value, label) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function assertUuid(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) {
    fail(`${label} must be a lowercase UUID`);
  }
  return value;
}

function assertPackageDefinitionPath(value, label) {
  assertRelativePath(value, label);
  if (value === "manifest.json" || value === "README.md") {
    fail(`${label} must not replace package metadata`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unexpected.length > 0) fail(`${label} contains unexpected fields: ${unexpected.join(", ")}`);
}

function assertUniqueValues(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} must be unique`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalSha256(value) {
  return `sha256:${sha256(Buffer.from(JSON.stringify(canonicalValue(value))))}`;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  fail("canonical package data must contain only finite JSON values");
}

function fail(message) {
  throw new Error(message);
}
