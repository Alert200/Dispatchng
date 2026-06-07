import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle DB client", err);
});

/**
 * Run a query. Usage:
 *   const { rows } = await query("SELECT * FROM users WHERE id=$1", [id])
 */
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === "development") {
    console.log("[DB]", { text: text.slice(0, 80), duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Get a client for transactions:
 *   const client = await getClient()
 *   try {
 *     await client.query("BEGIN")
 *     ...
 *     await client.query("COMMIT")
 *   } catch (e) {
 *     await client.query("ROLLBACK")
 *     throw e
 *   } finally {
 *     client.release()
 *   }
 */
export async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  // Timeout any client checked out for > 5s
  const timeout = setTimeout(() => {
    console.error("A client has been checked out for too long!");
  }, 5000);

  client.release = () => {
    clearTimeout(timeout);
    client.query = originalQuery;
    client.release = release;
    return release();
  };
  return client;
}

export default pool;
