import { readFile } from 'node:fs/promises';
import { MigrationExecutor, type DataSource, type Table } from 'typeorm';

const AUTH_TABLE_COUNT = 4;

function hasUnique(table: Table, columns: readonly string[]): boolean {
  return [...table.uniques, ...table.indices.filter((index) => index.isUnique)].some(
    (constraint) =>
      constraint.columnNames.length === columns.length &&
      columns.every((column) => constraint.columnNames.includes(column)),
  );
}

/** Read-only runtime compatibility; neither synchronizes nor creates migration state. */
export async function schemaCompatible(source: DataSource): Promise<boolean> {
  const executed = await new MigrationExecutor(source).getExecutedMigrations();
  const expected = source.migrations.map(
    (migration) => migration.name ?? migration.constructor.name,
  );
  if (
    executed.length !== expected.length ||
    new Set(executed.map((migration) => migration.name)).size !== expected.length ||
    executed.some((migration) => !expected.includes(migration.name))
  )
    return false;
  const runner = source.createQueryRunner();
  try {
    for (const metadata of source.entityMetadatas) {
      const table = await runner.getTable(metadata.tablePath);
      if (!table) return false;
      for (const column of metadata.columns) {
        const actual = table.columns.find((value) => value.name === column.databaseName);
        if (
          !actual ||
          actual.type !== source.driver.normalizeType(column) ||
          actual.isNullable !== column.isNullable ||
          actual.isPrimary !== column.isPrimary ||
          actual.isArray !== column.isArray
        )
          return false;
      }
      for (const unique of [
        ...metadata.uniques,
        ...metadata.indices.filter((index) => index.isUnique),
      ])
        if (
          !hasUnique(
            table,
            unique.columns.map((column) => column.databaseName),
          )
        )
          return false;
      for (const key of metadata.foreignKeys)
        if (
          !table.foreignKeys.some(
            (actual) =>
              actual.columnNames.join() === key.columnNames.join() &&
              actual.referencedColumnNames.join() === key.referencedColumnNames.join() &&
              actual.referencedTableName.split('.').at(-1) ===
                key.referencedTablePath.split('.').at(-1),
          )
        )
          return false;
    }
    const auth = await readFile(new URL('./auth-schema.sql', import.meta.url), 'utf8');
    const statements = [...auth.matchAll(/create table "([^"]+)" \((.*?)\);/g)];
    if (statements.length !== AUTH_TABLE_COUNT) return false;
    for (const statement of statements) {
      const table = await runner.getTable(statement[1]!);
      if (!table) return false;
      for (const definition of statement[2]!.matchAll(
        /(?:^|,\s*)"([^"]+)"\s+(text|boolean|timestamptz)([^,]*)/g,
      )) {
        const actual = table.columns.find((column) => column.name === definition[1]);
        const type = definition[2] === 'timestamptz' ? 'timestamp with time zone' : definition[2];
        if (
          !actual ||
          actual.type !== type ||
          actual.isNullable !== !definition[3]!.includes('not null')
        )
          return false;
        if (definition[3]!.includes('primary key') && !actual.isPrimary) return false;
        if (definition[3]!.includes('unique') && !hasUnique(table, [definition[1]!])) return false;
        const reference = /references "([^"]+)" \("([^"]+)"\) on delete cascade/.exec(
          definition[3]!,
        );
        if (
          reference &&
          !table.foreignKeys.some(
            (key) =>
              key.columnNames.join() === definition[1] &&
              key.referencedTableName.split('.').at(-1) === reference[1] &&
              key.referencedColumnNames.join() === reference[2] &&
              key.onDelete === 'CASCADE',
          )
        )
          return false;
      }
    }
    return true;
  } finally {
    await runner.release();
  }
}
