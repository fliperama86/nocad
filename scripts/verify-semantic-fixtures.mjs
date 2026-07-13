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
    "nocad.semantic-fixture-expectation.v1",
    `${manifestPath} expectation schema`
  );
  assertEqual(expectation.project, manifest.id, `${manifestPath} expectation project`);

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
  if (path.isAbsolute(value) || value !== path.normalize(value) || value.startsWith("..") || value.includes("\\")) {
    fail(`${label} must be a normalized repository-relative path`);
  }
}

function assertCanonicalUniqueOrder(values, label) {
  if (values.some((value) => typeof value !== "string")) fail(`${label} must contain string paths`);
  const sorted = [...new Set(values)].sort();
  assertDeepEqual(values, sorted, `${label} canonical unique order`);
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(`${label} must be lowercase SHA-256`);
}

function assertText(value, label) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail(`${label} must be a non-empty trimmed string`);
  }
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

function fail(message) {
  throw new Error(message);
}
