import type { ComponentLibraryEntry } from "./types";

export const builtInComponentEntries: readonly ComponentLibraryEntry[] = [
  {
    descriptor: {
      coverage: "interface",
      definitionHash: "sha256:5535232cfde359243935e445d201af9d2ce5ad2a4cd84d9f3b36e380e9ac75a5",
      description: "RP2350 microcontroller, A variant",
      devicePackage: "QFN-60",
      id: "@nocad/rp2350:RP2350A",
      manufacturer: "Raspberry Pi",
      package: {
        contentHash: "sha256:6eacd58ab58701efd60aff6a9bcf8e5e78189246247384cf3edb21420ada1630",
        name: "@nocad/rp2350",
        version: "0.1.0"
      },
      partNumber: "RP2350A",
      provenance: [
        {
          title: "RP2350 datasheet, Chapter 1 introduction and device family table",
          uri: "reference://pico2-datasheet/ch01_introduction.md#rp2350-family"
        }
      ]
    },
    load: () => import("./definitions/raspberry-pi/rp2350a.json")
  },
  {
    descriptor: {
      coverage: "interface",
      definitionHash: "sha256:93d60fd6923a49e27d1a1b706275a8a6c80a15943f01485d4fc3d57b1c836fd8",
      description: "RP2354 microcontroller, B variant",
      devicePackage: "QFN-80",
      id: "@nocad/rp2350:RP2354B",
      manufacturer: "Raspberry Pi",
      package: {
        contentHash: "sha256:6eacd58ab58701efd60aff6a9bcf8e5e78189246247384cf3edb21420ada1630",
        name: "@nocad/rp2350",
        version: "0.1.0"
      },
      partNumber: "RP2354B",
      provenance: [
        {
          title: "RP2350 datasheet, Chapter 1 introduction and device family table",
          uri: "reference://pico2-datasheet/ch01_introduction.md#rp2350-family"
        }
      ]
    },
    load: () => import("./definitions/raspberry-pi/rp2354b.json")
  },
  {
    descriptor: {
      coverage: "interface",
      definitionHash: "sha256:544a5927c31111136239acdbd9b55ad6dfba8d0b2175768fa57ac67258a7d38d",
      description: "High-performance HDMI transmitter",
      id: "@nocad/hdmi-tx:IT66121",
      manufacturer: "ITE Tech.",
      package: {
        contentHash: "sha256:8e0c19de3be194c28cb287369b1b03e4f02156afb021fc18cde17255d8bb99e6",
        name: "@nocad/hdmi-tx",
        version: "0.1.0"
      },
      partNumber: "IT66121"
    },
    load: () => import("./definitions/ite/it66121.json")
  },
  {
    descriptor: {
      coverage: "interface",
      definitionHash: "sha256:7ceea9ee71400776aeff00244a3b77d82cefe81366c6fac1656bbfc49b5baa0b",
      description: "High-speed 14-position board connector",
      id: "@nocad/connectors:TE_1-1734839-4",
      manufacturer: "TE Connectivity",
      package: {
        contentHash: "sha256:63621d4a85638b3fb0bb3b9b221320716c71b29f1b3298453a63e6f602f03d75",
        name: "@nocad/connectors",
        version: "0.1.0"
      },
      partNumber: "1-1734839-4"
    },
    load: () => import("./definitions/te-connectivity/1-1734839-4.json")
  }
] as const;
