# `@nocad/component-library`

This package is the data boundary for production component, contract, and function definitions. The resolver and application consume a generic `DefinitionCatalog`; they do not embed knowledge about any component, protocol, or project.

## Layout

- `src/definitions/<manufacturer>/<part-number>.json`: data-only definitions for real, identified parts.
- `src/definitions/contracts` and `src/definitions/functions`: production semantic definitions loaded independently from the engine.
- `src/built-in-manifest.ts`: discoverable metadata and lazy import declarations.
- `src/library.ts`: generic asynchronous source composition, caching, duplicate detection, and loading.
- `src/validation.ts`: generic structural validation at the library boundary.

The built-in catalog intentionally excludes generic stand-ins. A new built-in entry must identify a real manufacturer and part number.

Every descriptor declares its definition coverage. `interface` means the data models only the pins and ports needed by the current semantic workflows. It must not be treated as a complete package, symbol, footprint, or fabrication definition. `complete` is reserved for definitions whose declared provenance and validation establish full package coverage. All initial built-ins are honestly marked `interface`.

Descriptors also carry a per-definition SHA-256 hash plus the owning package's name, version, and content hash. Definition hashes cover canonical JSON with recursively sorted object keys. Package hashes cover the sorted descriptor closure for all definitions in that package. Both are verified at runtime before a catalog is returned. Every definition from one package shares the same package identity. Project authoring can therefore derive dependency entries from catalog metadata instead of parsing or guessing from definition IDs.

`descriptor.package` identifies the versioned nocad definition package. The separate optional `devicePackage` identifies a verified physical device package, such as `QFN-60`, for authored component nodes and future footprint selection.

## Loading

```ts
import {
  builtInComponentLibrary,
  loadBuiltInDefinitionCatalog
} from "@nocad/component-library";

const descriptors = await builtInComponentLibrary.list();
const component = await builtInComponentLibrary.load("@nocad/hdmi-tx:IT66121");
const definitions = await builtInComponentLibrary.loadDefinitions();

// Components, contracts, functions, authoring descriptors, and package index.
const catalog = await loadBuiltInDefinitionCatalog();
```

Additional package, network, or user-defined sources can implement `ComponentDefinitionSource` and be composed without changing loader behavior.

Board envelopes declare `accuracy`. Current interface-level geometry is marked `estimate`. `verified` is accepted only with structured source metadata for qualified geometry.
