# Backend coding guidelines

These rules apply to `apps/api` for new code and code changed by the requested task.
Do not refactor unrelated code solely to satisfy this guide. Explicit user
instructions take precedence; explain a necessary departure briefly.

## Start here

1. Read the route or service being changed, its nearest tests, and the relevant
   contracts in `packages/contracts` before editing.
2. Look for an existing feature service, repository, transaction helper, schema,
   error mapper, or Nest provider before adding another one.
3. Check `phase3.md` and `guide2.md` when working on a Phase 3 milestone. Preserve
   their route, security, transaction, and evidence requirements.
4. Keep the change within the existing feature and platform structure. Do not add
   a parallel HTTP framework, ORM, validation system, or dependency container.

## NestJS structure and request handling

- Keep controllers thin: bind HTTP data, validate it with the shared contract,
  require the actor, call an application service, and serialize the documented
  response. Put authorization and business rules in application services; put
  database access in infrastructure adapters.
- Register controllers and providers through Nest modules. Use constructor
  injection and explicit provider tokens for interfaces or external runtimes.
  Prefer feature-owned providers and exports over reaching across module internals.
- Use the shared Zod schemas as the source of truth for body, query, path, header,
  and response shapes. Reject unknown request fields. Do not create a second DTO
  or `class-validator` definition for an existing contract.
- Reuse or extend central pipes, guards, filters, and interceptors for cross-route
  behavior. Avoid duplicating request IDs, error mapping, or logging in each
  controller. Keep `/api/auth/*` under Better Auth's ownership.
- Return the standard `{ data: ... }` or collection envelope and mapped API error
  envelope for product routes. Never return a TypeORM entity, raw exception,
  stack trace, SQL detail, or a response with undocumented fields.
- Preserve authentication, CSRF/origin rules, idempotency, and no-disclosure
  responses. Validate and bound untrusted input before expensive application work.
  Never infer authorization from a client-provided role or board ID alone.
- Log only safe structured fields such as request ID, route template, status,
  duration, safe error code, and validated IDs where permitted. Do not log request
  bodies, cookies, emails, board content, tokens, token digests, or token-bearing
  URLs.

## TypeORM and PostgreSQL

- Prefer TypeORM repository and `EntityManager` methods (`findOne`, `find`,
  `insert`, `update`, `delete`, `upsert`) for ordinary reads and writes. Use
  QueryBuilder for joins, projections, cursor pagination, conditional updates,
  and row locks. Keep queries in feature infrastructure, not controllers or
  application services.
- Do not add raw SQL when TypeORM can express the query clearly and preserve its
  required atomicity and performance. For PostgreSQL-specific operations that
  TypeORM cannot express adequately, use a small, documented, parameterized SQL
  statement in infrastructure. Explain the need in a code comment or test. Raw
  SQL remains appropriate in migrations and schema verification.
- Use bind parameters for all untrusted values, including QueryBuilder clauses.
  Never interpolate user input into SQL identifiers or fragments. Select only
  fields needed for the result; avoid `SELECT *` and unnecessary relation loading.
- Run every query in a multi-record operation through the same transaction-scoped
  `QueryRunner.manager` or transaction manager. Never use a global repository
  inside that transaction. Release manually created runners in `finally`.
- Preserve the project's documented lock order and database constraints. Use
  QueryBuilder's pessimistic lock support inside a transaction when row locking
  is needed. Do not replace database coordination with an in-process mutex.
- Let PostgreSQL provide authoritative lifecycle timestamps and enforce durable
  invariants. Add forward migrations for schema changes; do not edit applied
  migrations or enable schema synchronization to make tests pass.

## Tests and handoff

- Test application rules at the service boundary and HTTP contracts through the
  Nest application. Use real PostgreSQL integration tests for transaction,
  locking, constraint, rollback, and migration behavior; mocks cannot prove those.
- Cover meaningful error and permission paths, especially cross-board access,
  unauthenticated requests, malformed input, and secret redaction when relevant.
  Avoid tests that only repeat the implementation.
- Run the checks required by the active milestone, plus focused checks for changed
  code. Report what passed and any material limitation. Do not add dependencies
  or rewrite unrelated code for a local change.
