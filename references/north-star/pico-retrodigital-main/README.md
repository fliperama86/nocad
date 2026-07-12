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
- `schematicConnectivity.aggregateSha256` identifies the normalized schematic pin partitions and topology evidence.

## Recorded structure

The inventory records 69 physical schematic components, 337 physical schematic pin UUIDs, 60 virtual power symbols, 133 wires, 32 junctions, 158 labels, 20 explicit no-connect markers, 70 PCB footprint instances, 379 pad UUIDs, 355 net-assigned pads, 123 schematic nets, 123 PCB nets, subsystem ownership, cross-subsystem boundary declarations, interfaces, power domains, support circuits, package/contract implementation status, stackup, netclasses, four differential pairs, the custom small-via rule, and five copper zones.

Two PCB footprints share the schematic path for C5. They remain separate footprint instances under one schematic component. PCB display references `BOOT` and `RES` map by schematic path to `SW1` and `SW2`. Pad UUID is the endpoint identity because pad numbers can repeat within a footprint.

`schematic-connectivity.json` records every placed physical pin, virtual power symbol, wire, junction, label, and explicit no-connect marker in the single-sheet schematic. It also records the exact crosswalk to PCB pad UUIDs and independently compares the schematic and PCB logical pin partitions.

All 337 represented schematic pins have equivalent PCB logical connectivity. Twenty-two blank, mounting, or thermal pads are explicitly excluded as non-electrical footprint details. J5 pads A8 and B8 are unconnected USB-C SBU contacts omitted by the USB2-only schematic symbol; that exact discrepancy has a content fingerprint and one documented waiver. The duplicate C5 footprint remains a separate reviewed physical-identity issue, and conflicting nets across the duplicate pads fail verification.

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

The verifier reads only repository-local normalized records. It validates hashes, aggregate encodings, canonical order, stable identity uniqueness, complete component ownership, pin-derived net digests, schematic object-to-net closure, virtual power and no-connect membership, exact schematic-to-PCB logical partitions, fingerprinted discrepancies and waivers, cross-subsystem closure, interface/power declarations, board constraints, support groups, and qualification fields. It also runs deliberate in-memory mutations to prove that order, connectivity, waiver, exclusion, boundary, and status regressions are rejected.

The capture itself can be regenerated from the exact pinned source with KiCad 10:

```sh
node scripts/capture-north-star-schematic.mjs \
  --source /path/to/pico-retrodigital.kicad_sch \
  --kicad-cli /path/to/kicad-cli
```

The capture command refuses a schematic whose bytes or SHA-256 differ from the manifest pin. Normal repository verification does not run KiCad or read the external source, so it validates the normalized artifact without claiming to re-prove its extraction.
