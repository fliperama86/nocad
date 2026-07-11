import type { ComponentDefinition, ConnectionContract, FunctionDefinition, PinDefinition, SignalPinMap } from "./types";

const PIXEL_STREAM_CONTRACT = "@nocad/video:pixel_stream.v1";
const DIGITAL_OUTPUT_CONTRACT = "@nocad/io:digital_output.v1";
const BIASED_SIGNAL_CONTRACT = "@nocad/io:biased_signal.v1";
const pixelStreamSignals = createPixelStreamSignals();

export const contracts: Record<string, ConnectionContract> = {
  "builtin:i2c.v1": {
    id: "builtin:i2c.v1",
    label: "I2C",
    netNamePrefix: "I2C",
    signals: {
      sda: { direction: "bidirectional" },
      scl: { direction: "bidirectional" }
    },
    topologyRules: [
      {
        component: "@nocad/passives:RESISTOR",
        dependency: "@nocad/passives",
        diagnostics: {
          missingRail: {
            code: "MISSING_POWER_DOMAIN",
            message: "I2C pullups require a 3.3V power domain."
          }
        },
        generatedIdPrefix: "pullup",
        id: "pullups",
        include: "pullups",
        kind: "shuntToPower",
        rail: { role: "power_3v3", voltage: "3.3V" },
        signals: ["sda", "scl"],
        value: "4.7k"
      }
    ]
  },
  "@nocad/video:hdmi_output.v1": {
    id: "@nocad/video:hdmi_output.v1",
    label: "HDMI output",
    netNamePrefix: "HDMI",
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
  },
  [PIXEL_STREAM_CONTRACT]: {
    id: PIXEL_STREAM_CONTRACT,
    label: "Pixel stream",
    netNamePrefix: "PIXEL",
    params: {
      transport: {
        kind: "enum",
        label: "Transport",
        default: "parallel_rgb",
        options: [{ label: "Parallel RGB", value: "parallel_rgb" }]
      },
      redBits: {
        kind: "integer",
        label: "Red bits",
        default: 8,
        options: [
          { label: "3", value: 3 },
          { label: "5", value: 5 },
          { label: "6", value: 6 },
          { label: "8", value: 8 }
        ]
      },
      greenBits: {
        kind: "integer",
        label: "Green bits",
        default: 8,
        options: [
          { label: "3", value: 3 },
          { label: "5", value: 5 },
          { label: "6", value: 6 },
          { label: "8", value: 8 }
        ]
      },
      blueBits: {
        kind: "integer",
        label: "Blue bits",
        default: 8,
        options: [
          { label: "2", value: 2 },
          { label: "5", value: 5 },
          { label: "6", value: 6 },
          { label: "8", value: 8 }
        ]
      },
      hsync: {
        kind: "boolean",
        label: "HSYNC",
        default: true
      },
      vsync: {
        kind: "boolean",
        label: "VSYNC",
        default: true
      },
      de: {
        kind: "boolean",
        label: "Data enable",
        default: true
      }
    },
    presets: [
      { label: "RGB332", value: "rgb332", params: { redBits: 3, greenBits: 3, blueBits: 2 } },
      { label: "RGB565", value: "rgb565", params: { redBits: 5, greenBits: 6, blueBits: 5 } },
      { label: "RGB666", value: "rgb666", params: { redBits: 6, greenBits: 6, blueBits: 6 } },
      { label: "RGB888", value: "rgb888", params: { redBits: 8, greenBits: 8, blueBits: 8 } }
    ],
    signalPlan: [
      { kind: "fixed", signals: ["pclk"] },
      { kind: "conditional", param: "hsync", signal: "hsync" },
      { kind: "conditional", param: "vsync", signal: "vsync" },
      { kind: "conditional", param: "de", signal: "de" },
      { kind: "bus", prefix: "r", widthParam: "redBits", maxWidth: 8 },
      { kind: "bus", prefix: "g", widthParam: "greenBits", maxWidth: 8 },
      { kind: "bus", prefix: "b", widthParam: "blueBits", maxWidth: 8 }
    ],
    signals: pixelStreamSignals
  },
  "builtin:dpi.v1": {
    id: "builtin:dpi.v1",
    label: "DPI",
    netNamePrefix: "PIXEL",
    signals: pixelStreamSignals
  },
  [DIGITAL_OUTPUT_CONTRACT]: {
    id: DIGITAL_OUTPUT_CONTRACT,
    label: "Digital output",
    netNamePrefix: "DIGITAL",
    signals: {
      signal: { direction: "from_to_to" }
    }
  },
  [BIASED_SIGNAL_CONTRACT]: {
    id: BIASED_SIGNAL_CONTRACT,
    label: "Biased signal",
    netNamePrefix: "BIASED",
    signals: {
      signal: { direction: "from_to_to" }
    },
    topologyRules: [
      {
        component: "@nocad/passives:RESISTOR",
        dependency: "@nocad/passives",
        diagnostics: {
          missingRail: {
            code: "MISSING_BIAS_POWER_DOMAIN",
            message: "The biased signal requires a 3.3V power domain."
          }
        },
        generatedIdPrefix: "bias",
        id: "bias",
        include: "bias",
        kind: "shuntToPower",
        rail: { role: "power_3v3", voltage: "3.3V" },
        signals: ["signal"],
        value: "10k"
      }
    ]
  }
};

