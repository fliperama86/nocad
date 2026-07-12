import { builtInComponentLibrary } from "./index-internal";
import { builtInContractEntries, builtInFunctionEntries } from "./catalog-manifest";
import {
  validateConnectionContract,
  validateDefinitionCatalogClosure,
  validateFunctionDefinition
} from "./catalog-validation";
import { canonicalSha256, cloneJsonValue, deepFreeze, verifyCanonicalSha256 } from "./integrity";
import type {
  ComponentDescriptor,
  ComponentPackageDescriptor,
  ContractDescriptor,
  DefinitionKind,
  FunctionAuthoringDescriptor,
  LibraryDefinitionDescriptor,
  LibraryDefinitionEntry,
  LoadedDefinitionCatalog
} from "./types";

type CatalogDataDescriptor = ContractDescriptor | FunctionAuthoringDescriptor;

export class InvalidLibraryDefinitionDescriptorError extends Error {
  constructor(detail: string) {
    super(`Invalid library definition descriptor: ${detail}`);
    this.name = "InvalidLibraryDefinitionDescriptorError";
  }
}

let builtInCatalogPromise: Promise<LoadedDefinitionCatalog> | undefined;

export function loadBuiltInDefinitionCatalog(): Promise<LoadedDefinitionCatalog> {
  builtInCatalogPromise ??= loadCatalog();
  return builtInCatalogPromise;
}

async function loadCatalog(): Promise<LoadedDefinitionCatalog> {
  const [componentDescriptors, components, contractResult, functionResult] = await Promise.all([
    builtInComponentLibrary.list(),
    builtInComponentLibrary.loadDefinitions(),
    loadEntries(builtInContractEntries, validateConnectionContract),
    loadEntries(builtInFunctionEntries, validateFunctionDefinition)
  ]);
  const contractDescriptors = contractResult.descriptors as readonly ContractDescriptor[];
  const functionDescriptors = functionResult.descriptors as readonly FunctionAuthoringDescriptor[];
  const allDescriptors: LibraryDefinitionDescriptor[] = [
    ...componentDescriptors.map(componentLibraryDescriptor),
    ...contractDescriptors,
    ...functionDescriptors
  ];
  const packages = validateUnifiedPackageClosure(allDescriptors);
  const catalog: LoadedDefinitionCatalog = {
    components,
    contracts: contractResult.definitions,
    functions: functionResult.definitions,
    library: {
      componentDescriptors,
      contractDescriptors,
      functionDescriptors,
      packages
    }
  };
  validateDefinitionCatalogClosure(catalog);
  return deepFreeze(catalog);
}

async function loadEntries<TDefinition extends object, TDescriptor extends CatalogDataDescriptor>(
  entries: readonly LibraryDefinitionEntry<TDescriptor>[],
  validate: (value: unknown, expectedId: string) => TDefinition
): Promise<{ definitions: Readonly<Record<string, TDefinition>>; descriptors: readonly TDescriptor[] }> {
  const descriptors = entries.map(({ descriptor }) => validateDataDescriptor(descriptor) as TDescriptor);
  const seen = new Set<string>();
  const definitions: Record<string, TDefinition> = {};

  await Promise.all(
    entries.map(async (entry, index) => {
      const descriptor = descriptors[index];
      if (!descriptor) throw new InvalidLibraryDefinitionDescriptorError("entry has no descriptor");
      const key = `${descriptor.kind}:${descriptor.id}`;
      if (seen.has(key)) throw new InvalidLibraryDefinitionDescriptorError(`duplicate ${key}`);
      seen.add(key);
      const module = await entry.load();
      const definition = validate(cloneJsonValue(module.default), descriptor.id);
      verifyCanonicalSha256(definition, descriptor.definitionHash, key);
      definitions[descriptor.id] = deepFreeze({
        ...definition,
        dependency: {
          name: descriptor.package.name,
          version: descriptor.package.version
        }
      });
    })
  );

  return deepFreeze({ definitions, descriptors });
}

function validateDataDescriptor(value: unknown): CatalogDataDescriptor {
  const cloned = cloneJsonValue(value) as Record<string, unknown>;
  const kind = cloned.kind;
  if (kind !== "contract" && kind !== "function") invalid("kind must be contract or function");
  const id = text(cloned.id, "id");
  const definitionHash = hash(cloned.definitionHash, `${kind}:${id}.definitionHash`);
  const label = text(cloned.label, `${kind}:${id}.label`);
  const packageDefinition = packageDescriptor(cloned.package, `${kind}:${id}.package`);

  if (kind === "contract") {
    return deepFreeze({ definitionHash, id, kind, label, package: packageDefinition });
  }

  const defaultInclude = optionalJsonRecord(cloned.defaultInclude, `${kind}:${id}.defaultInclude`);
  const defaultRequirements = optionalJsonRecord(cloned.defaultRequirements, `${kind}:${id}.defaultRequirements`);
  return deepFreeze({
    ...(defaultInclude ? { defaultInclude } : {}),
    ...(defaultRequirements ? { defaultRequirements } : {}),
    definitionHash,
    id,
    kind,
    label,
    package: packageDefinition
  });
}

function validateUnifiedPackageClosure(
  descriptors: readonly LibraryDefinitionDescriptor[]
): Readonly<Record<string, ComponentPackageDescriptor>> {
  const grouped = new Map<string, LibraryDefinitionDescriptor[]>();
  for (const descriptor of descriptors) {
    const current = grouped.get(descriptor.package.name) ?? [];
    current.push(descriptor);
    grouped.set(descriptor.package.name, current);
  }
  const packages: Record<string, ComponentPackageDescriptor> = {};

  for (const [packageName, members] of grouped) {
    const first = members[0];
    if (!first) continue;
    for (const member of members.slice(1)) {
      if (
        member.package.version !== first.package.version ||
        member.package.contentHash !== first.package.contentHash
      ) {
        invalid(`${packageName} descriptors disagree on package version or content hash`);
      }
    }
    const closure = members
      .map(({ definitionHash, id, kind }) => ({ definitionHash, id, kind }))
      .sort(compareClosureEntry);
    const actualHash = canonicalSha256(closure);
    if (actualHash !== first.package.contentHash) {
      invalid(`${packageName} expected closure ${first.package.contentHash}, received ${actualHash}`);
    }
    packages[packageName] = first.package;
  }

  return deepFreeze(packages);
}

function componentLibraryDescriptor(descriptor: ComponentDescriptor): LibraryDefinitionDescriptor {
  return {
    definitionHash: descriptor.definitionHash,
    id: descriptor.id,
    kind: "component",
    package: descriptor.package
  };
}

function compareClosureEntry(
  left: { id: string; kind: DefinitionKind },
  right: { id: string; kind: DefinitionKind }
): number {
  return left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
}

function packageDescriptor(value: unknown, field: string): ComponentPackageDescriptor {
  if (!isRecord(value)) invalid(`${field} must be an object`);
  return deepFreeze({
    contentHash: hash(value.contentHash, `${field}.contentHash`),
    name: text(value.name, `${field}.name`),
    version: text(value.version, `${field}.version`)
  });
}

function optionalJsonRecord(value: unknown, field: string): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalid(`${field} must be an object`);
  return deepFreeze(value);
}

function hash(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) invalid(`${field} must be a lowercase sha256 hash`);
  return result;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    invalid(`${field} must be a non-empty trimmed string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(detail: string): never {
  throw new InvalidLibraryDefinitionDescriptorError(detail);
}
