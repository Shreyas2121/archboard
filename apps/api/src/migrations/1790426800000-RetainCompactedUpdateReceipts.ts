import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Receipts outlive update-log rows so a delayed retry can recover its original sequence. */
export class RetainCompactedUpdateReceipts1790426800000 implements MigrationInterface {
  public readonly name = 'RetainCompactedUpdateReceipts1790426800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "update_receipts"
        DROP CONSTRAINT "update_receipts_board_id_update_id_fkey",
        DROP CONSTRAINT "update_receipts_board_id_seq_fkey";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "update_receipts"
        ADD CONSTRAINT "update_receipts_board_id_update_id_fkey"
          FOREIGN KEY ("board_id", "update_id")
          REFERENCES "board_updates" ("board_id", "update_id") ON DELETE CASCADE,
        ADD CONSTRAINT "update_receipts_board_id_seq_fkey"
          FOREIGN KEY ("board_id", "seq")
          REFERENCES "board_updates" ("board_id", "seq") ON DELETE CASCADE;
    `);
  }
}
