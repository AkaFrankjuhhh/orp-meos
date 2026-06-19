const fs = require("node:fs");
const path = require("node:path");

let sharedPool = null;
const configuredClients = new WeakSet();

function normalizeOrganizationKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (["politie", "police"].includes(key)) return "politie";
  return "defensie";
}

function currentOrganizationKey() {
  return normalizeOrganizationKey(process.env.ORP_ORGANIZATION || process.env.PORTAL_ORGANIZATION || process.env.ORGANIZATION || "defensie");
}

function databaseNameFromConnectionString(connectionString) {
  try {
    const url = new URL(connectionString);
    return decodeURIComponent(String(url.pathname || "").replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

function validateDatabaseOrganizationMatch(connectionString) {
  if (String(process.env.ORP_ALLOW_CROSS_ORG_DATABASE || "false").toLowerCase() === "true") return;
  const organizationKey = currentOrganizationKey();
  const databaseName = databaseNameFromConnectionString(connectionString).toLowerCase();
  if (!databaseName) return;

  if (organizationKey === "politie" && databaseName.includes("defensie")) {
    throw new Error("DATABASE_URL wijst naar een defensie database terwijl ORP_ORGANIZATION=politie. Gebruik bijvoorbeeld database 'politie_portaal' in .env.politie.");
  }
  if (organizationKey === "defensie" && databaseName.includes("politie")) {
    throw new Error("DATABASE_URL wijst naar een politie database terwijl ORP_ORGANIZATION=defensie. Gebruik bijvoorbeeld database 'defensie_portal' in .env.");
  }
}

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function requirePg() {
  try {
    return require("pg");
  } catch (error) {
    throw new Error("PostgreSQL dependency ontbreekt. Draai eerst: npm install");
  }
}

function databaseConfig() {
  loadEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL ontbreekt in .env. Voor lokaal: postgres://postgres:WACHTWOORD@localhost:5432/personeelsportaal");
  }
  validateDatabaseOrganizationMatch(connectionString);
  const sslEnabled = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true";
  const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX || 4);
  return {
    connectionString,
    // Elke systemd-service heeft een eigen pool. Een bescheiden standaard voorkomt
    // dat portaal-, Porto- en workerprocessen samen PostgreSQL uitputten.
    max: Number.isFinite(configuredPoolMax) ? Math.min(Math.max(Math.floor(configuredPoolMax), 1), 20) : 4,
    idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DATABASE_POOL_CONNECT_MS || 10000),
    ssl: sslEnabled ? { rejectUnauthorized: false } : false
  };
}

function databaseRuntimeTimeouts() {
  return {
    statementTimeoutMs: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 15000),
    lockTimeoutMs: Number(process.env.DATABASE_LOCK_TIMEOUT_MS || 5000),
    idleTransactionTimeoutMs: Number(process.env.DATABASE_IDLE_TX_TIMEOUT_MS || 10000)
  };
}

function createPool() {
  if (sharedPool) return sharedPool;
  const { Pool } = requirePg();
  sharedPool = new Pool(databaseConfig());
  sharedPool.on("error", (error) => {
    console.error("PostgreSQL pool error:", error.message || error);
  });
  return sharedPool;
}

async function withClient(callback) {
  const pool = createPool();
  const client = await pool.connect();
  try {
    if (!configuredClients.has(client)) {
      const timeouts = databaseRuntimeTimeouts();
      await client.query("select set_config('statement_timeout', $1, false)", [`${Math.max(0, timeouts.statementTimeoutMs || 0)}ms`]);
      await client.query("select set_config('lock_timeout', $1, false)", [`${Math.max(0, timeouts.lockTimeoutMs || 0)}ms`]);
      await client.query("select set_config('idle_in_transaction_session_timeout', $1, false)", [`${Math.max(0, timeouts.idleTransactionTimeoutMs || 0)}ms`]);
      configuredClients.add(client);
    }
    return await callback(client);
  } finally {
    client.release();
  }
}

async function withTransaction(callback) {
  return withClient(async (client) => {
    await client.query("begin");
    try {
      const result = await callback(client);
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch (rollbackError) {
        console.error("PostgreSQL rollback mislukt:", rollbackError.message || rollbackError);
      }
      throw error;
    }
  });
}

async function closePool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.end();
}

module.exports = {
  loadEnv,
  createPool,
  withClient,
  withTransaction,
  closePool,
  databaseNameFromConnectionString,
  validateDatabaseOrganizationMatch
};
