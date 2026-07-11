import type { ProjectSource } from "./types";

export const i2cSliceIds = {
  debugGpio: "edge_1f7596a2-8ee5-4f44-8b55-479597a1e602",
  mcu: "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12",
  rail3v3: "node_77e9d1da-e4da-45d5-b60f-3bb8d41f63f1",
  sensor: "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb",
  sensorBus: "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65"
} as const;

export const hdmiSliceIds = {
  hdmiConnector: "edge_d3ca6fb1-1af0-4d9e-b44c-3028a11f693a",
  hdmiFunction: "node_64d3015a-b0d0-48d7-993c-82de06745b65",
  hdmiPort: "node_799c5368-fb8d-44c1-83f3-c98d5e73e8d4",
  mcu: "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12",
  rail5v: "node_9e42e934-42f4-4c9f-b3de-fdd097d43ef8",
  videoProvider: "edge_fef00f36-d6ba-472f-b798-98bce467254e"
} as const;

export const hdmiTxSliceIds = {
  ctrlConnection: "edge_9f3a940e-189e-474a-a4df-10b4e0bb2310",
  dpiConnection: "edge_2b41aa5b-5792-464d-a4b5-d228f2f65b4d",
  hdmiConnector: "edge_6843a20a-bd3c-4c88-bae1-4179d2a93173",
  hdmiFunction: "node_2010e02a-c561-488e-9c08-398f8f1f6963",
  hdmiPort: "node_7d8d5a0f-b3e1-46ff-ae46-b2d6839eec9e",
  rail5v: "node_72f72829-6ab9-4bb4-bd66-14b32ad93f9d",
  tx: "node_d99c019a-9926-46f3-b6d4-80e596ae026d",
  txVideoProvider: "edge_63f06869-1f14-4cb0-8b4b-264cf180c065",
  videoSource: "node_11e144aa-909c-4bb4-a5cb-e90d49999b7b"
} as const;

export function createHdmiSliceProject(): ProjectSource {
  return {
    schema: "nocad.project.v0",
    id: "rp2350-hdmi-slice",
    name: "RP2350 HDMI Slice",
    dependencies: {
      "@nocad/connectors": "0.1.0",
      "@nocad/rp2350": "0.1.0",
      "@nocad/video": "0.1.0"
    },
    board: {
      id: "main_board",
      layers: 2,
      size: {
        width: "50mm",
        height: "30mm"
      }
    },
    layout: {
      board: "main_board",
      placements: {},
      routingIntent: []
    },
    nodes: [
      {
        id: hdmiSliceIds.mcu,
        kind: "component",
        label: "Main MCU",
        role: "mcu",
        component: "@nocad/rp2350:RP2350A",
        package: "QFN80",
        refdesHint: "U?"
      },
      {
        id: hdmiSliceIds.hdmiFunction,
        kind: "intent.function",
        label: "HDMI video output",
        role: "video_output",
        function: "@nocad/video:hdmi_output.v1",
        requirements: {
          resolution: "640x480@60",
          colorDepth: "rgb332"
        },
        include: {
          tmds: true,
          ddc: true,
          hpd: true,
          cec: false,
          source5v: true,
          seriesTermination: {
            mode: "auto",
            value: "270ohm"
          },
          esdProtection: "recommended"
        }
      },
      {
        id: hdmiSliceIds.rail5v,
        kind: "powerDomain",
        label: "5V rail",
        role: "power_5v",
        voltage: "5V"
      },
      {
        id: hdmiSliceIds.hdmiPort,
        kind: "component",
        label: "HDMI port",
        role: "hdmi_port",
        component: "@nocad/connectors:HDMI_TYPE_A_RECEPTACLE",
        refdesHint: "J?"
      }
    ],
    edges: [
      {
        id: hdmiSliceIds.videoProvider,
        kind: "intent.provides",
        label: "Video provider",
        role: "video_provider",
        from: {
          node: hdmiSliceIds.mcu,
          port: "video_out"
        },
        to: {
          node: hdmiSliceIds.hdmiFunction,
          port: "source"
        },
        contract: "@nocad/video:hdmi_output.v1",
        strategy: {
          pinAssignment: "auto",
          providerMode: "auto"
        }
      },
      {
        id: hdmiSliceIds.hdmiConnector,
        kind: "intent.exposes",
        label: "HDMI connector",
        role: "video_connector",
        from: {
          node: hdmiSliceIds.hdmiFunction,
          port: "connector"
        },
        to: {
          node: hdmiSliceIds.hdmiPort,
          port: "hdmi"
        },
        contract: "@nocad/video:hdmi_output.v1"
      }
    ]
  };
}

