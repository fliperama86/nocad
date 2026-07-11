# Research Note: pico-retrodigital Fixture Plan

Status: reference and fixture plan

Captured: 2026-07-10

Source inspected: `~/Projects/pico-retrodigital/hardware`

This document records how the author's own KiCad designs can serve as trusted nocad acceptance fixtures. The source directory is machine-local and must not become an implicit test dependency. Any fixture used by nocad must be curated into an immutable snapshot with provenance and expected facts.

## Current Curation State

A minimal HDMI breakout snapshot now lives at `fixtures/kicad/hdmi-breakout/`. It includes only the KiCad schematic, PCB, and project files plus a manifest and README. The manifest pins each source file by byte count and SHA-256, records expected structural facts, and names `SCL` as the first selected-net routing candidate.

Run `pnpm verify:fixtures` to check hashes, parse the KiCad S-expressions, and verify the recorded generator version, symbol, component, label, layer, footprint, pad, segment, via, zone, and outline facts. The root `pnpm test` command runs this verification before package tests.

The web prototype also exposes the snapshot under **PCB > KiCad fixture**. A narrow read-only parser extracts the actual polygonal board outline, footprint origins, pads, copper segments, layers, and net names directly from the pinned `.kicad_pcb` source. The preview supports front/back copper visibility and per-net isolation; `SCL` shows the initial M10 candidate as three routed segments between two pads. This is fixture visualization research, not a supported general KiCad importer and not completion of roadmap M4.

The snapshot is immutable and suitable for parser and structure regression work, but it is not yet qualified as a golden or redistributable fixture. Its manifest deliberately records `NOASSERTION` for the license and `unknown` for fabricated and hardware-tested status. The original HDMI breakout directory was untracked at capture time, so the fixture is pinned by content digest rather than an original source commit.

## Fixture Candidates

### HDMI breakout

Source: `hardware/hdmi_breakout/hdmi_breakout`

Observed inventory:

- KiCad 10 schematic and PCB;
- 4 schematic components: HDMI connector, FFC connector, and 2 mounting holes;
- 2 copper layers on a 1.6 mm board;
- approximately 22 x 41 mm outline;
- 41 pads, 52 track segments, no vias, and 1 copper zone;
- 12 unique schematic label names; and
- BOM, positions, IPC netlist, and fabrication archive.

Intended use:

- first exact schematic and board-model fixture;
- manually auditable connectivity, geometry, and export comparison;
- first M10 selected-net routing experiment using a simple management or control net;
- later differential-pair assistance and routing tests; and
- stale-output and provenance checks once its source and production artifacts evolve.

Current qualification gap: the nocad snapshot is content-pinned, but the original source remains untracked and its license, fabricated status, and hardware-tested status are unresolved. These fields must be explicit before the fixture is marked golden.

### Current pico-retrodigital board

Source: `hardware/pico-retrodigital/pico-retrodigital`

Observed inventory:

- KiCad 10 schematic and PCB;
- 69 non-power schematic components and 70 PCB footprints;
- 2 copper layers on a 1.6 mm board;
- approximately 50 x 38 mm outline;
- 379 pads, 611 track segments, 58 vias, and 5 zones;
- 123 observed PCB net names;
- RP2354B, three SN74LVC245 buffers, USB-C, local power regulation, and FFC connections;
- RGB, control, audio, USB, I2C, clock, power, and TMDS-style differential-pair nets;
- project-local symbols and footprints;
- a custom rule permitting smaller vias on a constrained net allowlist; and
- BOM, CPL, Gerber, drill, IPC netlist, and fabrication archives.

Intended use:

- full board-model and rendering acceptance fixture;
- connectivity, ratsnest, zones, custom rules, and DRC coverage;
- intent-to-obligation examples for interfaces, level shifting, power, clocks, and differential pairs;
- low-speed selected-net and later selected-bus routing experiments;
- BOM and fabrication provenance tests; and
- eventual AI explanations and patch evaluation against a design whose intent is known.

This fixture should follow the HDMI breakout. It is small enough to remain inspectable but broad enough to expose realistic interactions between routing, placement, component metadata, and manufacturing output.

### Main-board backup

