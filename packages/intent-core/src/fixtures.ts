import type { ComponentDefinition, ConnectionContract } from "./types";

export const contracts: Record<string, ConnectionContract> = {
  "builtin:i2c.v1": {
    id: "builtin:i2c.v1",
    signals: {
      sda: { direction: "bidirectional" },
      scl: { direction: "bidirectional" }
    }
  }
};

export const components: Record<string, ComponentDefinition> = {
  "@nocad/rp2350:RP2350A": {
    id: "@nocad/rp2350:RP2350A",
    pins: {
      gpio4: {
        name: "GPIO4",
        capabilities: ["gpio", "i2c.sda"]
      },
      gpio5: {
        name: "GPIO5",
        capabilities: ["gpio", "i2c.scl"]
      },
      gpio8: {
        name: "GPIO8",
        capabilities: ["gpio", "i2c.sda"]
      },
      gpio9: {
        name: "GPIO9",
        capabilities: ["gpio", "i2c.scl"]
      }
    },
    ports: {
      i2c: {
        kind: "derived_port",
        contractMaps: {
          "builtin:i2c.v1": {
            role: "from",
            signalMap: {
              sda: { pinSelector: { capabilities: ["i2c.sda", "gpio"] } },
              scl: { pinSelector: { capabilities: ["i2c.scl", "gpio"] } }
            }
          }
        }
      }
    },
    preferredI2cPairs: [
      { sda: "gpio4", scl: "gpio5" },
      { sda: "gpio8", scl: "gpio9" }
    ]
  },
  "@nocad/sensors:I2C_TEMP_SENSOR": {
    id: "@nocad/sensors:I2C_TEMP_SENSOR",
    pins: {
      sda: {
        name: "SDA",
        capabilities: ["i2c.sda"]
      },
      scl: {
        name: "SCL",
        capabilities: ["i2c.scl"]
      }
    },
    ports: {
      i2c: {
        kind: "fixed_port",
        contractMaps: {
          "builtin:i2c.v1": {
            role: "to",
            signalMap: {
              sda: { pin: "sda" },
              scl: { pin: "scl" }
            }
          }
        }
      }
    }
  },
  "@nocad/passives:RESISTOR": {
    id: "@nocad/passives:RESISTOR",
    pins: {
      "1": {
        name: "1",
        capabilities: ["passive.terminal"]
      },
      "2": {
        name: "2",
        capabilities: ["passive.terminal"]
      }
    },
    ports: {}
  }
};

export const packageVersions: Record<string, string> = {
  "@nocad/rp2350": "0.1.0",
  "@nocad/sensors": "0.1.0",
  "@nocad/passives": "0.1.0"
};