export function createHdmiTxSliceProject(options: { omitCtrl?: boolean; omitVideoIn?: boolean } = {}): ProjectSource {
  return {
    schema: "nocad.project.v0",
    id: "hdmi-tx-provider-chain-slice",
    name: "HDMI TX Provider Chain Slice",
    dependencies: {
      "@nocad/connectors": "0.1.0",
      "@nocad/fpga": "0.1.0",
      "@nocad/hdmi-tx": "0.1.0",
      "@nocad/video": "0.1.0"
    },
    board: {
      id: "main_board",
      layers: 4,
      size: {
        width: "60mm",
        height: "40mm"
      }
    },
    layout: {
      board: "main_board",
      placements: {},
      routingIntent: []
    },
    nodes: [
      {
        id: hdmiTxSliceIds.videoSource,
        kind: "component",
        label: "Video source",
        role: "video_source",
        component: "@nocad/fpga:GENERIC_FPGA",
        package: "BGA",
        refdesHint: "U?"
      },
      {
        id: hdmiTxSliceIds.tx,
        kind: "component",
        label: "HDMI transmitter",
        role: "hdmi_tx",
        component: "@nocad/hdmi-tx:IT66121",
        refdesHint: "U?"
      },
      {
        id: hdmiTxSliceIds.hdmiFunction,
        kind: "intent.function",
        label: "HDMI video output",
        role: "video_output",
        function: "@nocad/video:hdmi_output.v1",
        requirements: {
          resolution: "640x480@60",
          colorDepth: "rgb888"
        },
        include: {
          tmds: true,
          ddc: true,
          hpd: true,
          cec: false,
          source5v: true,
          esdProtection: "recommended"
        }
      },
      {
        id: hdmiTxSliceIds.rail5v,
        kind: "powerDomain",
        label: "5V rail",
        role: "power_5v",
        voltage: "5V"
      },
      {
        id: hdmiTxSliceIds.hdmiPort,
        kind: "component",
        label: "HDMI port",
        role: "hdmi_port",
        component: "@nocad/connectors:HDMI_TYPE_A_RECEPTACLE",
        refdesHint: "J?"
      }
    ],
    edges: [
      ...(options.omitVideoIn
        ? []
        : [
            {
              id: hdmiTxSliceIds.dpiConnection,
              kind: "intent.connection" as const,
              label: "Pixel bus",
              role: "pixel_bus",
              from: {
                node: hdmiTxSliceIds.videoSource,
                port: "dpi_out"
              },
              to: {
                node: hdmiTxSliceIds.tx,
                port: "video_in"
              },
              contract: "@nocad/video:pixel_stream.v1",
              params: {
                transport: "parallel_rgb",
                redBits: 8,
                greenBits: 8,
                blueBits: 8,
                hsync: true,
                vsync: true,
                de: true
              },
              strategy: {
                pinAssignment: "auto" as const
              }
            }
          ]),
      ...(options.omitCtrl
        ? []
        : [
            {
              id: hdmiTxSliceIds.ctrlConnection,
              kind: "intent.connection" as const,
              label: "HDMI TX control bus",
              role: "hdmi_tx_control",
              from: {
                node: hdmiTxSliceIds.videoSource,
                port: "i2c"
              },
              to: {
                node: hdmiTxSliceIds.tx,
                port: "ctrl"
              },
              contract: "builtin:i2c.v1",
              strategy: {
                pinAssignment: "auto" as const
              }
            }
          ]),
      {
        id: hdmiTxSliceIds.txVideoProvider,
        kind: "intent.provides",
        label: "HDMI TX provider",
        role: "video_provider",
        from: {
          node: hdmiTxSliceIds.tx,
          port: "hdmi_tx"
        },
        to: {
          node: hdmiTxSliceIds.hdmiFunction,
          port: "source"
        },
        contract: "@nocad/video:hdmi_output.v1",
        strategy: {
          pinAssignment: "auto",
          providerMode: "hdmi_1v4"
        }
      },
      {
        id: hdmiTxSliceIds.hdmiConnector,
        kind: "intent.exposes",
        label: "HDMI connector",
        role: "video_connector",
        from: {
          node: hdmiTxSliceIds.hdmiFunction,
          port: "connector"
        },
        to: {
          node: hdmiTxSliceIds.hdmiPort,
          port: "hdmi"
        },
        contract: "@nocad/video:hdmi_output.v1"
      }
    ]
  };
}