Source: `hardware/main-board-backup`

Observed inventory:

- KiCad 9 source;
- hierarchical `RP2350B` child schematic;
- 71 PCB footprints, 407 pads, and 198 PCB net-table entries;
- 213 track segments, 32 vias, and 6 zones; and
- older Gerbers and source backups.

Intended use:

- KiCad version compatibility and migration research;
- hierarchical schematic import coverage;
- engineering-change and source-to-board synchronization cases; and
- comparison with the newer flattened and substantially revised design.

It is historical evidence, not the primary golden design.

## Valuable Consistency Cases

The current source and generated outputs already contain cases that nocad should represent explicitly rather than hide:

- the PCB has two footprints whose visible reference is `C5`;
- one production export disambiguates them as `C5` and `C5_2`;
- schematic switch references are `SW1` and `SW2`, while PCB reference fields are `BOOT` and `RES`;
- the saved DRC JSON report is dated 2026-05-14, while the inspected source files are newer;
- fabrication outputs are older than the current schematic and PCB source; and
- custom library content is partly project-local, with at least one untracked footprint present in the working tree at inspection time.

These observations do not by themselves determine whether the hardware is electrically wrong. They are fixtures for identity, synchronization, attribution, and freshness behavior:

- stable internal IDs must not depend on visible reference text;
- duplicate or changed references must produce diagnostics without losing object identity;
- every derived artifact should record the exact source revision and generator version;
- stale DRC, BOM, CPL, Gerber, and fabrication bundles should be detectable; and
- local symbols and footprints must be captured with the design revision that used them.

## Curation Requirements

Before copying a fixture into nocad:

1. Select and record an immutable source commit or archive hash.
2. Confirm ownership and the license under which the fixture may live in the nocad repository.
3. Copy only the minimum source and local library files needed by the test.
4. Exclude editor backups, history directories, and generated manufacturing files unless a test explicitly covers them.
5. Add a machine-readable manifest with source path, revision, KiCad version, ownership, license, fabricated and tested status, and known issues.
6. Record expected structural facts such as component, footprint, pad, net, track, via, zone, and layer counts.
7. Record expected semantic facts such as connector roles, power domains, differential pairs, and allowed unconnected pins.
8. Never rewrite the golden source in place during a test. Import and export into temporary locations and compare deliberately normalized results.

Suggested manifest shape:

```yaml
name: hdmi-breakout
source_repository: pico-retrodigital
source_revision: <commit-or-archive-sha256>
source_paths:
  - hardware/hdmi_breakout/hdmi_breakout/hdmi_breakout.kicad_sch
  - hardware/hdmi_breakout/hdmi_breakout/hdmi_breakout.kicad_pcb
kicad_version: "10.0"
owner: <name>
license: <explicit-license>
fabricated: <yes-or-no>
tested: <yes-or-no>
known_issues: []
expected:
  copper_layers: 2
  footprints: 4
  pads: 41
  track_segments: 52
  vias: 0
  zones: 1
```

Counts are regression sentinels, not the canonical meaning of a design. Semantic expectations and stable source identities remain more important than byte-for-byte agreement with KiCad's formatting.

## Milestone Mapping

| nocad milestone | Fixture use |
| --- | --- |
| M3 schematic projection | Render a curated schematic fixture and trace projected objects to stable source identities |
| M4 board projection | HDMI breakout first, then the current main board for footprints, pads, ratsnest, zones, and dense labels |
| M5 placement and board source | Import or transcribe placement into authored board geometry without losing provenance |
| M6 obligations | Derive and inspect unrouted, differential-pair, power, and placement obligations |
| M7 manual routing | Recreate a removed simple trace with normal geometry tools and live DRC |
| M8 KiCad export | Export a fixture-derived board and compare connectivity and KiCad DRC behavior |
| M9 deterministic assists | Exercise corridor completion, differential-pair drawing, replication, and fanout helpers |
| M10 selected-net search | Remove one simple HDMI-breakout management/control route and propose a deterministic, DRC-clean patch or explain failure |

General KiCad import remains outside the M1-M8 MVP. A curated fixture may be represented through a narrow research converter or checked-in normalized nocad form before a supported general importer exists.
