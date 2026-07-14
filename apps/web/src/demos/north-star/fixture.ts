import fixtureManifest from "../../../../../fixtures/semantic/pico-retrodigital-main/video-output/manifest.json";
import projectJson from "../../../../../fixtures/semantic/pico-retrodigital-main/video-output/project.nocad.json?raw";

import { createWorkspaceFixture } from "../workspace-fixture";
import positions from "./positions.json";
import { packageSource } from "./captured-package-source";

export const fixture = createWorkspaceFixture({
  manifestValue: fixtureManifest,
  packageSources: [packageSource],
  positionsValue: positions,
  projectJson
});
