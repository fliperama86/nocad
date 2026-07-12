import type { ComponentDefinition, ConnectionContract, FunctionDefinition, PinDefinition, SignalPinMap } from "./types";

const PIXEL_STREAM_CONTRACT = "@nocad/video:pixel_stream.v1";
const DIGITAL_OUTPUT_CONTRACT = "@nocad/io:digital_output.v1";
const BIASED_SIGNAL_CONTRACT = "@nocad/io:biased_signal.v1";
const pixelStreamSignals = createPixelStreamSignals();
const hdmiSignalIds = [
  "tmds2_p",
  "tmds2_n",
  "tmds1_p",
  "tmds1_n",
  "tmds0_p",
  "tmds0_n",
  "clock_p",
  "clock_n",
  "ddc_sda",
  "ddc_scl",
  "hpd",
  "cec"
];
const rp2350HstxSignalMap: Record<string, SignalPinMap> = {
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
const rp2354bCustomHdmiSignalMap: Record<string, SignalPinMap> = Object.fromEntries(
  hdmiSignalIds.map((signal) => [
    signal,
    {
      pinSelector: {
        capabilities:
          signal.startsWith("tmds") || signal.startsWith("clock")
            ? ["hstx", "gpio"]
            : signal === "ddc_sda"
              ? ["i2c.sda", "gpio"]
              : signal === "ddc_scl"
                ? ["i2c.scl", "gpio"]
                : ["gpio"]
      }
    }
  ])
);

export const contracts: Record<string, ConnectionContract> = {
  "builtin:i2c.v1": {
    defaultRole: "control_bus",
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
    defaultRole: "video_output",
    dependency: { name: "@nocad/video", version: "0.1.0" },
    id: "@nocad/video:hdmi_output.v1",
    label: "HDMI output",
    netNamePrefix: "HDMI",
    signals: {
      tmds2_p: { boardKind: "highSpeed", direction: "from_to_to" },
      tmds2_n: { boardKind: "highSpeed", direction: "from_to_to" },
      tmds1_p: { boardKind: "highSpeed", direction: "from_to_to" },
      tmds1_n: { boardKind: "highSpeed", direction: "from_to_to" },
      tmds0_p: { boardKind: "highSpeed", direction: "from_to_to" },
      tmds0_n: { boardKind: "highSpeed", direction: "from_to_to" },
      clock_p: { boardKind: "highSpeed", direction: "from_to_to" },
      clock_n: { boardKind: "highSpeed", direction: "from_to_to" },
      ddc_sda: { direction: "bidirectional" },
      ddc_scl: { direction: "bidirectional" },
      hpd: { direction: "to_to_from" },
      cec: { direction: "bidirectional" }
    }
  },
  [PIXEL_STREAM_CONTRACT]: {
    defaultRole: "video_stream",
    dependency: { name: "@nocad/video", version: "0.1.0" },
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
    defaultRole: "video_stream",
    id: "builtin:dpi.v1",
    label: "DPI",
    netNamePrefix: "PIXEL",
    signals: pixelStreamSignals
  },
  [DIGITAL_OUTPUT_CONTRACT]: {
    defaultRole: "digital_output",
    dependency: { name: "@nocad/io", version: "0.1.0" },
    id: DIGITAL_OUTPUT_CONTRACT,
    label: "Digital output",
    netNamePrefix: "DIGITAL",
    signals: {
      signal: { direction: "from_to_to" }
    }
  },
  [BIASED_SIGNAL_CONTRACT]: {
    defaultRole: "biased_signal",
    dependency: { name: "@nocad/io", version: "0.1.0" },
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
    dependency: { name: "@nocad/video", version: "0.1.0" },
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
      genericProvider: {
        label: "Generic GPIO",
        modeId: "generic_gpio",
        pinCapabilities: ["gpio"]
      },
      inlineRules: [
        {
          component: "@nocad/passives:RESISTOR",
          dependency: "@nocad/passives",
          enabledWhen: { field: "mode", values: ["auto", "required"] },
          generatedIdPrefix: "series",
          id: "seriesTermination",
          include: "seriesTermination",
          kind: "seriesInterposer",
          pins: { provider: "1", connector: "2" },
          placement: { near: "provider" },
          signals: { group: "tmds" },
          value: { default: "270ohm", includeField: "value" }
        }
      ],
      generatedNets: [
        {
          boardKind: "power",
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
    dependency: { name: "@nocad/io", version: "0.1.0" },
    id: DIGITAL_OUTPUT_CONTRACT,
    include: {
      seriesProtection: {
        kind: "object",
        label: "Series protection",
        fields: {
          mode: {
            kind: "enum",
            label: "Mode",
            default: "off",
            options: [
              { label: "Off", value: "off" },
              { label: "Auto", value: "auto" },
              { label: "Required", value: "required" }
            ]
          },
          value: {
            kind: "resistance",
            label: "Value",
            default: "33ohm"
          }
        }
      }
    },
    signalGroups: [
      {
        id: "digital",
        label: "Digital output",
        signals: [{ id: "signal", label: "Signal", pinControl: "always" }]
      }
    ],
    topology: {
      contract: DIGITAL_OUTPUT_CONTRACT,
      inlineRules: [
        {
          component: "@nocad/passives:RESISTOR",
          dependency: "@nocad/passives",
          enabledWhen: { field: "mode", values: ["auto", "required"] },
          generatedIdPrefix: "series",
          id: "seriesProtection",
          include: "seriesProtection",
          kind: "seriesInterposer",
          pins: { provider: "1", connector: "2" },
          placement: { near: "provider" },
          signals: { group: "digital" },
          value: { default: "33ohm", includeField: "value" }
        }
      ]
    }
  }
};

export const components: Record<string, ComponentDefinition> = {
  "@nocad/rp2350:RP2350A": {
    board: {
      envelope: { accuracy: "estimate", widthMm: 7, heightMm: 7 }
    },
    id: "@nocad/rp2350:RP2350A",
    pins: createIndexedPins({
      count: 30,
      idPrefix: "gpio",
      labelPrefix: "GPIO",
      capabilityRules: [
        { capabilities: ["i2c.sda"], indices: [4, 8] },
        { capabilities: ["i2c.scl"], indices: [5, 9] },
        { capabilities: ["hstx"], indices: [12, 13, 14, 15, 16, 17, 18, 19] }
      ]
    }),
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
                signalMap: rp2350HstxSignalMap
              },
              hstx: {
                label: "HSTX",
                signalMap: rp2350HstxSignalMap
              },
              pio_gpio: {
                label: "PIO GPIO",
                signalMap: rp2350HstxSignalMap
              },
              custom_gpio: {
                label: "Custom GPIO",
                presets: [
                  {
                    id: "gpio12_19",
                    label: "GPIO12-19",
                    pins: {
                      tmds2_p: "gpio12",
                      tmds2_n: "gpio13",
                      tmds1_p: "gpio14",
                      tmds1_n: "gpio15",
                      tmds0_p: "gpio16",
                      tmds0_n: "gpio17",
                      clock_p: "gpio18",
                      clock_n: "gpio19"
                    }
                  }
                ],
                signalMap: createSelectableSignalMap(hdmiSignalIds, ["gpio"])
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
      {
        contract: "builtin:i2c.v1",
        pins: { sda: "gpio4", scl: "gpio5" },
        port: "i2c",
        suggestion: { title: "Move I2C to GPIO4/GPIO5" }
      },
      {
        contract: "builtin:i2c.v1",
        pins: { sda: "gpio8", scl: "gpio9" },
        port: "i2c",
        suggestion: { title: "Move I2C to GPIO8/GPIO9" }
      },
      {
        contract: BIASED_SIGNAL_CONTRACT,
        pins: { signal: "gpio10" },
        port: "biased_out",
        suggestion: { title: "Move biased signal to GPIO10" }
      }
    ]
  },
  "@nocad/rp2350:RP2354B": {
    board: {
      envelope: { accuracy: "estimate", widthMm: 10, heightMm: 10 }
    },
    id: "@nocad/rp2350:RP2354B",
    pins: createIndexedPins({
      count: 48,
      idPrefix: "gpio",
      labelPrefix: "GPIO",
      capabilityRules: [
        { capabilities: ["i2c.sda"], indices: [8] },
        { capabilities: ["i2c.scl"], indices: [9] },
        { capabilities: ["hstx"], indices: [12, 13, 14, 15, 16, 17, 18, 19] }
      ]
    }),
    ports: {
      video_out: {
        kind: "derived_port",
        provides: {
          "@nocad/video:hdmi_output.v1": {
            role: "provider",
            modes: {
              custom_gpio: {
                label: "Custom GPIO",
                presets: [
                  {
                    id: "gpio12_19",
                    label: "GPIO12-19",
                    pins: {
                      tmds2_p: "gpio12",
                      tmds2_n: "gpio13",
                      tmds1_p: "gpio14",
                      tmds1_n: "gpio15",
                      tmds0_p: "gpio16",
                      tmds0_n: "gpio17",
                      clock_p: "gpio18",
                      clock_n: "gpio19"
                    }
                  }
                ],
                signalMap: rp2354bCustomHdmiSignalMap
              }
            }
          }
        }
      }
    }
  },
  "@nocad/fpga:GENERIC_FPGA": {
    board: {
      envelope: { accuracy: "estimate", widthMm: 16, heightMm: 16 }
    },
    id: "@nocad/fpga:GENERIC_FPGA",
    pins: createIndexedPins({
      count: 64,
      idPrefix: "io",
      labelPrefix: "IO",
      capabilityRules: [
        { capabilities: ["i2c.sda"], indices: [60, 62] },
        { capabilities: ["i2c.scl"], indices: [61, 63] }
      ]
    }),
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
      gpio: {
        kind: "pin_pool",
        pinCapabilities: ["gpio"]
      }
    },
    preferredPinGroups: [
      {
        contract: "builtin:i2c.v1",
        pins: { sda: "io60", scl: "io61" },
        port: "i2c",
        suggestion: { title: "Move I2C to IO60/IO61" }
      }
    ]
  },
  "@nocad/hdmi-tx:IT66121": {
    board: {
      envelope: { accuracy: "estimate", widthMm: 9, heightMm: 9 }
    },
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
                      contract: PIXEL_STREAM_CONTRACT,
                      label: "Video In"
                    },
                    ctrl: {
                      contract: "builtin:i2c.v1",
                      label: "I2C Control"
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
    board: {
      envelope: { accuracy: "estimate", widthMm: 3, heightMm: 3 }
    },
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
    board: {
      envelope: { accuracy: "estimate", widthMm: 14, heightMm: 12 }
    },
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
  "@nocad/connectors:TE_1-1734839-4": {
    board: {
      envelope: { accuracy: "estimate", widthMm: 14, heightMm: 12 }
    },
    id: "@nocad/connectors:TE_1-1734839-4",
    pins: {
      source_5v: { name: "Pin 1 / HDMI 5V", capabilities: ["power.5v"] },
      hpd: { name: "Pin 2 / HPD candidate", capabilities: ["hdmi.hpd"] },
      ground: { name: "Pin 3 / Ground", capabilities: ["power.ground"] },
      ddc_sda: { name: "Pin 4 / DDC SDA", capabilities: ["i2c.sda", "hdmi.ddc.sda"] },
      ddc_scl: { name: "Pin 5 / DDC SCL", capabilities: ["i2c.scl", "hdmi.ddc.scl"] },
      cec: { name: "Pin 6 / CEC", capabilities: ["hdmi.cec"] },
      clock_n: { name: "Pin 7 / TMDS Clock-", capabilities: ["hdmi.tmds.clock.n"] },
      clock_p: { name: "Pin 8 / TMDS Clock+", capabilities: ["hdmi.tmds.clock.p"] },
      tmds0_n: { name: "Pin 9 / TMDS Data0-", capabilities: ["hdmi.tmds.data0.n"] },
      tmds0_p: { name: "Pin 10 / TMDS Data0+", capabilities: ["hdmi.tmds.data0.p"] },
      tmds1_n: { name: "Pin 11 / TMDS Data1-", capabilities: ["hdmi.tmds.data1.n"] },
      tmds1_p: { name: "Pin 12 / TMDS Data1+", capabilities: ["hdmi.tmds.data1.p"] },
      tmds2_n: { name: "Pin 13 / TMDS Data2-", capabilities: ["hdmi.tmds.data2.n"] },
      tmds2_p: { name: "Pin 14 / TMDS Data2+", capabilities: ["hdmi.tmds.data2.p"] }
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

function createIndexedPins(options: {
  capabilityRules?: Array<{ capabilities: string[]; indices: number[] }>;
  count: number;
  idPrefix: string;
  labelPrefix: string;
}): Record<string, PinDefinition> {
  return Object.fromEntries(
    Array.from({ length: options.count }, (_, index) => {
      const capabilities = ["gpio"];

      for (const rule of options.capabilityRules ?? []) {
        if (rule.indices.includes(index)) {
          capabilities.push(...rule.capabilities);
        }
      }

      return [
        `${options.idPrefix}${index}`,
        {
          name: `${options.labelPrefix}${index}`,
          capabilities: [...new Set(capabilities)]
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
    ].map((signal) => [signal, { boardKind: "highSpeed", direction: "from_to_to" }])
  );
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
