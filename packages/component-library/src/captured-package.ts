import { canonicalSha256, cloneJsonValue, deepFreeze } from "./integrity";
import type {
  CapturedComponentFacts,
  CapturedDefinitionPackageManifest,
  CapturedDefinitionPackageSource,
  CapturedPackageDefinitionLoader,
  CapturedPackageComponentEntry,
  CapturedPackageEvidence,
  CapturedPackageFunctionEntry,
  ComponentPackageDescriptor,
  ComponentProvenance,
  LibraryDefinitionDescriptor
} from "./types";

type UnknownRecord = Record<string, unknown>;

const hashPattern = /^sha256:[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class InvalidCapturedDefinitionPackageError extends Error {
  constructor(detail: string) {
    super(`Invalid captured definition package: ${detail}`);
    this.name = "InvalidCapturedDefinitionPackageError";
  }
}

export function createCapturedPackageSource(
  manifestValue: unknown,
  loaders: Readonly<Record<string, CapturedPackageDefinitionLoader>>
): CapturedDefinitionPackageSource {
  const manifest = validateCapturedDefinitionPackageManifest(manifestValue);
  const expectedLoaderKeys = new Set(
    [
      ...manifest.components.map(({ definitionPath }) => definitionPath),
      ...(manifest.functions ?? []).map(({ definitionPath }) => definitionPath)
    ]
  );

  for (const key of expectedLoaderKeys) {
    if (typeof loaders[key] !== "function") invalid(`missing payload loader ${key}`);
  }
  for (const key of Object.keys(loaders)) {
    if (!expectedLoaderKeys.has(key)) invalid(`unexpected payload loader ${key}`);
  }
  const loaderByPath = Object.freeze(
    Object.fromEntries([...expectedLoaderKeys].map((key) => [key, loaders[key]!]))
  );

  const componentPaths = new Map<string, string>();
  const componentDescriptors = manifest.components.map(({ definitionPath, ...descriptor }) => {
    componentPaths.set(descriptor.id, definitionPath);
    return deepFreeze({ ...descriptor, package: manifest.package });
  });
  const functionPaths = new Map<string, string>();
  const functionDescriptors = (manifest.functions ?? []).map(({ definitionPath, ...descriptor }) => {
    functionPaths.set(descriptor.id, definitionPath);
    return deepFreeze({ ...descriptor, package: manifest.package });
  });

  return deepFreeze({
    componentDescriptors,
    functionDescriptors,
    async load(kind: "component" | "function", id: string) {
      const definitionPath = (kind === "component" ? componentPaths : functionPaths).get(id);
      return definitionPath ? (await loaderByPath[definitionPath]?.())?.default : undefined;
    },
    package: manifest.package
  });
}

export function validateCapturedDefinitionPackageManifest(
  value: unknown
): CapturedDefinitionPackageManifest {
  const cloned = cloneJsonValue(value);
  const manifest = record(cloned, "manifest");
  if (manifest.schema !== "nocad.captured-definition-package.v1") {
    invalid("schema must be nocad.captured-definition-package.v1");
  }
  const packageDescriptor = validatePackageDescriptor(manifest.package);
  const evidence = validateEvidence(manifest.evidence);
  const components = array(manifest.components, "components").map((candidate, index) =>
    validateCapturedComponent(candidate, `components[${index}]`)
  );
  if (components.length === 0) invalid("components must not be empty");
  const functions = manifest.functions === undefined
    ? undefined
    : array(manifest.functions, "functions").map((candidate, index) =>
        validateCapturedFunction(candidate, `functions[${index}]`)
      );
  const descriptors: LibraryDefinitionDescriptor[] = [
    ...components.map((descriptor) => ({
      definitionHash: descriptor.definitionHash,
      id: descriptor.id,
      kind: "component" as const,
      package: packageDescriptor
    })),
    ...(functions ?? []).map((descriptor) => ({
      definitionHash: descriptor.definitionHash,
      id: descriptor.id,
      kind: "function" as const,
      package: packageDescriptor
    }))
  ];
  validateDescriptorIdentities(descriptors);
  const definitionPaths = [
    ...components.map(({ definitionPath }) => definitionPath),
    ...(functions ?? []).map(({ definitionPath }) => definitionPath)
  ];
  if (new Set(definitionPaths).size !== definitionPaths.length) {
    invalid("definition paths must be unique");
  }
  validatePackageContent(
    { components, evidence, functions, package: packageDescriptor },
    packageDescriptor
  );

  return deepFreeze({
    components,
    evidence,
    ...(functions === undefined ? {} : { functions }),
    package: packageDescriptor,
    schema: "nocad.captured-definition-package.v1"
  });
}

function validateCapturedComponent(value: unknown, field: string): CapturedPackageComponentEntry {
  const descriptor = record(value, field);
  const id = text(descriptor.id, `${field}.id`);
  if (descriptor.origin !== "captured-instance") invalid(`${field}.origin must be captured-instance`);
  if (descriptor.visibility !== "dependency-only") invalid(`${field}.visibility must be dependency-only`);
  if (descriptor.coverage !== "interface") invalid(`${field}.coverage must be interface`);
  const sourceIdentity = record(descriptor.sourceIdentity, `${field}.sourceIdentity`);
  if (sourceIdentity.kind !== "kicad-schematic-symbol") {
    invalid(`${field}.sourceIdentity.kind must be kicad-schematic-symbol`);
  }
  const referenceId = text(sourceIdentity.referenceId, `${field}.sourceIdentity.referenceId`);
  const uuid = requireUuid(sourceIdentity.uuid, `${field}.sourceIdentity.uuid`);
  if (!id.endsWith(`:${uuid}`)) invalid(`${field}.id must be keyed by its source UUID`);

  return deepFreeze({
    capture: validateCapture(descriptor.capture, `${field}.capture`),
    coverage: "interface",
    definitionHash: hash(descriptor.definitionHash, `${field}.definitionHash`),
    description: text(descriptor.description, `${field}.description`),
    definitionPath: relativePath(descriptor.definitionPath, `${field}.definitionPath`),
    id,
    origin: "captured-instance",
    provenance: validateProvenance(descriptor.provenance, `${field}.provenance`),
    sourceIdentity: {
      kind: "kicad-schematic-symbol",
      referenceId,
      uuid
    },
    visibility: "dependency-only"
  });
}

function validateCapturedFunction(value: unknown, field: string): CapturedPackageFunctionEntry {
  const descriptor = record(value, field);
  if (descriptor.kind !== "function") invalid(`${field}.kind must be function`);
  if (descriptor.origin !== "reference") invalid(`${field}.origin must be reference`);
  if (descriptor.visibility !== "dependency-only") invalid(`${field}.visibility must be dependency-only`);
  const sourceIdentity = record(descriptor.sourceIdentity, `${field}.sourceIdentity`);
  if (sourceIdentity.kind !== "reference-design") {
    invalid(`${field}.sourceIdentity.kind must be reference-design`);
  }
  const defaultInclude = optionalRecord(descriptor.defaultInclude, `${field}.defaultInclude`);
  const defaultRequirements = optionalRecord(descriptor.defaultRequirements, `${field}.defaultRequirements`);

  return deepFreeze({
    ...(defaultInclude === undefined ? {} : { defaultInclude }),
    ...(defaultRequirements === undefined ? {} : { defaultRequirements }),
    definitionHash: hash(descriptor.definitionHash, `${field}.definitionHash`),
    definitionPath: relativePath(descriptor.definitionPath, `${field}.definitionPath`),
    id: text(descriptor.id, `${field}.id`),
    kind: "function",
    label: text(descriptor.label, `${field}.label`),
    origin: "reference",
    provenance: validateProvenance(descriptor.provenance, `${field}.provenance`),
    sourceIdentity: {
      kind: "reference-design",
      referenceId: text(sourceIdentity.referenceId, `${field}.sourceIdentity.referenceId`)
    },
    visibility: "dependency-only"
  });
}

function validateCapture(value: unknown, field: string): CapturedComponentFacts {
  const capture = record(value, field);
  const boardFootprint = record(capture.boardFootprint, `${field}.boardFootprint`);
  const pads = array(boardFootprint.pads, `${field}.boardFootprint.pads`).map((candidate, index) => {
    const pad = record(candidate, `${field}.boardFootprint.pads[${index}]`);
    return {
      number: text(pad.number, `${field}.boardFootprint.pads[${index}].number`),
      uuid: requireUuid(pad.uuid, `${field}.boardFootprint.pads[${index}].uuid`)
    };
  });
  if (pads.length === 0) invalid(`${field}.boardFootprint.pads must not be empty`);
  if (new Set(pads.map(({ uuid }) => uuid)).size !== pads.length) {
    invalid(`${field}.boardFootprint.pads must have unique UUIDs`);
  }
  return deepFreeze({
    boardFootprint: {
      pads,
      uuid: requireUuid(boardFootprint.uuid, `${field}.boardFootprint.uuid`)
    },
    footprintLibraryIdAtCapture: text(
      capture.footprintLibraryIdAtCapture,
      `${field}.footprintLibraryIdAtCapture`
    ),
    referenceAtCapture: text(capture.referenceAtCapture, `${field}.referenceAtCapture`),
    symbolLibraryIdAtCapture: text(capture.symbolLibraryIdAtCapture, `${field}.symbolLibraryIdAtCapture`),
    valueAtCapture: text(capture.valueAtCapture, `${field}.valueAtCapture`)
  });
}

function validateEvidence(value: unknown): readonly CapturedPackageEvidence[] {
  const evidence = array(value, "evidence").map((candidate, index) => {
    const item = record(candidate, `evidence[${index}]`);
    const path = normalizedRelativePosixPath(
      item.path,
      `evidence[${index}].path`,
      "repository-relative"
    );
    return {
      path,
      sha256: hash(item.sha256, `evidence[${index}].sha256`)
    };
  });
  if (evidence.length === 0) invalid("evidence must not be empty");
  if (new Set(evidence.map(({ path }) => path)).size !== evidence.length) {
    invalid("evidence paths must be unique");
  }
  return deepFreeze(evidence);
}

function validateProvenance(value: unknown, field: string): readonly ComponentProvenance[] {
  const provenance = array(value, field).map((candidate, index) => {
    const item = record(candidate, `${field}[${index}]`);
    return {
      title: text(item.title, `${field}[${index}].title`),
      uri: text(item.uri, `${field}[${index}].uri`)
    };
  });
  if (provenance.length === 0) invalid(`${field} must not be empty`);
  return deepFreeze(provenance);
}

function validatePackageDescriptor(value: unknown): ComponentPackageDescriptor {
  const descriptor = record(value, "package");
  return deepFreeze({
    contentHash: hash(descriptor.contentHash, "package.contentHash"),
    name: text(descriptor.name, "package.name"),
    version: text(descriptor.version, "package.version")
  });
}

function validatePackageContent(
  manifest: Pick<CapturedDefinitionPackageManifest, "components" | "evidence" | "functions" | "package">,
  packageDescriptor: ComponentPackageDescriptor
) {
  const content = {
    components: [...manifest.components].sort((left, right) => left.id.localeCompare(right.id)),
    evidence: [...manifest.evidence].sort((left, right) => left.path.localeCompare(right.path)),
    functions: [...(manifest.functions ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
    package: {
      name: manifest.package.name,
      version: manifest.package.version
    },
    schema: "nocad.captured-definition-package.v1"
  };
  const actualHash = canonicalSha256(content);
  if (actualHash !== packageDescriptor.contentHash) {
    invalid(`package expected content ${packageDescriptor.contentHash}, received ${actualHash}`);
  }
}

function validateDescriptorIdentities(descriptors: readonly LibraryDefinitionDescriptor[]) {
  const keys = descriptors.map(({ id, kind }) => `${kind}:${id}`);
  if (new Set(keys).size !== keys.length) invalid("definition identities must be unique");
}

function relativePath(value: unknown, field: string): string {
  return normalizedRelativePosixPath(value, field, "package-relative");
}

function normalizedRelativePosixPath(
  value: unknown,
  field: string,
  scope: "package-relative" | "repository-relative"
): string {
  const result = text(value, field);
  const segments = result.split("/");
  if (
    result.startsWith("/") ||
    /^[A-Za-z]:/.test(result) ||
    result.includes("\\") ||
    result.includes("\0") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    invalid(`${field} must be a normalized ${scope} POSIX path`);
  }
  return result;
}

function optionalRecord(value: unknown, field: string): Readonly<Record<string, unknown>> | undefined {
  return value === undefined ? undefined : deepFreeze(record(value, field));
}

function record(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${field} must be an object`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    invalid(`${field} must be a non-empty trimmed string`);
  }
  return value;
}

function hash(value: unknown, field: string): string {
  const result = text(value, field);
  if (!hashPattern.test(result)) invalid(`${field} must be a lowercase sha256 hash`);
  return result;
}

function requireUuid(value: unknown, field: string): string {
  const result = text(value, field);
  if (!uuidPattern.test(result)) invalid(`${field} must be a lowercase UUID`);
  return result;
}

function invalid(detail: string): never {
  throw new InvalidCapturedDefinitionPackageError(detail);
}
