# Using AI in Archboard

> Retired from the application runtime on October 14, 2026. This document is retained
> as a legacy implementation reference. Use [Project JSON](project-context.md) for
> the current local import workflow. Its old enablement steps do not activate hosted AI.

AI helps describe architecture supplied by you. It cannot inspect a repository,
execute code, fetch links or establish security, performance or deployment facts.
Descriptions can be incomplete or misleading. Review supplied facts, inferred
assumptions, proposed changes and any evidence separately; ask for clarification
instead of treating a plausible diagram as verified analysis.

These workflows are implemented through AI-C18; this guide is the AI-C19 handoff.
Rendered browser, database durability and live model acceptance remain OPEN in
[the verification inventory](ai-verification.md). No recorded demo or measured
quality/cost claim is implied.

## Before sending

Use a signed-in owner/editor server board in a desktop editing window. The local
`/demo` has no authenticated AI runtime. AI needs network access and an enabled
operator configuration; GitHub remains the only login. Open the editor's AI panel
and choose **Check AI availability**. Availability is advisory: allowance and
permissions are checked again when the request is admitted.

Your reviewed prompt/context goes to Archboard's API and then OpenAI when you
explicitly generate. Guidance also includes selected graph fields and reviewed
private history. Code and note text in included cards is included, not fetched or
executed. Private drafts/guidance are not shared with collaborators; applying graph
or presentation changes shares that applied content through normal board sync.
Remove secrets, account details and proprietary material you cannot share.
OpenAI retention depends on the operator's model/project data controls; Archboard's
short result expiry is not a promise of deletion at the provider. See
[operator data flow](ai-operator-configuration.md#data-flow-rotation-and-invalidation).

## Generate a diagram

1. Choose **Generate diagram**. Enter a concrete description of components,
   responsibilities, connections and unknowns. This workflow does not send the
   current board graph. Choose **Prompt only**, **Guided context** or **JSON file**.
2. Guided context can export a reusable context JSON file. For a supplied example,
   download/copy [the three-component context](examples/three-component.archboard-context.json)
   and choose it in **JSON file**. It contains synthetic descriptions and no source
   evidence. Adapt it to your project; keep semantic component keys unique and
   connection/evidence references valid. Delete example components when unused.
3. Choose **Review request**. Read the complete reviewed request, check all context,
   remove unwanted text and review again after edits. File parsing happens locally;
   selecting a file alone sends nothing. Choose **Generate from this review** to
   send exactly that review. Generation leaves the board unchanged.
4. Review questions, warnings and assumptions. Choose **Prepare diagram preview /
   recover Apply**, inspect the separate preview, and verify the proposed nodes and
   connections. Layout happens locally in a bounded worker, with a fallback if needed.
5. Choose **Apply additions to this board** only after review. Apply adds fresh IDs
   through one structural command and does not replace existing graph content.
   Current access, limits and candidate state are checked again. Alternatively,
   choose the new-private-board action to import the reviewed graph with its stable
   recovery identity. Board creation is an online authorized operation.

Context JSON is a description format, **not** portable board JSON. Use the AI file
input for `kind: "archboard.project-context"`; use normal import/export for saved
diagrams. The first integration has no local repository-export command or helper.
You select one UTF-8 JSON file, up to 1 MiB; archives are unsupported. Prompt text
is limited to 8,000 characters. Context caps include 100 components, 200 connections,
20 groups and 50 evidence entries, with 100,000 excerpt characters in total. Evidence
uses project-relative forward-slash paths and valid line ranges. A file below the
byte limit can still exceed the configured model's input budget.

## Prompt starters

Use these as text to adapt, rather than claims about your system:

- Diagram: “Diagram only the supplied web client, task API and database. Show the
  declared HTTPS and SQL flow. List missing facts; do not add services.”
- Explanation: “Explain the selected components and their stated responsibilities.
  Separate supplied facts from assumptions and ask up to three focused questions.”
- Flow: “Trace the request path through the selected connections. Explain their
  declared direction and identify missing failure-handling information.”
- Scoped edits: “Improve the selected descriptions and labels without changing
  kinds, deleting objects or reconnecting edges. Explain each proposed change.”
- Walkthrough: “Propose a three-minute recruiter walkthrough of this selection:
  named steps, talking points, declared flow and tradeoffs. Mark assumptions.”

## Understand selection and review changes

Select cards/connections and choose **Understand selection**. Selected connections
include their endpoints; connections between selected cards are included. Boundaries
and unrelated cards are excluded. Choose **Explain selection**, **Trace request flow**,
**Propose scoped edits** or **Recruiter walkthrough**, then **Review selected context
and history**. Read the full review before sending. A changed selection, field,
question or history requires a new review. Private follow-up history is bounded
to 12 messages and 24,000 characters; clear it to start a different discussion.
Highlights and guidance stay local and do not move a collaborator's viewport.

Scoped edits require another before/after review. Proposed additions and exact field
preconditions are checked against the current document. Collaborator changes outside
the scope are preserved; changed preconditions block Apply. The proposal cannot
delete objects, reconnect edges, change kinds or replace the entire board.

For a recruiter walkthrough choose **Append steps** or **Replace reviewed steps**.
Append sends the selected architecture. Replacement includes every reviewed existing
step's title, notes, viewport and references, plus its referenced graph objects.
Review that expanded input before sending. Review ordered talking points and
references before Apply. Replacement checks the existing steps again; unrelated
concurrent changes are preserved or conflicting preconditions block it. A generated
walkthrough is a proposal, not automatically started presentation or verified analysis.

## Undo, offline work, recovery and expiry

AI Apply follows the existing Undo rules. Diagram additions, scoped structural
additions and presentation append/replacement are structural changes excluded
from Undo. Supported scoped field changes form one normal Undo entry; Undo of
those fields leaves structural additions in place. Inspect and explicitly edit
or remove unwanted applied objects through normal board commands. Undo does not
refund provider spend or make a run new. Recorded Apply identities are not a reason
to apply the same proposal again after Undo. Obtain an explicitly reviewed new
intent if you want a different proposal; do not bypass recovery markers.

Generation is disabled offline and is never queued for automatic upload. Local
graph editing/persistence continues under the usual board policy. Fetching an AI
result and creating a new board require network access. Do not infer server saving
from a preview, a local Apply, journal marker or surviving browser bytes. The board
must receive its normal committed server ACK. Browser/outbox recovery proof is
still deferred; see [saving and recovery](using-archboard.md).

If a submit response is lost, use the original request recovery controls with the
same reviewed body and idempotency key. Repeated generation clicks/recovery do not
authorize another paid request. Reusing that key with changed input conflicts.
Cancellation after dispatch or an **outcome unknown** may still incur cost; the
application retains conservative liability and does not automatically retry it.
Making a new request is a separate explicit spending decision, subject to limits.

Results normally expire after 15 minutes or earlier capacity eviction; operators
can shorten retention. They are private to the requesting account/target and reads
recheck current access. The receipt replay window is 24 hours; expired keys remain
tombstones. Expiry, eviction, disabled AI or unavailable encryption keys do not
regenerate content. Applied graph content follows normal board retention and is not
deleted when the AI result expires. Export/save applied work through normal flows.
Drafts/history clear when account or scope access changes; do not depend on them
as a persistent conversation archive.

The operator pays through the configured OpenAI API account. Admission uses finite
money, frequency, token and concurrency ceilings and reserves every permitted
attempt, without assuming cache savings. Exact private result reuse can avoid a
new provider call but still consumes create-frequency allowance. Actual costs
depend on usage and reviewed prices; unknown usage is not zero. A quota message
does not guarantee a reset time, particularly for lifetime or unknown liabilities.
See [configuration](ai-operator-configuration.md) and [operations](ai-operations.md).
