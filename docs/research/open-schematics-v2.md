# Research Note: Open Schematics V2

Status: reference note

Captured: 2026-07-10

Dataset snapshot at capture time:

- Hugging Face revision: `5c74c3648d22e73426bbeb4691397d9cc8053e34`
- Last modified: 2026-06-30
- Rows: 87,931
- Reported total file size: 317 GB
- Split: one `train` split

## Sources

- [Announcement on X](https://x.com/_luckyhada/status/2071847686731640938), posted on 2026-06-30.
- [Open Schematics dataset card and viewer](https://huggingface.co/datasets/bshada/open-schematics).

## What It Is

Open Schematics V2 is a public Hugging Face dataset of electronic schematic files and related PCB layouts collected from publicly available web sources. Its publisher describes it as a self-growing dataset that scans for new engineering designs. The claim that it is the largest such dataset on the internet is the publisher's claim and was not independently verified for this note.

Each row represents one schematic and associates it with repository-level metadata, a rendered schematic when available, and PCB files found in the same source project. This makes the collection useful as a broad corpus, but an association with the same repository does not by itself prove that every attached PCB is the physical realization of that schematic.

## Record Schema

| Field | Type | Meaning |
| --- | --- | --- |
| `schematic` | string | Raw `.kicad_sch`, legacy `.sch`, or Altium `.SchDoc` content |
| `schematic_image` | image | Rendered schematic PNG, or null when unavailable |
| `pcb_files` | list of strings | Raw `.kicad_pcb` or `.pcb` files found in the same project |
| `pcb_images` | list of images | Rendered PCB images parallel to `pcb_files`, with null entries where unavailable |
| `components_used` | list of strings | Library-symbol component names extracted from `.kicad_sch` files |
| `schematic_json` | string | `kiutils` JSON conversion for `.kicad_sch` files |
| `schematic_yaml` | string | `kiutils` YAML conversion for `.kicad_sch` files |
| `name` | string | Source repository in `owner/repo` form |
| `description` | string | Source repository description |
| `extensions_used` | list of strings | Schematic extension followed by PCB extensions present in the project |

Supported schematic formats are modern KiCad `.kicad_sch`, legacy KiCad `.sch`, and Altium `.SchDoc`. The modern KiCad rows receive the richest processing. The PCB side includes `.kicad_pcb` and `.pcb` source.

## Collection And Processing

The published pipeline performs the following processing:

- fetches raw schematic and PCB files from public web sources;
- stores or derives schematic and PCB renderings;
- converts modern KiCad schematics into JSON and YAML through `kiutils`;
- extracts component names from library symbol references;
- removes empty modern KiCad schematics with no library or schematic symbols;
- excludes PCB files larger than 10 MB; and
- for projects with more than 20 PCB files, keeps the 20 whose rendered images have the largest pixel area.

Legacy KiCad and Altium rows retain raw text, but do not receive the published JSON, YAML, or component-list enrichments.

## Published Limitations

The dataset card reports:

- structured JSON, YAML, and component fields exist only for modern KiCad rows, approximately 85 percent of the dataset;
- PCB images are unavailable for approximately 55 percent of PCB entries;
- schematic images are unavailable for approximately 10 percent of rows;
- project quality and complexity vary significantly; and
- component naming is inconsistent across projects and libraries.

The dataset has a single training split. It does not publish curated validation or test splits.

## Additional Due-Diligence Gaps

The documented row schema does not include several fields nocad would need for trustworthy reference-design use:

- source commit or immutable source revision;
- original schematic and PCB paths;
- original project license and per-file attribution data;
- explicit schematic-to-PCB linkage inside projects with multiple designs;
- KiCad version compatibility beyond what can be parsed from raw content;
- ERC, DRC, fabrication, bring-up, or production status;
- BOM and manufacturer part identity normalized across libraries;
- duplicate or near-duplicate family identifiers; and
- security or provenance attestations for derived renderings and conversions.

These are not necessarily flaws in a broad web corpus. They limit the conclusions that can be drawn from a row. In particular, "found in a public repository" is not equivalent to "validated reference design."

## Licensing And Attribution

The Hugging Face repository declares CC-BY-4.0 for the dataset and explicitly instructs users to comply with the original licenses of source projects. The row schema exposes the repository name but not the original license, source revision, or file path.

Before nocad redistributes content, ships derived package data, or uses the corpus for model training, it needs a separate provenance pass that:

1. resolves each row to an immutable source URL and commit;
2. records the original project and file licenses;
3. applies a reviewed license allowlist for the intended use;
4. preserves attribution and notice requirements;
5. defines deletion and source-removal handling; and
6. separates unknown or conflicting licenses from usable material.

The dataset-level license alone should not be treated as clearing every embedded design for every downstream use.

## Potential Uses For nocad

### Near-term: parser and importer evaluation

A filtered subset can provide broad syntax coverage for KiCad import research:

- inventory format and generator versions;
- measure parser success and failure categories;
- find unusual hierarchy, symbol, net, and footprint cases;
- test deterministic import and export round trips; and
- create regression fixtures only from license-cleared, attributed sources.

This is more immediately useful than model training and aligns with nocad's need for reliable structured interop.

### Near-term: reference search

Repository descriptions, components, and parsed connectivity could support a research prototype for finding related public designs. Results must display provenance and should be labeled as examples, not validated recommendations. Ranking signals could later include documentation quality, source activity, explicit hardware license, ERC/DRC results, and design completeness.

### Medium-term: package and pattern discovery

After normalization and license filtering, the corpus could help identify recurring design patterns such as:

- MCU support circuits;
- USB-C power and data inputs;
- regulator feedback and decoupling networks;
- level shifting and ESD protection;
- connector pinouts; and
- repeated placement or routing motifs.

Patterns should become candidates for human review and package authoring. Frequency alone does not establish electrical correctness.

### Medium-term: validation research

The corpus can seed negative and positive examples only after independent checks. Useful derived labels might include parser validity, ERC/DRC findings, disconnected nets, missing power pins, clearance violations, or schematic-to-layout consistency. Automatically generated labels should retain the checker version and configuration.

### Later: multimodal and generative models

The paired source and image fields make experiments in schematic understanding, documentation generation, and layout representation possible. Model work should follow provenance, deduplication, quality scoring, and evaluation design. A random row split would likely leak nearly identical designs or multiple files from the same repository across train and test sets.

## Recommended Evaluation Sequence

Do not download or adopt the full 317 GB corpus as a project dependency. Evaluate it as an external, revision-pinned source:

1. Query metadata and sample a small set of modern KiCad rows.
2. Measure missing fields, duplicates, repository concentration, and format-version distribution.
3. Resolve samples back to their source repositories and audit provenance.
4. Run KiCad parsing plus nocad's future import validation on the sample.
5. Define quality tiers such as parseable, structurally complete, ERC-clean, DRC-clean, documented, and hardware-validated.
6. Create repository-grouped evaluation splits to reduce leakage.
7. Store only approved, minimal fixtures in the nocad repository, with source revision, license, and attribution beside each fixture.
8. Re-evaluate newer dataset revisions deliberately rather than consuming autonomous updates without review.

## Architecture Implications

Open Schematics supports the product vision's emphasis on reference designs and structured AI context, but it does not replace nocad's internal model or package registry.

- Import raw EDA data through a versioned adapter into canonical nocad structures.
- Keep source provenance attached to every imported or derived object.
- Separate raw examples, normalized graphs, validated patterns, and installable packages.
- Never let image-only similarity bypass ERC, DRC, constraints, or human review.
- Make retrieval results explain why a design matched and where it came from.
- Treat external dataset updates like dependency updates: pinned, diffed, evaluated, and explicitly promoted.

## Resulting Research Questions

1. How much of the corpus can be resolved to immutable source files using only `name` and raw file content?
2. How many rows are true schematic-to-PCB pairs rather than repository-level co-occurrence?
3. Which format versions and constructs should define nocad's first KiCad import compatibility matrix?
4. What automated signals correlate with a genuinely reusable reference design?
5. How should provenance flow from a source file into a normalized graph, a retrieved example, and a derived nocad package?
6. Can graph-based retrieval outperform component-list and image similarity for finding electrically relevant examples?
