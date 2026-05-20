const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadEnv } = require('../modules/db');

loadEnv();

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function databaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL ontbreekt in .env.');
  }
  return new URL(process.env.DATABASE_URL);
}

function pgDumpCommand() {
  const candidates = [
    'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe',
    'C:/Program Files/PostgreSQL/18/pgAdmin 4/runtime/pg_dump.exe',
    'C:/Program Files/PostgreSQL/17/bin/pg_dump.exe',
    'C:/Program Files/PostgreSQL/16/bin/pg_dump.exe',
    'C:/Program Files/PostgreSQL/15/bin/pg_dump.exe'
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'pg_dump';
}

function pgDumpArgs(url, outputPath) {
  return [
    '--host', url.hostname,
    '--port', url.port || '5432',
    '--username', decodeURIComponent(url.username),
    '--dbname', url.pathname.replace(/^\//, ''),
    '--format', 'custom',
    '--file', outputPath
  ];
}

async function run() {
  const url = databaseUrl();
  const backupDir = path.join(__dirname, '..', 'backups', 'postgres');
  fs.mkdirSync(backupDir, { recursive: true });
  const outputPath = path.join(backupDir, `pmanager-${timestampForFile()}.dump`);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password || '') };
  const child = spawn(pgDumpCommand(), pgDumpArgs(url, outputPath), { env, stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));

  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `pg_dump stopte met code ${code}`)));
  });

  console.log(`Backup gemaakt: ${outputPath}`);
}

run().catch((error) => {
  console.error(`Backup mislukt: ${error.message}`);
  console.error('Controleer of PostgreSQL client tools/pg_dump geinstalleerd zijn en in PATH staan.');
  process.exit(1);
});
