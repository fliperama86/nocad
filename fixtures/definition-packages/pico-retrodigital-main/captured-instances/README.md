# Pico RetroDigital captured instances

This dependency-only definition package represents unqualified component instances from the pinned Pico RetroDigital main-board reference. It is not a production parts catalog and is never included in the normal component or function palette.

The initial package contains the eight captured 220 ohm, `Resistor_SMD:R_0402_1005Metric` TMDS series instances R3 through R10. Definition identities use immutable schematic UUIDs, not reference designators. Capture metadata retains the schematic identity, displayed reference and value, symbol and footprint library IDs, board footprint UUID, pad UUIDs, and repository-local normalized provenance.

Each component definition declares only two passive terminals and a 220 ohm resistance property. Coverage is `interface`: manufacturer, manufacturer part number, tolerance, power rating, assembly identity, and as-built qualification remain unknown and are not inferred. A later qualified production definition may replace the component reference on the authored node without changing that node's stable identity.

The package also contains a reference-local video-output function. Its eight data-authored inline rules select the exact captured resistor definition associated with each TMDS signal. The general resolver has no knowledge of this board, HDMI resistor references, or these mappings.

Projects must explicitly request `reference:pico-retrodigital-main/captured-instances` at version `0.1.0`. The package content hash covers normalized capture descriptors, provenance, evidence hashes, definition paths and hashes, package identity, and schema. Definition payload hashes are verified again when a dependency-scoped catalog loads the package.
