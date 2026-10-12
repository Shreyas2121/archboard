import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { jest } from '@jest/globals';
import {
  DataSource,
  MigrationExecutor,
  Table,
  TableColumn,
  TableForeignKey,
  TableUnique,
  type QueryRunner,
} from 'typeorm';
import { DATABASE_ENTITIES } from './database-entities.js';
import { schemaCompatible } from './schema-compatibility.js';

class OfflineSource extends DataSource {
  public buildOffline(): Promise<void> {
    return this.buildMetadatas();
  }
}

describe('runtime schema compatibility (offline metadata, no database)', () => {
  afterEach(() => jest.restoreAllMocks());
  async function fixture() {
    const source = new OfflineSource({
      type: 'postgres',
      entities: [...DATABASE_ENTITIES],
      migrations: [],
      synchronize: false,
    });
    await source.buildOffline();
    const tables = new Map(
      source.entityMetadatas.map((metadata) => [
        metadata.tablePath,
        Table.create(metadata, source.driver),
      ]),
    );
    const auth = await readFile(new URL('./auth-schema.sql', import.meta.url), 'utf8');
    for (const statement of auth.matchAll(/create table "([^"]+)" \((.*?)\);/g)) {
      const table = new Table({ name: statement[1]! });
      for (const definition of statement[2]!.matchAll(
        /(?:^|,\s*)"([^"]+)"\s+(text|boolean|timestamptz)([^,]*)/g,
      )) {
        const name = definition[1]!;
        table.addColumn(
          new TableColumn({
            name,
            type: definition[2] === 'timestamptz' ? 'timestamp with time zone' : definition[2]!,
            isNullable: !definition[3]!.includes('not null'),
            isPrimary: definition[3]!.includes('primary key'),
          }),
        );
        if (definition[3]!.includes('unique'))
          table.addUniqueConstraint(new TableUnique({ columnNames: [name] }));
        const reference = /references "([^"]+)" \("([^"]+)"\)/.exec(definition[3]!);
        if (reference)
          table.addForeignKey(
            new TableForeignKey({
              columnNames: [name],
              referencedTableName: reference[1]!,
              referencedColumnNames: [reference[2]!],
              onDelete: 'CASCADE',
            }),
          );
      }
      tables.set(table.name, table);
    }
    const release = jest.fn(async () => undefined);
    const getTables = jest.fn(async (names: string[]) =>
      names.flatMap((name) => {
        const table = tables.get(name);
        return table ? [table] : [];
      }),
    );
    const runner = {
      getTables,
      release,
    } as unknown as QueryRunner;
    jest.spyOn(source, 'createQueryRunner').mockReturnValue(runner);
    const migrations = jest
      .spyOn(MigrationExecutor.prototype, 'getExecutedMigrations')
      .mockResolvedValue([]);
    return { source, tables, release, migrations, getTables };
  }
  it('accepts the current product/auth metadata without initializing a connection', async () => {
    const { source, release, getTables, tables } = await fixture();
    expect(await schemaCompatible(source)).toBe(true);
    expect(source.isInitialized).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(getTables).toHaveBeenCalledTimes(1);
    expect(new Set(getTables.mock.calls[0]![0])).toEqual(new Set(tables.keys()));
  });
  it.each(['checkpoints', 'comments', 'session'])(
    'rejects a missing %s table and releases its runner',
    async (name) => {
      const { source, tables, release } = await fixture();
      expect(tables.delete(name)).toBe(true);
      expect(await schemaCompatible(source)).toBe(false);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects an auth constraint/type mismatch', async () => {
    const { source, tables } = await fixture();
    tables.get('session')!.foreignKeys = [];
    expect(await schemaCompatible(source)).toBe(false);
    tables.get('user')!.columns.find((column) => column.name === 'emailVerified')!.type = 'text';
    expect(await schemaCompatible(source)).toBe(false);
  });
  it('rejects unknown migration history before inspecting tables', async () => {
    const { source, migrations, release, getTables } = await fixture();
    migrations.mockResolvedValue([{ id: 1, timestamp: 1, name: 'UnknownMigration1' }]);
    expect(await schemaCompatible(source)).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(getTables).not.toHaveBeenCalled();
  });
  it('releases the runner if the batch catalog read fails', async () => {
    const { source, getTables, release } = await fixture();
    getTables.mockRejectedValue(new Error('catalog unavailable'));
    await expect(schemaCompatible(source)).rejects.toThrow('catalog unavailable');
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('matches a qualified table path when TypeORM omits the current schema from its name', async () => {
    const { source, tables } = await fixture();
    const metadata = source.entityMetadatas.find((entry) => entry.tablePath === 'boards')!;
    const table = tables.get('boards')!;
    metadata.tablePath = 'public.boards';
    table.schema = 'public';
    tables.delete('boards');
    tables.set('public.boards', table);
    expect(await schemaCompatible(source)).toBe(true);
  });
});
