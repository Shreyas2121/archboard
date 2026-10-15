# Create diagrams from project JSON

Archboard turns an `archboard.project-context.json` file directly into editable
cards, connections and groups. Validation, preview and automatic layout run on
your device. This workflow needs no model key, hosted generation or AI allowance.

## From an existing repository

1. Open `/demo` or an editable board in a desktop window and choose **Project JSON**.
2. Choose System overview, API / request flow, Database relationships, Storage
   infrastructure, Internal modules or Deployment. Optional extraction instructions
   can narrow the view further.
3. Copy the local extraction prompt into your own coding assistant with the target
   repository open. It asks for relevant source evidence and a focused JSON file,
   without running the application, connecting to services or reading secrets.
4. Review the generated JSON yourself, then select it in Archboard. Archboard cannot
   verify its claims against repository files. Keep sensitive or proprietary data
   out of anything you intend to share.
5. Review the locally arranged diagram and the complete file details. Choose **Add
   diagram to this board**. Existing content is preserved; additions are placed
   beside it. If the board changes during review, prepare a fresh preview.
   The canvas moves to the imported diagram after it is added.

The focus selector guides extraction. Import preserves all supplied components,
connections, directions, labels and groups; it does not ask another model to
rewrite the architecture. Changing the focus after loading a file does not filter
its content. Generate a different focused JSON file when you need a different view.

**Database relationships** asks for entity relationships and important join tables,
with database/ORM names in technology text. Infrastructure cards and storage access
flows belong in **Storage infrastructure**, which asks for databases, buckets,
caches and their verified service/worker callers. Foreign-key/delete claims need
actual constraint definitions; an ID field alone is insufficient evidence. Policies,
encryption and vector/index claims need their own source evidence. Unverified
details belong in unknowns.

These two prompts write `archboard.database-context.json` and
`archboard.storage-context.json` respectively, so generating a second view need
not replace the first. Import either file through Project JSON or dashboard
Import JSON. The importer recognizes the content, not the filename. Older mixed
`database` files and files without focus metadata remain valid and import in full;
selecting another diagram type does not split or modify an existing board.

To create a **new private board**, sign in, choose **Import JSON** on the dashboard
and select the same project-context file. Review its preview and board title,
then confirm creation. This uses the existing private-board import route and
receipt recovery. Project JSON also works through the local demo when offline,
once the application is available on that device.

## File format and limits

The version-1 context format remains compatible with existing files, including
files without the optional `diagramFocus` field. Use the
[three-component example](examples/three-component.archboard-context.json) as a
small starting point. The copied prompt contains a complete example and the exact
field/reference rules.

- One UTF-8 JSON file, up to 1 MiB, with `kind: "archboard.project-context"` and
  `schemaVersion: 1`.
- Up to 100 components, 200 connections, 20 groups and 50 evidence excerpts, subject
  to the existing text/reference limits and remaining board capacity.
- Each component becomes one component card. Category, name, responsibility and
  technology text are preserved. Each declared connection becomes one directed
  edge; groups become visual boundaries. Empty groups have no visual boundary.
- New graph IDs are allocated locally. Imported logical keys cannot overwrite
  existing cards or revive deleted IDs.
- Invalid references, duplicate keys, unsupported versions, excess limits and
  unavailable editing block import with an error. No partial graph is applied.

Automatic layout runs in a bounded worker. If the engine is unavailable or times
out, the complete diagram uses a grid preview. A preview is not a save. After
adding, use the normal toolbar status to distinguish device saving from committed
server acknowledgment. Shared boards synchronize applied diagram content through
their existing permissions and offline outbox.

Evidence, project-wide constraints and unknowns remain available in the file review;
the board stores the diagram fields. Keep the original context JSON for those
additional details. It is a description supplied by you, not verified repository
analysis or a complete table/column ERD.

Structural additions follow the existing delete/restore rules rather than Undo.
Export the resulting board as portable JSON or SVG/PNG through the normal controls.
Saved-board JSON and project-context JSON have different formats; dashboard import
accepts both and validates the selected kind locally.

## Hosted AI retirement

The AI assistant, cloud generation, private explanations, scoped edits and generated
walkthroughs are absent from the active product. The API no longer registers their
routes/providers or advertises them in OpenAPI. Legacy `AI_*`/`OPENAI_*` values cannot
re-enable those features or impose startup requirements. Local extraction uses
whichever tool you choose outside Archboard.

Legacy implementation, contracts and database migration/entity history remain
dormant for reference. This change performs no database cleanup, decrypts no stored
AI payloads and makes no provider request. Browser/database acceptance remains
subject to the existing [verification policy](verification-policy.md).
