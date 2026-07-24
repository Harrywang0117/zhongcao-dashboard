const SHARED_STATE_KEY = "shared";

export class StateConflictError extends Error {
  constructor(latest) {
    super("共享数据已被其他设备更新");
    this.name = "StateConflictError";
    this.latest = latest;
  }
}

export class StateRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StateRepositoryError";
    this.code = code;
  }
}

export function createStateRepository(pool, { historyLimit = 50 } = {}) {
  if (!pool) return null;
  if (!Number.isInteger(historyLimit) || historyLimit < 1) {
    throw new Error("historyLimit 必须是正整数");
  }

  return {
    async checkReady() {
      try {
        const schemaResult = await pool.query(`
          SELECT
            to_regclass('public.app_state') IS NOT NULL AS has_state_table,
            to_regclass('public.app_state_revisions') IS NOT NULL AS has_revision_table
        `);
        const schema = schemaResult.rows[0];
        if (!schema?.has_state_table || !schema?.has_revision_table) {
          return { ready: false, reason: "schema_missing" };
        }

        const stateResult = await pool.query(`
          SELECT EXISTS (
            SELECT 1
            FROM app_state
            WHERE state_key = $1
          ) AS has_shared_state
        `, [SHARED_STATE_KEY]);
        const row = stateResult.rows[0];
        return {
          ready: Boolean(row?.has_shared_state),
          reason: "state_not_initialized"
        };
      } catch {
        return { ready: false, reason: "database_unavailable" };
      }
    },

    async getState() {
      const result = await pool.query(`
        SELECT state, revision, updated_at
        FROM app_state
        WHERE state_key = $1
      `, [SHARED_STATE_KEY]);
      if (!result.rowCount) {
        throw new StateRepositoryError("state_not_initialized", "共享状态尚未初始化");
      }
      return mapStateRow(result.rows[0]);
    },

    async putState({ state, expectedRevision }) {
      const client = await pool.connect();
      let finished = false;
      try {
        await client.query("BEGIN");
        const currentResult = await client.query(`
          SELECT state, revision, updated_at
          FROM app_state
          WHERE state_key = $1
          FOR UPDATE
        `, [SHARED_STATE_KEY]);

        if (!currentResult.rowCount) {
          throw new StateRepositoryError("state_not_initialized", "共享状态尚未初始化");
        }

        const current = mapStateRow(currentResult.rows[0]);
        if (current.revision !== expectedRevision) {
          await client.query("ROLLBACK");
          finished = true;
          throw new StateConflictError(current);
        }

        await client.query(`
          INSERT INTO app_state_revisions (state_key, revision, state)
          VALUES ($1, $2, $3::jsonb)
        `, [SHARED_STATE_KEY, current.revision, JSON.stringify(current.state)]);

        const updatedResult = await client.query(`
          UPDATE app_state
          SET state = $2::jsonb,
              revision = revision + 1,
              updated_at = now()
          WHERE state_key = $1
          RETURNING state, revision, updated_at
        `, [SHARED_STATE_KEY, JSON.stringify(state)]);

        await client.query(`
          DELETE FROM app_state_revisions
          WHERE id IN (
            SELECT id
            FROM app_state_revisions
            WHERE state_key = $1
            ORDER BY revision DESC
            OFFSET $2
          )
        `, [SHARED_STATE_KEY, historyLimit]);

        await client.query("COMMIT");
        finished = true;
        return mapStateRow(updatedResult.rows[0]);
      } catch (error) {
        if (!finished) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Preserve the original error; the connection will be released below.
          }
        }
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

function mapStateRow(row) {
  return {
    state: row.state,
    revision: Number(row.revision),
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at || "")
  };
}
