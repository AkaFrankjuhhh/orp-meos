const fs = require("node:fs");
const path = require("node:path");

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
  const sslEnabled = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true";
  return {
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized: false } : false
  };
}

function createPool() {
  const { Pool } = requirePg();
  return new Pool(databaseConfig());
}

async function withClient(callback) {
  const pool = createPool();
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { loadEnv, createPool, withClient };
