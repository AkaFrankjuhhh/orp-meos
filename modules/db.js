const fs = require("node:fs");
const path = require("node:path");

let sharedPool = null;

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
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DATABASE_POOL_CONNECT_MS || 10000),
    ssl: sslEnabled ? { rejectUnauthorized: false } : false
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
    return await callback(client);
  } finally {
    client.release();
  }
}

async function closePool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.end();
}

module.exports = { loadEnv, createPool, withClient, closePool };