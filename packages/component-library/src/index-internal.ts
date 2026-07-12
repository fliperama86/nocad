import { builtInComponentEntries } from "./built-in-manifest";
import { ComponentLibrary, createManifestSource } from "./library";

export const builtInComponentLibrary = new ComponentLibrary([createManifestSource(builtInComponentEntries)]);
