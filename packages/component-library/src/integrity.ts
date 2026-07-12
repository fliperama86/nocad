import { sha256Text } from "@nocad/intent-core";

export class DefinitionIntegrityError extends Error {
  readonly definitionId: string;

  constructor(definitionId: string, detail: string) {
    super(`Definition integrity check failed for ${definitionId}: ${detail}`);
    this.name = "DefinitionIntegrityError";
    this.definitionId = definitionId;
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalSha256(value: unknown): string {
  return `sha256:${sha256Text(canonicalJson(value))}`;
}

export function verifyCanonicalSha256(value: unknown, expectedHash: string, definitionId: string): void {
  const actualHash = canonicalSha256(value);
  if (actualHash !== expectedHash) {
    throw new DefinitionIntegrityError(
      definitionId,
      `expected ${expectedHash}, received ${actualHash}`
    );
  }
}

export function cloneJsonValue<T>(value: T): T {
  return cloneValue(value, new Set()) as T;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])])
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
  throw new TypeError("Canonical JSON values must contain only finite JSON data.");
}

function cloneValue(value: unknown, seen: Set<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== "object") throw new TypeError("Definition data must be JSON-compatible.");
  if (seen.has(value)) throw new TypeError("Definition data must not contain cycles.");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => cloneValue(entry, seen));
    if (!isRecord(value)) throw new TypeError("Definition data must use plain objects.");
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child, seen)])
    );
  } finally {
    seen.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