export function createRp2350HdmiTxSliceProject(
  options: { omitCtrl?: boolean; omitVideoIn?: boolean } = {}
): ProjectSource {
  const source = createHdmiTxSliceProject(options);
  const { "@nocad/fpga": _fpga, ...dependencies } = source.dependencies;

  return {
    ...source,
    id: "rp2350-hdmi-tx-provider-chain-slice",
    name: "RP2350 HDMI TX Provider Chain Slice",
    dependencies: {
      ...dependencies,
      "@nocad/rp2350": "0.1.0"
    },
    nodes: source.nodes.map((node) => {
      if (node.id === hdmiTxSliceIds.videoSource && node.kind === "component") {
        return {
          ...node,
          label: "Main MCU",
          role: "mcu",
          component: "@nocad/rp2350:RP2350A",
          package: "QFN80"
        };
      }

      if (node.id === hdmiTxSliceIds.hdmiFunction && node.kind === "intent.function") {
        return {
          ...node,
          requirements: {
            ...node.requirements,
            colorDepth: "rgb565"
          }
        };
      }

      return node;
    }),
    edges: source.edges.map((edge) =>
      edge.id === hdmiTxSliceIds.dpiConnection && edge.kind === "intent.connection"
        ? {
            ...edge,
            params: {
              ...edge.params,
              redBits: 5,
              greenBits: 6,
              blueBits: 5
            }
          }
        : edge
    )
  };
}

export function createI2cSliceProject(options: { conflict?: boolean } = {}): ProjectSource {
  return {
    schema: "nocad.project.v0",
    id: "rp2350-i2c-slice",
    name: "RP2350 I2C Slice",
    dependencies: {
      "@nocad/rp2350": "0.1.0",
      "@nocad/sensors": "0.1.0"
    },
    board: {
      id: "main_board",
      layers: 2,
      size: {
        width: "50mm",
        height: "30mm"
      }
    },
    layout: {
      board: "main_board",
      placements: {},
      routingIntent: []
    },
    nodes: [
      {
        id: i2cSliceIds.rail3v3,
        kind: "powerDomain",
        label: "3V3 rail",
        role: "power_3v3",
        voltage: "3.3V"
      },
      {
        id: i2cSliceIds.mcu,
        kind: "component",
        label: "Main MCU",
        role: "mcu",
        component: "@nocad/rp2350:RP2350A",
        package: "QFN80",
        refdesHint: "U?"
      },
      {
        id: i2cSliceIds.sensor,
        kind: "component",
        label: "Temperature sensor",
        role: "temperature_sensor",
        component: "@nocad/sensors:I2C_TEMP_SENSOR",
        refdesHint: "U?"
      }
    ],
    edges: [
      ...(options.conflict
        ? [
            {
              id: i2cSliceIds.debugGpio,
              kind: "net.binding" as const,
              label: "Debug GPIO reservation",
              role: "debug_gpio",
              bindings: {
                debug: {
                  from: { node: i2cSliceIds.mcu, pin: "gpio4" }
                }
              }
            }
          ]
        : []),
      {
        id: i2cSliceIds.sensorBus,
        kind: "intent.connection",
        label: "Sensor I2C bus",
        role: "sensor_bus",
        from: {
          node: i2cSliceIds.mcu,
          port: "i2c"
        },
        to: {
          node: i2cSliceIds.sensor,
          port: "i2c"
        },
        contract: "builtin:i2c.v1",
        strategy: {
          pinAssignment: "auto"
        },
        include: {
          pullups: true
        }
      }
    ]
  };
}
