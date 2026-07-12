import type { ComponentDefinition } from "@nocad/intent-core";

import type {
  ComponentDefinitionSource,
  ComponentDescriptor,
  ComponentLibraryEntry,
  LoadedComponent
} from "./types";
import {
  validateComponentDescriptor,
  validateComponentPackageClosure
} from "./descriptor";
import { cloneJsonValue, deepFreeze, verifyCanonicalSha256 } from "./integrity";
import { validateComponentDefinition } from "./validation";

export class DuplicateComponentDefinitionError extends Error {
  readonly componentId: string;

  constructor(componentId: string) {
    super(`Multiple component sources provide ${componentId}`);
    this.name = "DuplicateComponentDefinitionError";
    this.componentId = componentId;
  }
}

export class UnknownComponentDefinitionError extends Error {
  readonly componentId: string;

  constructor(componentId: string) {
    super(`No component source provides ${componentId}`);
    this.name = "UnknownComponentDefinitionError";
    this.componentId = componentId;
  }
}

export function createManifestSource(entries: readonly ComponentLibraryEntry[]): ComponentDefinitionSource {
  const byId = new Map<string, ComponentLibraryEntry>();

  for (const entry of entries) {
    const descriptor = validateComponentDescriptor(entry.descriptor);
    if (byId.has(descriptor.id)) {
      throw new DuplicateComponentDefinitionError(descriptor.id);
    }
    byId.set(descriptor.id, { ...entry, descriptor });
  }

  return {
    async list() {
      return [...byId.values()].map(({ descriptor }) => descriptor);
    },
    async load(id) {
      const entry = byId.get(id);
      if (!entry) return undefined;
      return (await entry.load()).default;
    }
  };
}

export class ComponentLibrary {
  readonly #sources: readonly ComponentDefinitionSource[];
  readonly #loaded = new Map<string, Promise<LoadedComponent | undefined>>();

  constructor(sources: readonly ComponentDefinitionSource[]) {
    this.#sources = [...sources];
  }

  async list(): Promise<readonly ComponentDescriptor[]> {
    const descriptors = (await Promise.all(this.#sources.map((source) => source.list())))
      .flat()
      .map(validateComponentDescriptor);
    const seen = new Set<string>();

    for (const descriptor of descriptors) {
      if (seen.has(descriptor.id)) {
        throw new DuplicateComponentDefinitionError(descriptor.id);
      }
      seen.add(descriptor.id);
    }

    const sorted = descriptors.sort((left, right) => left.id.localeCompare(right.id));
    validateComponentPackageClosure(sorted);
    return deepFreeze(sorted);
  }

  async load(id: string): Promise<LoadedComponent | undefined> {
    const cached = this.#loaded.get(id);
    if (cached) return cached;

    const pending = this.#loadUncached(id);
    this.#loaded.set(id, pending);
    return pending;
  }

  async loadDefinitions(ids?: readonly string[]): Promise<Readonly<Record<string, ComponentDefinition>>> {
    const selectedIds = ids ?? (await this.list()).map(({ id }) => id);
    const loaded = await Promise.all(selectedIds.map((id) => this.load(id)));
    const definitions: Record<string, ComponentDefinition> = {};

    for (const [index, component] of loaded.entries()) {
      if (!component) throw new UnknownComponentDefinitionError(selectedIds[index]);
      definitions[component.definition.id] = component.definition;
    }

    return Object.freeze(definitions);
  }

  async #loadUncached(id: string): Promise<LoadedComponent | undefined> {
    const descriptor = (await this.list()).find((candidate) => candidate.id === id);
    if (!descriptor) return undefined;
    const candidates = await Promise.all(
      this.#sources.map(async (source) => {
        const [descriptors, value] = await Promise.all([source.list(), source.load(id)]);
        const descriptor = descriptors.find((candidate) => candidate.id === id);
        return value === undefined || descriptor === undefined ? undefined : { descriptor, value };
      })
    );
    const matches = candidates.filter((candidate) => candidate !== undefined);

    if (matches.length > 1) {
      throw new DuplicateComponentDefinitionError(id);
    }

    const match = matches[0];
    if (!match) return undefined;

    const definition = validateComponentDefinition(cloneJsonValue(match.value), id);
    verifyCanonicalSha256(definition, descriptor.definitionHash, id);
    return deepFreeze({ definition: deepFreeze(definition), descriptor });
  }
}
