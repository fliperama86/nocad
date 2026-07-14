import type { CapturedPackageDefinitionLoader } from "@nocad/component-library";

export class InvalidDefinitionPackageGlobError extends Error {
  constructor(detail: string) {
    super(`Invalid definition package glob: ${detail}`);
    this.name = "InvalidDefinitionPackageGlobError";
  }
}

export function definitionPackageLoadersFromGlob(
  packageRootPath: string,
  modules: Readonly<Record<string, CapturedPackageDefinitionLoader>>
): Readonly<Record<string, CapturedPackageDefinitionLoader>> {
  const packageRoot = parsePath(packageRootPath, "package root");
  const loaders = new Map<string, CapturedPackageDefinitionLoader>();

  for (const [modulePath, loader] of Object.entries(modules)) {
    const module = parsePath(modulePath, "module path");
    const definitionPath = relativeDescendantPath(packageRoot, module);

    if (loaders.has(definitionPath)) {
      throw new InvalidDefinitionPackageGlobError(
        `duplicate normalized definition path ${definitionPath}`
      );
    }

    loaders.set(definitionPath, loader);
  }

  return Object.freeze(Object.fromEntries(loaders));
}

type ParsedPath = {
  absolute: boolean;
  original: string;
  segments: readonly string[];
};

function parsePath(value: string, field: string): ParsedPath {
  if (value.length === 0) {
    throw new InvalidDefinitionPackageGlobError(`${field} must not be empty`);
  }

  const path = value.replaceAll("\\", "/");
  const absolute = path.startsWith("/");
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;

    if (segment === "..") {
      const previous = segments.at(-1);
      if (previous !== undefined && previous !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push(segment);
      }
      continue;
    }

    segments.push(segment);
  }

  return { absolute, original: value, segments };
}

function relativeDescendantPath(packageRoot: ParsedPath, module: ParsedPath): string {
  if (
    packageRoot.absolute !== module.absolute ||
    packageRoot.segments.some((segment, index) => module.segments[index] !== segment)
  ) {
    throw outsideRoot(module.original);
  }

  const relativeSegments = module.segments.slice(packageRoot.segments.length);
  if (relativeSegments.length === 0) {
    throw new InvalidDefinitionPackageGlobError(
      `module path ${module.original} must not resolve to the package root`
    );
  }
  if (relativeSegments[0] === "..") throw outsideRoot(module.original);

  return relativeSegments.join("/");
}

function outsideRoot(modulePath: string): InvalidDefinitionPackageGlobError {
  return new InvalidDefinitionPackageGlobError(
    `module path ${modulePath} must resolve inside the package root`
  );
}
