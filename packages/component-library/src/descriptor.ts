import type { ComponentDescriptor, ComponentPackageDescriptor, ComponentProvenance } from "./types";
import { canonicalSha256, cloneJsonValue, deepFreeze } from "./integrity";

type UnknownRecord = Record<string, unknown>;

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const nonIdentityPattern = /(?:^|[\s_-])(fake|generic|placeholder|test|unknown)(?:$|[\s_-])/i;

export class InvalidComponentDescriptorError extends Error {
  readonly componentId?: string;

  constructor(detail: string, componentId?: string) {
    super(`Invalid component descriptor${componentId ? ` ${componentId}` : ""}: ${detail}`);
    this.name = "InvalidComponentDescriptorError";
    this.componentId = componentId;
  }
}

export class InconsistentDefinitionPackageError extends Error {
  readonly packageName: string;

  constructor(packageName: string, detail: string) {
    super(`Invalid definition package ${packageName}: ${detail}`);
    this.name = "InconsistentDefinitionPackageError";
    this.packageName = packageName;
  }
}

export function validateComponentDescriptor(value: unknown): ComponentDescriptor {
  const cloned = cloneJsonValue(value);
  const descriptor = requireRecord(cloned, "descriptor");
  const id = requireText(descriptor.id, "id");
  const coverage = descriptor.coverage;
  if (coverage !== "interface" && coverage !== "complete") {
    throw invalid("coverage must be interface or complete", id);
  }
  const manufacturer = requireIdentity(descriptor.manufacturer, "manufacturer", id);
  const partNumber = requireIdentity(descriptor.partNumber, "partNumber", id);
  const definitionHash = requireHash(descriptor.definitionHash, "definitionHash", id);
  const description = requireText(descriptor.description, "description", id);
  const packageDefinition = validatePackageDescriptor(descriptor.package, id);
  const devicePackage =
    descriptor.devicePackage === undefined
      ? undefined
      : requireText(descriptor.devicePackage, "devicePackage", id);
  const provenance = validateProvenance(descriptor.provenance, id);

  const normalized: ComponentDescriptor = {
    coverage,
    definitionHash,
    description,
    ...(devicePackage === undefined ? {} : { devicePackage }),
    id,
    manufacturer,
    package: packageDefinition,
    partNumber,
    ...(provenance === undefined ? {} : { provenance })
  };
  return deepFreeze(normalized);
}

export function validateComponentPackageClosure(descriptors: readonly ComponentDescriptor[]): void {
  const packages = new Map<string, ComponentDescriptor[]>();
  for (const descriptor of descriptors) {
    const current = packages.get(descriptor.package.name) ?? [];
    current.push(descriptor);
    packages.set(descriptor.package.name, current);
  }

  for (const [packageName, members] of packages) {
    const [first] = members;
    if (!first) continue;
    for (const member of members.slice(1)) {
      if (
        member.package.version !== first.package.version ||
        member.package.contentHash !== first.package.contentHash
      ) {
        throw new InconsistentDefinitionPackageError(
          packageName,
          "all descriptors must declare the same version and content hash"
        );
      }
    }
    const closure = members
      .map(({ definitionHash, id }) => ({ definitionHash, id, kind: "component" as const }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const actualHash = canonicalSha256(closure);
    if (actualHash !== first.package.contentHash) {
      throw new InconsistentDefinitionPackageError(
        packageName,
        `expected closure ${first.package.contentHash}, received ${actualHash}`
      );
    }
  }
}

function validatePackageDescriptor(value: unknown, id: string): ComponentPackageDescriptor {
  const packageDefinition = requireRecord(value, "package", id);
  return deepFreeze({
    contentHash: requireHash(packageDefinition.contentHash, "package.contentHash", id),
    name: requireText(packageDefinition.name, "package.name", id),
    version: requireText(packageDefinition.version, "package.version", id)
  });
}

function validateProvenance(value: unknown, id: string): readonly ComponentProvenance[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw invalid("provenance must be a non-empty array", id);
  return deepFreeze(
    value.map((candidate, index) => {
      const provenance = requireRecord(candidate, `provenance[${index}]`, id);
      return {
        title: requireText(provenance.title, `provenance[${index}].title`, id),
        uri: requireText(provenance.uri, `provenance[${index}].uri`, id)
      };
    })
  );
}

function requireRecord(value: unknown, field: string, id?: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${field} must be an object`, id);
  }
  return value as UnknownRecord;
}

function requireHash(value: unknown, field: string, id: string): string {
  const hash = requireText(value, field, id);
  if (!sha256Pattern.test(hash)) throw invalid(`${field} must be a lowercase sha256 hash`, id);
  return hash;
}

function requireIdentity(value: unknown, field: string, id: string): string {
  const identity = requireText(value, field, id);
  if (nonIdentityPattern.test(identity)) {
    throw invalid(`${field} must identify a real production part`, id);
  }
  return identity;
}

function requireText(value: unknown, field: string, id?: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw invalid(`${field} must be a non-empty trimmed string`, id);
  }
  return value;
}

function invalid(detail: string, id?: string): InvalidComponentDescriptorError {
  return new InvalidComponentDescriptorError(detail, id);
}
