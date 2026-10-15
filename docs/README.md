# Documentation

Start with the maintained guides for the current product:

- [Setup](setup.md): local demo, authenticated development and production configuration.
- [Using Archboard](using-archboard.md): editing, saving, recovery, collaboration and exports.
- [Project JSON](project-context.md): focused extraction, local layout and importing diagrams.
- [Portfolio walkthrough](portfolio-walkthrough.md): demonstration flow and engineering context.
- [Local development login](local-agent-login.md): isolated development-only test accounts.
- [Operations](phase-8-operations.md): the optional deployment package and operating procedures.
- [Verification policy](verification-policy.md): the current browser/database verification deferrals.

## Before committing or pushing

Run `pnpm repo:check --outgoing` before pushing to detect scratch files, local
project diagrams, private environment files and build output in both the index
and unpublished commits since `origin/main`. `pnpm repo:check` checks only the
current index. Neither mode inspects credentials inside files or rewrites history.
Run formatting, lint, types and the focused checks relevant to the change.

Keep personal project-context files, exported diagrams and `.tmp` debugging output
locally; Git and Docker ignore them. Deliberate reusable examples belong in
`docs/examples`, and reviewed verification artifacts belong in `docs/evidence`.

## Historical plans and evidence

The [Version 1 plan](../plan.md), [phase closure](phase-8-closure.md) and
[Phase 8 evidence index](evidence/phase8/README.md) explain delivered work and the
remaining acceptance boundaries. Historical records describe their original
source/commit and verification scope; they are not current release proof.

Hosted AI is retired. Its [plan](../plan-ai.md), [implementation guide](../guide.md),
[usage guide](using-ai.md) and [evidence index](evidence/ai/README.md) remain as
historical references for the dormant implementation. Use Project JSON for the
active diagram-import workflow.
