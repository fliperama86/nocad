import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const failures = [];
const specificBehaviorPatterns = [
  /builtin:i2c/i,
  /@nocad\/video/i,
  /hdmi/i,
  /i2c/i,
  /tmds/i,
  /rp235/i,
  /it661/i,
  /source5v/i,
  /gpio12/i,
  /pullups/i,
  /GENERIC_FPGA/i
];

const engineFiles = (await sourceFiles("packages/intent-core/src")).filter((file) =>
  !file.endsWith(".test.ts") &&
  !["fixture-entry.ts", "fixture-environment.ts", "fixtures.ts", "samples.ts"].includes(path.basename(file))
);
const workspaceFiles = (await sourceFiles("apps/web/src/features/workspace")).filter(
  (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx")
);
const libraryInterpreterFiles = (await sourceFiles("packages/component-library/src")).filter((file) =>
  !file.endsWith(".test.ts") &&
  !file.includes("/definitions/") &&
  !["built-in-manifest.ts", "catalog-manifest.ts"].includes(path.basename(file))
);

await rejectPatterns(engineFiles, specificBehaviorPatterns, "portable engine");
const productionUiFiles = ["apps/web/src/App.tsx", "apps/web/src/catalog-templates.ts", ...workspaceFiles];

await rejectPatterns(productionUiFiles, specificBehaviorPatterns, "production workspace");
await rejectPatterns(libraryInterpreterFiles, specificBehaviorPatterns, "definition-library interpreter");
await rejectPatterns(
  await sourceFiles("packages/component-library/src"),
  [/with\s*:\s*\{\s*type\s*:\s*["']json["']/],
  "Vite dynamic JSON imports"
);
await rejectPatterns(
  await sourceFiles("packages/component-library/src/definitions"),
  [/GENERIC_FPGA/i, /I2C_TEMP_SENSOR/i, /HDMI_TYPE_A_RECEPTACLE/i, /@nocad\/passives:RESISTOR/i, /@nocad\/io:LED/i],
  "production component definitions"
);

await rejectPatterns(
  productionUiFiles,
  [/@nocad\/intent-core\/fixtures/, /(?:^|["'])\.\.\/.*demos\//m, /kicad-fixture/i],
  "production UI import boundary"
);

const rootEntry = await read("packages/intent-core/src/index.ts");
if (/fixtures|samples|fixture-entry|fixture-environment/.test(rootEntry)) {
  failures.push("intent-core root entrypoint exposes fixture or sample data");
}

if (failures.length > 0) {
  console.error("General boundary verification failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  `General boundaries verified across ${engineFiles.length} engine, ${workspaceFiles.length} workspace, and ${libraryInterpreterFiles.length} library interpreter files.`
);

async function rejectPatterns(files, patterns, boundary) {
  for (const file of files) {
    const content = await read(file);
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        failures.push(`${boundary}: ${file} matches ${pattern}`);
      }
    }
  }
}

async function sourceFiles(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(?:json|ts|tsx)$/.test(entry.name) ? [relative] : [];
  }));
  return files.flat();
}

async function read(file) {
  return readFile(path.join(root, file), "utf8");
}
