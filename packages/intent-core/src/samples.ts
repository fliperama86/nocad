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
