import {
  createCapturedPackageSource,
  type ComponentDefinitionModule
} from "@nocad/component-library";

import packageManifest from "../../../../../fixtures/definition-packages/pico-retrodigital-main/captured-instances/manifest.json";
import { definitionPackageLoadersFromGlob } from "../definition-package-source";

const packageRootPath =
  "../../../../../fixtures/definition-packages/pico-retrodigital-main/captured-instances";
const definitionModules = import.meta.glob<ComponentDefinitionModule>(
  "../../../../../fixtures/definition-packages/pico-retrodigital-main/captured-instances/definitions/**/*.json"
);

export const packageSource = createCapturedPackageSource(
  packageManifest,
  definitionPackageLoadersFromGlob(packageRootPath, definitionModules)
);
