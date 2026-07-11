# Pico RetroDigital main-board reference

This directory is a normalized, content-pinned inventory of the user's Pico RetroDigital main board. It intentionally contains no KiCad source, footprint, manufacturing archive, or production output because the source repository has no explicit design license.

## Capture identity

- Requested project stem: `~/Projects/pico-retrodigital/hardware/pico-retrodigital/pico-retrodigital`
- Resolved design directory: `~/Projects/pico-retrodigital/hardware/pico-retrodigital`
- Repository HEAD: `3400eec4b5aba0b10302e5e54ed1dbe0758e3a88`
- Capture basis: local working-tree content on 2026-07-11
- The PCB differed from HEAD and is pinned by its working-tree SHA-256, not by the commit alone.
- `pin.designAggregateSha256` identifies the semantic design, rule, and referenced local-library inputs.
- `pin.evidenceAggregateSha256` identifies the wider capture, including stale DRC/fabrication evidence and an unreferenced untracked footprint.
- `sourceFacts.connectivityAggregateSha256` identifies the normalized PCB net names and pad-UUID membership digests.

## Recorded structure

The inventory records 69 physical schematic components, 70 PCB footprint instances, 379 pad UUIDs, 355 net-assigned pads, 123 PCB nets, subsystem ownership, cross-subsystem boundary declarations, interfaces, power domains, support circuits, package/contract implementation status, stackup, netclasses, four differential pairs, the custom small-via rule, and five copper zones.

Two PCB footprints share the schematic path for C5. They remain separate footprint instances under one schematic component. PCB display references `BOOT` and `RES` map by schematic path to `SW1` and `SW2`. Pad UUID is the endpoint identity because pad numbers can repeat within a footprint.

PCB pad membership is the current normalized manufacturing-connectivity view. The capture counts 60 virtual schematic power symbols, but it does not normalize each virtual symbol or schematic-wire endpoint. This limitation is first-class in `sourceFacts.schematicConnectivity` and `unsupportedOrUnknown`; repository verification does not claim to re-extract or prove facts from the omitted source.

## Qualification and rights

- License: `NOASSERTION`
- Golden reference: no
- Current DRC: unknown
- Current ERC: unknown
- Fabricated: unknown
- Hardware-tested: unknown
- The available DRC report and fabrication outputs predate the pinned July PCB and do not qualify it.

## Verification

Run:

```sh
pnpm verify:north-star
```

The verifier reads only repository-local normalized records. It validates hashes, aggregate encodings, canonical order, stable identity uniqueness, complete component ownership, pin-derived net digests, exact cross-subsystem closure, interface/power declarations, board constraints, support groups, and qualification fields. It also runs deliberate in-memory mutations to prove that order, connectivity, boundary, and status regressions are rejected.
