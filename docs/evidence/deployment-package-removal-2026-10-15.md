# Remove unused deployment packaging

October 15, 2026. The user requested removal of the optional `ops` package.

- Remove `ops/`, its Docker/Compose/Caddy files and generated headers, the unused
  `.dockerignore`, and deployment-only checks under `scripts/ops`.
- Retain the API process-test target guard and its existing negative test under
  `scripts/security/process-proof-target*`. Update the prepared API harness import.
  The test exercises only URL/confirmation validation and never connects to a DB.
- Update README, setup, documentation navigation and the portfolio walkthrough.
  The former operations runbook is explicitly historical and links to its source
  snapshot. The earlier personal feature audit keeps its original observations
  with a dated retirement note.
- Preserve the pre-existing user deletion of `guide.md`. Repair its 18 relative
  links with immutable GitHub snapshot URLs, keeping the historical text and
  results unchanged.

The application runtime, package dependencies, database migrations, client security
policy and ordinary development/build commands are unchanged. Legacy secret-path
ignore rules remain protective; they are not dependencies on the removed package.
Both removed directory paths were resolved inside the workspace and checked for
unreviewed files before their empty directory trees were removed.

| Check                                                  | Result                                         |
| ------------------------------------------------------ | ---------------------------------------------- |
| Full repository formatting and ESLint                  | PASS                                           |
| Security policy and retained process-target Node tests | PASS — seven tests, database-free              |
| Prepared API harness syntax                            | PASS — `node --check`, no execution            |
| Dependency boundaries and negative fixtures            | PASS                                           |
| Active code/current usage guide scan                   | PASS — no deleted deployment-file dependencies |
| Markdown local destinations and archived Git targets   | PASS — no missing destinations                 |
| Diff whitespace                                        | PASS                                           |

Browser acceptance: **UNRUN (deferred by user)**.
Database-backed process, HTTP/auth/session/socket, integration and schema/migration
checks: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
No Docker services, database connections, migrations, browser sessions or deployment
were started. Historical phase/release acceptance gates remain **OPEN**.
