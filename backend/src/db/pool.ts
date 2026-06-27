import pg from "pg";

const { Pool } = pg;

function buildConfig(): pg.PoolConfig {
  const url = process.env["DATABASE_URL"];
  if (url) {
    return { connectionString: url };
  }

  return {
    host: process.env["DB_HOST"] ?? "localhost",
    port: Number(process.env["DB_PORT"] ?? "5432"),
    user: process.env["DB_USER"] ?? "safebuilding",
    password: process.env["DB_PASSWORD"] ?? "safebuilding_dev",
    database: process.env["DB_NAME"] ?? "safebuilding"
  };
}

export const pool = new Pool(buildConfig());

pool.on("error", (err: Error) => {
  console.error("PostgreSQL pool error:", err.message);
});
