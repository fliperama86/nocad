import type { ComponentDefinition, ConnectionContract, PinDefinition } from "./types";

export const contracts: Record<string, ConnectionContract> = {
  "builtin:i2c.v1": {
    id: "builtin:i2c.v1",
    signals: {
      sda: { direction: "bidirectional" },
      scl: { direction: "bidirectional" }
    }
  },
  "@nocad/video:hdmi_output.v1": {
    id: "@nocad/video:hdmi_output.v1",
    signals: {
      tmds2_p: { direction: "from_to_to" },
      tmds2_n: { direction: "from_to_to" },
      tmds1_p: { direction: "from_to_to" },
      tmds1_n: { direction: "from_to_to" },
      tmds0_p: { direction: "from_to_to" },
      tmds0_n: { direction: "from_to_to" },
      clock_p: { direction: "from_to_to" },
      clock_n: { direction: "from_to_to" },
      ddc_sda: { direction: "bidirectional" },
      ddc_scl: { direction: "bidirectional" },
      hpd: { direction: "to_to_from" },
      cec: { direction: "bidirectional" }
    }
  }
};

export const components: Record<string, ComponentDefinition> = {
  "@nocad/rp2350:RP2350A": {
    id: "@nocad/rp2350:RP2350A",
    pins: createRp2350Pins(),
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
      },
      video_out: {
        kind: "derived_port",
        contractMaps: {
          "@nocad/video:hdmi_output.v1": {
            role: "from",
            signalMap: {
              tmds2_p: { pinSelector: { capabilities: ["gpio"] } },
              tmds2_n: { pinSelector: { capabilities: ["gpio"] } },
              tmds1_p: { pinSelector: { capabilities: ["gpio"] } },
              tmds1_n: { pinSelector: { capabilities: ["gpio"] } },
              tmds0_p: { pinSelector: { capabilities: ["gpio"] } },
              tmds0_n: { pinSelector: { capabilities: ["gpio"] } },
              clock_p: { pinSelector: { capabilities: ["gpio"] } },
              clock_n: { pinSelector: { capabilities: ["gpio"] } },
              ddc_sda: { pinSelector: { capabilities: ["i2c.sda", "gpio"] } },
              ddc_scl: { pinSelector: { capabilities: ["i2c.scl", "gpio"] } },
              hpd: { pinSelector: { capabilities: ["gpio"] } },
              cec: { pinSelector: { capabilities: ["gpio"] } }
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
  "@nocad/connectors:HDMI_TYPE_A_RECEPTACLE": {
    id: "@nocad/connectors:HDMI_TYPE_A_RECEPTACLE",
    pins: {
      tmds2_p: {
        name: "TMDS Data2+",
        capabilities: ["hdmi.tmds.data2.p"]
      },
      tmds2_n: {
        name: "TMDS Data2-",
        capabilities: ["hdmi.tmds.data2.n"]
      },
      tmds1_p: {
        name: "TMDS Data1+",
        capabilities: ["hdmi.tmds.data1.p"]
      },
      tmds1_n: {
        name: "TMDS Data1-",
        capabilities: ["hdmi.tmds.data1.n"]
      },
      tmds0_p: {
        name: "TMDS Data0+",
        capabilities: ["hdmi.tmds.data0.p"]
      },
      tmds0_n: {
        name: "TMDS Data0-",
        capabilities: ["hdmi.tmds.data0.n"]
      },
      clock_p: {
        name: "TMDS Clock+",
        capabilities: ["hdmi.tmds.clock.p"]
      },
      clock_n: {
        name: "TMDS Clock-",
        capabilities: ["hdmi.tmds.clock.n"]
      },
      cec: {
        name: "CEC",
        capabilities: ["hdmi.cec"]
      },
      ddc_scl: {
        name: "DDC SCL",
        capabilities: ["i2c.scl", "hdmi.ddc.scl"]
      },
      ddc_sda: {
        name: "DDC SDA",
        capabilities: ["i2c.sda", "hdmi.ddc.sda"]
      },
      hpd: {
        name: "Hot Plug Detect",
        capabilities: ["hdmi.hpd"]
      },
      source_5v: {
        name: "+5V Power",
        capabilities: ["power.5v"]
      },
      shield: {
        name: "Shield",
        capabilities: ["chassis"]
      }
    },
    ports: {
      hdmi: {
        kind: "fixed_port",
        contractMaps: {
          "@nocad/video:hdmi_output.v1": {
            role: "to",
            signalMap: {
              tmds2_p: { pin: "tmds2_p" },
              tmds2_n: { pin: "tmds2_n" },
              tmds1_p: { pin: "tmds1_p" },
              tmds1_n: { pin: "tmds1_n" },
              tmds0_p: { pin: "tmds0_p" },
              tmds0_n: { pin: "tmds0_n" },
              clock_p: { pin: "clock_p" },
              clock_n: { pin: "clock_n" },
              ddc_sda: { pin: "ddc_sda" },
              ddc_scl: { pin: "ddc_scl" },
              hpd: { pin: "hpd" },
              cec: { pin: "cec" }
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
  "@nocad/connectors": "0.1.0",
  "@nocad/video": "0.1.0",
  "@nocad/rp2350": "0.1.0",
  "@nocad/sensors": "0.1.0",
  "@nocad/passives": "0.1.0"
};

function createRp2350Pins(): Record<string, PinDefinition> {
  return Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => {
      const capabilities = ["gpio"];

      if (index === 4 || index === 8) {
        capabilities.push("i2c.sda");
      }

      if (index === 5 || index === 9) {
        capabilities.push("i2c.scl");
      }

      if (index >= 12 && index <= 19) {
        capabilities.push("hstx");
      }

      return [
        `gpio${index}`,
        {
          name: `GPIO${index}`,
          capabilities
        }
      ];
    })
  );
}