export const functions: Record<string, FunctionDefinition> = {
  "@nocad/video:hdmi_output.v1": {
    id: "@nocad/video:hdmi_output.v1",
    include: {
      tmds: {
        kind: "boolean",
        label: "TMDS",
        default: true,
        readonly: true
      },
      ddc: {
        kind: "boolean",
        label: "DDC",
        default: true
      },
      hpd: {
        kind: "boolean",
        label: "HPD",
        default: true
      },
      cec: {
        kind: "boolean",
        label: "CEC",
        default: false
      },
      source5v: {
        kind: "boolean",
        label: "5V source",
        default: true
      },
      seriesTermination: {
        kind: "object",
        label: "Series termination",
        fields: {
          mode: {
            kind: "enum",
            label: "Mode",
            default: "auto",
            options: [
              { label: "Off", value: "off" },
              { label: "Auto", value: "auto" },
              { label: "Required", value: "required" }
            ]
          },
          value: {
            kind: "resistance",
            label: "Value",
            default: "270ohm"
          }
        }
      },
      esdProtection: {
        kind: "enum",
        label: "ESD protection",
        default: "recommended",
        options: [
          { label: "Off", value: "off" },
          { label: "Recommended", value: "recommended" },
          { label: "Required", value: "required" }
        ]
      }
    },
    signalGroups: [
      {
        id: "tmds",
        include: "tmds",
        label: "TMDS",
        signals: [
          { id: "tmds2_p", label: "D2+", pinControl: "custom_only" },
          { id: "tmds2_n", label: "D2-", pinControl: "custom_only" },
          { id: "tmds1_p", label: "D1+", pinControl: "custom_only" },
          { id: "tmds1_n", label: "D1-", pinControl: "custom_only" },
          { id: "tmds0_p", label: "D0+", pinControl: "custom_only" },
          { id: "tmds0_n", label: "D0-", pinControl: "custom_only" },
          { id: "clock_p", label: "CLK+", pinControl: "custom_only" },
          { id: "clock_n", label: "CLK-", pinControl: "custom_only" }
        ]
      },
      {
        id: "ddc",
        include: "ddc",
        label: "DDC",
        signals: [
          { id: "ddc_sda", label: "SDA", pinControl: "always" },
          { id: "ddc_scl", label: "SCL", pinControl: "always" }
        ]
      },
      {
        id: "hpd",
        include: "hpd",
        label: "HPD",
        signals: [{ id: "hpd", label: "HPD", pinControl: "always" }]
      },
      {
        id: "cec",
        include: "cec",
        label: "CEC",
        signals: [{ id: "cec", label: "CEC", pinControl: "always" }]
      }
    ],
    topology: {
      contract: "@nocad/video:hdmi_output.v1",
      generatedNets: [
        {
          diagnostics: {
            missingFrom: {
              code: "MISSING_HDMI_5V_POWER",
              message: "HDMI source power requires a 5V power domain."
            },
            missingTo: {
              code: "PORT_CONTRACT_MISMATCH",
              message: "The exposed HDMI component does not provide its configured +5V pin."
            }
          },
          direction: "from_to_to",
          from: { kind: "powerDomain", role: "power_5v", voltage: "5V" },
          id: "source5v",
          include: "source5v",
          name: "HDMI_5V",
          to: { kind: "exposedPin", pin: "source_5v" }
        }
      ]
    }
  },
  [DIGITAL_OUTPUT_CONTRACT]: {
    id: DIGITAL_OUTPUT_CONTRACT,
    include: {},
    signalGroups: [
      {
        id: "digital",
        label: "Digital output",
        signals: [{ id: "signal", label: "Signal", pinControl: "always" }]
      }
    ],
    topology: {
      contract: DIGITAL_OUTPUT_CONTRACT
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
      dpi_out: {
        kind: "derived_port",
        contractMaps: {
          [PIXEL_STREAM_CONTRACT]: {
            role: "from",
            signalMap: createSelectableSignalMap(Object.keys(contracts[PIXEL_STREAM_CONTRACT].signals), ["gpio"])
          }
        }
      },
      video_out: {
        kind: "derived_port",
        provides: {
          "@nocad/video:hdmi_output.v1": {
            role: "provider",
            modes: {
              auto: {
                label: "Auto",
                signalMap: createRp2350HdmiSignalMap()
              },
              hstx: {
                label: "HSTX",
                signalMap: createRp2350HdmiSignalMap()
              },
              pio_gpio: {
                label: "PIO GPIO",
                signalMap: createRp2350HdmiSignalMap()
              },
              custom_gpio: {
                label: "Custom GPIO",
                signalMap: createRp2350HdmiCustomSignalMap()
              }
            }
          }
        }
      },
      digital_out: {
        kind: "derived_port",
        provides: {
          [DIGITAL_OUTPUT_CONTRACT]: {
            role: "provider",
            modes: {
              auto: {
                label: "Auto",
                signalMap: {
                  signal: { pinSelector: { capabilities: ["gpio"] } }
                }
              }
            }
          }
        }
      },
      biased_out: {
        kind: "derived_port",
        contractMaps: {
          [BIASED_SIGNAL_CONTRACT]: {
            role: "from",
            signalMap: {
              signal: { pinSelector: { capabilities: ["gpio"] } }
            }
          }
        }
      }
    },
    preferredPinGroups: [
      { contract: "builtin:i2c.v1", pins: { sda: "gpio4", scl: "gpio5" } },
      { contract: "builtin:i2c.v1", pins: { sda: "gpio8", scl: "gpio9" } },
      { contract: BIASED_SIGNAL_CONTRACT, pins: { signal: "gpio10" } }
    ]
  },
  "@nocad/fpga:GENERIC_FPGA": {
    id: "@nocad/fpga:GENERIC_FPGA",
    pins: createGenericFpgaPins(),
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
      dpi_out: {
        kind: "derived_port",
        contractMaps: {
          [PIXEL_STREAM_CONTRACT]: {
            role: "from",
            signalMap: createSelectableSignalMap(Object.keys(contracts[PIXEL_STREAM_CONTRACT].signals), ["gpio"])
          }
        }
      }
    },
    preferredPinGroups: [
      { contract: "builtin:i2c.v1", pins: { sda: "io60", scl: "io61" } }
    ]
  },
  "@nocad/hdmi-tx:IT66121": {
    id: "@nocad/hdmi-tx:IT66121",
    pins: {
      ...createFixedPins(Object.keys(contracts[PIXEL_STREAM_CONTRACT].signals), "PIXEL"),
      ctrl_sda: {
        name: "Control SDA",
        capabilities: ["i2c.sda"]
      },
      ctrl_scl: {
        name: "Control SCL",
        capabilities: ["i2c.scl"]
      },
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
      ddc_sda: {
        name: "DDC SDA",
        capabilities: ["i2c.sda", "hdmi.ddc.sda"]
      },
      ddc_scl: {
        name: "DDC SCL",
        capabilities: ["i2c.scl", "hdmi.ddc.scl"]
      },
      hpd: {
        name: "Hot Plug Detect",
        capabilities: ["hdmi.hpd"]
      },
      cec: {
        name: "CEC",
        capabilities: ["hdmi.cec"]
      }
    },
    ports: {
      video_in: {
        kind: "fixed_port",
        contractMaps: {
          [PIXEL_STREAM_CONTRACT]: {
            role: "to",
            signalMap: createFixedSignalMap(Object.keys(contracts[PIXEL_STREAM_CONTRACT].signals))
          }
        }
      },
      ctrl: {
        kind: "fixed_port",
        contractMaps: {
          "builtin:i2c.v1": {
            role: "to",
            signalMap: {
              sda: { pin: "ctrl_sda" },
              scl: { pin: "ctrl_scl" }
            }
          }
        }
      },
      hdmi_tx: {
        kind: "fixed_port",
        provides: {
          "@nocad/video:hdmi_output.v1": {
            role: "provider",
            modes: {
              hdmi_1v4: {
                label: "HDMI 1.4",
                requires: {
                  ports: {
                    video_in: {
                      contract: PIXEL_STREAM_CONTRACT
                    },
                    ctrl: {
                      contract: "builtin:i2c.v1"
                    }
                  }
                },
                signalMap: createFixedSignalMap(Object.keys(contracts["@nocad/video:hdmi_output.v1"].signals))
              }
            }
          }
        }
      }
    }
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
  },
  "@nocad/io:LED": {
    id: "@nocad/io:LED",
    pins: {
      anode: {
        name: "Anode",
        capabilities: ["digital.input"]
      },
      cathode: {
        name: "Cathode",
        capabilities: ["power.ground"]
      }
    },
    ports: {
      input: {
        kind: "fixed_port",
        contractMaps: {
          [DIGITAL_OUTPUT_CONTRACT]: {
            role: "to",
            signalMap: {
              signal: { pin: "anode" }
            }
          }
        }
      },
      biased_input: {
        kind: "fixed_port",
        contractMaps: {
          [BIASED_SIGNAL_CONTRACT]: {
            role: "to",
            signalMap: {
              signal: { pin: "anode" }
            }
          }
        }
      }
    }
  }
};

