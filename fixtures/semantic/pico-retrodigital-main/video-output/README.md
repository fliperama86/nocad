# Pico RetroDigital video-output TMDS series-bank fixture

This source-free fixture captures the RP2354B `U3` to HDMI-side TE 1-1734839-4 FFC connector `J3` interface through the eight physical 220 ohm series resistors recorded in the normalized north-star reference.

The fixture authors ten physical component instances: `U3`, `J3`, and captured instances `R3` through `R10`. The resistor definitions are available only through the explicitly requested, content-pinned `reference:pico-retrodigital-main/captured-instances` package. They preserve the captured schematic UUID, 220 ohm value, `Resistor_SMD:R_0402_1005Metric` footprint identity, and pins 1 and 2 without inventing a manufacturer, tolerance, or procurement part number. They are not production-palette components.

Sixteen authored TMDS net segments preserve the captured connectivity. GPIO12 through GPIO19 connect to resistor pin 2 in the order CLK-, CLK+, D0-, D0+, D1-, D1+, D2-, and D2+. Resistor pin 1 connects to the corresponding `J3` conductor. Each authored segment explicitly realizes its provider or connector side of a reference-local series-termination topology rule. The generated conceptual terminals are remapped to the captured pin orientation, so all eight generated obligations are replaced by the authored instances and the resolved fixture contains zero duplicate generated components.

DDC SDA, DDC SCL, and CEC remain direct semantic nets on GPIO8, GPIO9, and GPIO10. Together with the sixteen authored TMDS segments, the fixture resolves to nineteen physical nets with no expected diagnostics.

This is not exact physical parity and is not golden or hardware-qualified. It still omits the source 5 V diode and decoupling path, CEC bias/protection circuit, connector ground connectivity, and the unverified `J3` pin-2 HPD candidate with its `R2` 10K pull-up branch. The production connector definition currently supplies the logical exposure mapping. This fixture does not claim that map is intrinsic or independently qualified physical-pin metadata for the bare FFC part.

The manifest pins the local project, full physical-resolution expectation, and repository-local normalized reference artifacts. Verification reads no mutable hardware checkout or KiCad source.
