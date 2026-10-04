/** Safe, explicit result-column observation. Does not parse SQL or discover unknown data. */
export function postgresAdapter({ pool, lineage, maxRows = 1000 }) {
  if (!pool || typeof pool.query !== 'function' || !lineage || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000) throw new Error('Invalid PostgreSQL adapter configuration');
  return {
    async query({ query, canaries, table, column, field = column, operation }) {
      if (!['SELECT', 'INSERT', 'UPDATE'].includes(operation) || ![table,column,field].every(v => typeof v === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(v))) throw new Error('Explicit query mapping required');
      // The host owns SQL/transactions. SQL and parameters never enter event metadata.
      const result = await pool.query(query);
      if (!Array.isArray(result.rows)) { lineage.reportIssue('UNSUPPORTED_QUERY_RESULT'); return result; }
      if (result.rows.length > maxRows) lineage.reportIssue('ROW_INSPECTION_LIMIT');
      const values = new Set(result.rows.slice(0, maxRows).map(row => row[field]));
      const found = canaries.filter(ref => ref && values.has(ref.value));
      if (found.length) lineage.observe({
        type: operation === 'SELECT' ? 'DATABASE_READ' : 'DATABASE_WRITE',
        location: `PostgreSQL: ${table}.${column}`, canaries: found, status: 'success',
        metadata: { table, column, operation },
      });
      return result;
    },
  };
}

/** Separate SDK trace table; call initialize explicitly, never at import time. */
export function postgresTraceStore(pool) {
  return {
    mode: 'postgres',
    async initialize() {
      await pool.query('CREATE TABLE IF NOT EXISTS canary_sdk_segments (trace_id UUID NOT NULL, segment_id UUID NOT NULL, document JSONB NOT NULL, PRIMARY KEY (trace_id, segment_id))');
      await pool.query('CREATE TABLE IF NOT EXISTS canary_sdk_traces (id UUID PRIMARY KEY, document JSONB NOT NULL)');
    },
    async saveTrace(trace) {
      if (trace.segmentId) {
        await pool.query('INSERT INTO canary_sdk_segments (trace_id, segment_id, document) VALUES ($1, $2, $3::jsonb) ON CONFLICT (trace_id, segment_id) DO UPDATE SET document = EXCLUDED.document',[trace.id,trace.segmentId,JSON.stringify(trace)]);
        return;
      }
      await pool.query('INSERT INTO canary_sdk_traces (id, document) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document', [trace.id, JSON.stringify(trace)]);
    },
    async getSegments(id) {
      const {rows}=await pool.query('SELECT document FROM canary_sdk_segments WHERE trace_id = $1 ORDER BY segment_id',[id]);
      return rows.map(row=>row.document);
    },
    async getTrace(id) {
      const { rows } = await pool.query('SELECT document FROM canary_sdk_traces WHERE id = $1', [id]);
      return rows[0]?.document ?? null;
    },
  };
}
