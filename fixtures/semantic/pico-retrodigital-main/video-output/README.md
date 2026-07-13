# Pico RetroDigital video-output logical interface fixture

This source-free fixture captures the logical signal correspondence between RP2354B `U3` and the HDMI-side TE 1-1734839-4 FFC connector `J3` from the normalized north-star records.

It deliberately models only the eleven semantically identified active interface signals. The manual bindings preserve the captured board mapping: GPIO12 through GPIO19 map to CLK-, CLK+, D0-, D0+, D1-, D1+, D2-, and D2+; GPIO8, GPIO9, and GPIO10 map to SDA, SCL, and CEC.

This is not exact physical parity and is not a golden or hardware-qualified fixture. It omits the eight 220 ohm TMDS series resistors, source 5 V diode and decoupling path, CEC bias/protection circuit, ground connectivity, and the unverified J3 pin-2 HPD candidate with its omitted R2 10K pull-up branch. The production connector definition currently supplies the logical exposure mapping; the fixture does not claim that mapping is intrinsic to the bare FFC part.

The manifest pins both local fixture inputs and the repository-local normalized reference artifacts. Verification reads no mutable hardware checkout or KiCad source.
