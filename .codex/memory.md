# Project Memory

## Visual Fidelity

- Do not describe the KiCad fixture preview as perfect or complete. Treat it as a narrow research renderer and state its supported primitives.
- Preserve KiCad's board-coordinate rotation convention when transforming footprint-local pad coordinates. Validate transformed pads against connected track endpoints, not only aggregate counts.
- In placed `.kicad_pcb` footprints, transform pad `at` x/y from footprint-local coordinates, but treat the pad `at` angle as the serialized board orientation. Do not add the footprint rotation again. Validate the long axis of signal and mounting pads against the source footprint and connected traces.
- Render the declared pad and drill shapes and dimensions. In particular, through-hole `oval` pads with `drill oval` must appear as pill-shaped copper with a pill-shaped hole, not as rectangles with circular holes.
- A board preview is not visually representative if it omits filled copper zones or source drawing layers. Render serialized `filled_polygon` geometry and expose footprint silk, fabrication, courtyard, drawing, and comment layers separately.
