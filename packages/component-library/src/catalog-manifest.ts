import type {
  ContractDescriptor,
  FunctionAuthoringDescriptor,
  LibraryDefinitionEntry
} from "./types";

const builtinPackage = {
  contentHash: "sha256:0f3983902d0d1b19fdaa305ae12f060bda322ed22e6e080455390a9a9f9143fc",
  name: "builtin",
  version: "1.0.0"
} as const;
const ioPackage = {
  contentHash: "sha256:b21c7e3b917e63e84be037c72a2283d9770e6c4aa00ab382bb8fce8791f2f115",
  name: "@nocad/io",
  version: "0.1.0"
} as const;
const videoPackage = {
  contentHash: "sha256:5f085275352be8245345a6f902b07a146604a48b85d48a4c161857add01b4a3b",
  name: "@nocad/video",
  version: "0.1.0"
} as const;

export const builtInContractEntries: readonly LibraryDefinitionEntry<ContractDescriptor>[] = [
  {
    descriptor: {
      definitionHash: "sha256:bdfab262355a894bed3e0c56bfaa0ee00cbd3a1ce5ba20de53207cd18793676d",
      id: "builtin:i2c.v1",
      kind: "contract",
      label: "I2C",
      package: builtinPackage
    },
    load: () => import("./definitions/contracts/builtin/i2c.v1.json")
  },
  {
    descriptor: {
      definitionHash: "sha256:7afb326adb0d087497200f13f0446f64c818b5349ae952374317de742586031a",
      id: "@nocad/io:digital_output.v1",
      kind: "contract",
      label: "Digital output",
      package: ioPackage
    },
    load: () => import("./definitions/contracts/nocad/io/digital-output.v1.json")
  },
  {
    descriptor: {
      definitionHash: "sha256:97f151d8ea5a0ae202a03bc3bd42e92093060d16f986794658b6f85886463e07",
      id: "@nocad/video:hdmi_output.v1",
      kind: "contract",
      label: "HDMI output",
      package: videoPackage
    },
    load: () => import("./definitions/contracts/nocad/video/hdmi-output.v1.json")
  },
  {
    descriptor: {
      definitionHash: "sha256:325fdfed0f8d69d37c694e77bea3ef548f6e1c0b09a9983e5d4ffb1bd7477fcb",
      id: "@nocad/video:pixel_stream.v1",
      kind: "contract",
      label: "Pixel stream",
      package: videoPackage
    },
    load: () => import("./definitions/contracts/nocad/video/pixel-stream.v1.json")
  }
] as const;

export const builtInFunctionEntries: readonly LibraryDefinitionEntry<FunctionAuthoringDescriptor>[] = [
  {
    descriptor: {
      defaultInclude: { cec: false, ddc: true, hpd: true, tmds: true },
      defaultRequirements: { colorDepth: "rgb888", resolution: "640x480@60" },
      definitionHash: "sha256:eae93a9bc8dfb93f71af7ea0e1477e2eb5404d50f987a620b8de5cb4e54b5f10",
      id: "@nocad/video:hdmi_output.v1",
      kind: "function",
      label: "HDMI video output",
      package: videoPackage
    },
    load: () => import("./definitions/functions/nocad/video/hdmi-output.v1.json")
  }
] as const;
