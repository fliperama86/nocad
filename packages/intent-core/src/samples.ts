import type { ProjectSource } from "./types";

export const i2cSliceIds = {
  debugGpio: "edge_1f7596a2-8ee5-4f44-8b55-479597a1e602",
  mcu: "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12",
  rail3v3: "node_77e9d1da-e4da-45d5-b60f-3bb8d41f63f1",
  sensor: "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb",
  sensorBus: "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65"
} as const;

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