export const packageVersions: Record<string, string> = {
  "@nocad/connectors": "0.1.0",
  "@nocad/fpga": "0.1.0",
  "@nocad/hdmi-tx": "0.1.0",
  "@nocad/io": "0.1.0",
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

function createGenericFpgaPins(): Record<string, PinDefinition> {
  return Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => {
      const capabilities = ["gpio"];

      if (index === 60 || index === 62) {
        capabilities.push("i2c.sda");
      }

      if (index === 61 || index === 63) {
        capabilities.push("i2c.scl");
      }

      return [
        `io${index}`,
        {
          name: `IO${index}`,
          capabilities
        }
      ];
    })
  );
}

function createPixelStreamSignals(): ConnectionContract["signals"] {
  return Object.fromEntries(
    [
      "pclk",
      "hsync",
      "vsync",
      "de",
      ...Array.from({ length: 8 }, (_, index) => `r${index}`),
      ...Array.from({ length: 8 }, (_, index) => `g${index}`),
      ...Array.from({ length: 8 }, (_, index) => `b${index}`)
    ].map((signal) => [signal, { direction: "from_to_to" }])
  );
}

function createRp2350HdmiSignalMap(): Record<string, SignalPinMap> {
  return {
    clock_n: { pin: "gpio19" },
    clock_p: { pin: "gpio18" },
    tmds0_n: { pin: "gpio17" },
    tmds0_p: { pin: "gpio16" },
    tmds1_n: { pin: "gpio15" },
    tmds1_p: { pin: "gpio14" },
    tmds2_n: { pin: "gpio13" },
    tmds2_p: { pin: "gpio12" },
    ddc_sda: { pinSelector: { capabilities: ["i2c.sda", "gpio"] } },
    ddc_scl: { pinSelector: { capabilities: ["i2c.scl", "gpio"] } },
    hpd: { pinSelector: { capabilities: ["gpio"] } },
    cec: { pinSelector: { capabilities: ["gpio"] } }
  };
}

function createRp2350HdmiCustomSignalMap(): Record<string, SignalPinMap> {
  return createSelectableSignalMap(Object.keys(contracts["@nocad/video:hdmi_output.v1"].signals), ["gpio"]);
}

function createSelectableSignalMap(signals: string[], capabilities: string[]): Record<string, SignalPinMap> {
  return Object.fromEntries(signals.map((signal) => [signal, { pinSelector: { capabilities } }]));
}

function createFixedSignalMap(signals: string[]): Record<string, SignalPinMap> {
  return Object.fromEntries(signals.map((signal) => [signal, { pin: signal }]));
}

function createFixedPins(signals: string[], prefix: string): Record<string, PinDefinition> {
  return Object.fromEntries(
    signals.map((signal) => [
      signal,
      {
        name: `${prefix} ${signal.toUpperCase()}`,
        capabilities: [signal]
      }
    ])
  );
}
