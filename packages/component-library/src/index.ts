import { builtInComponentLibrary } from "./index-internal";

export { builtInComponentEntries } from "./built-in-manifest";
export { builtInContractEntries, builtInFunctionEntries } from "./catalog-manifest";
export {
  loadBuiltInDefinitionCatalog,
  loadDefinitionCatalogForDependencies,
  InvalidLibraryDefinitionDescriptorError
} from "./catalog";
export {
  createCapturedPackageSource,
  InvalidCapturedDefinitionPackageError,
  validateCapturedDefinitionPackageManifest
} from "./captured-package";
export {
  DefinitionCatalogClosureError,
  InvalidCatalogDefinitionError,
  validateConnectionContract,
  validateDefinitionCatalogClosure,
  validateFunctionDefinition
} from "./catalog-validation";
export {
  ComponentLibrary,
  createManifestSource,
  DuplicateComponentDefinitionError,
  UnknownComponentDefinitionError
} from "./library";
export {
  InconsistentDefinitionPackageError,
  InvalidComponentDescriptorError,
  validateComponentDescriptor,
  validateComponentPackageClosure
} from "./descriptor";
export {
  canonicalJson,
  canonicalSha256,
  DefinitionIntegrityError,
  verifyCanonicalSha256
} from "./integrity";
export type {
  CapturedComponentDescriptor,
  CapturedComponentFacts,
  CapturedComponentSourceIdentity,
  CapturedDefinitionPackageManifest,
  CapturedDefinitionPackageSource,
  CapturedFunctionDescriptor,
  CapturedPackageDefinitionLoader,
  CapturedPackageComponentEntry,
  CapturedPackageEvidence,
  CapturedPackageFunctionEntry,
  ComponentDefinitionModule,
  ComponentDefinitionSource,
  ComponentDescriptor,
  ComponentProvenance,
  ComponentLibraryEntry,
  ComponentPackageDescriptor,
  ContractDescriptor,
  DefinitionKind,
  DefinitionPackageIndex,
  FunctionAuthoringDescriptor,
  LibraryDefinitionDescriptor,
  LibraryDefinitionEntry,
  LoadedDefinitionCatalog,
  LoadedComponent
} from "./types";
export { InvalidComponentDefinitionError, validateComponentDefinition } from "./validation";

export { builtInComponentLibrary };
