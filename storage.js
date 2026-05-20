const fs = require("node:fs");
const path = require("node:path");
const { readPostgresState } = require("./modules/postgres-state");

const backupIntervalMs = 60 * 1000;
const maxBackupFiles = 30;

let lastBackupAt = 0;

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) fs.mkdirSync(directoryPath, { recursive: true });
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function cleanupBackups(backupDirectory) {
  if (!fs.existsSync(backupDirectory)) return;
  const backups = fs.readdirSync(backupDirectory)
    .filter((file) => /^data-\d{4}-\d{2}-\d{2}T/.test(file) && file.endsWith(".json"))
    .map((file) => ({
      file,
      path: path.join(backupDirectory, file),
      time: fs.statSync(path.join(backupDirectory, file)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time);

  backups.slice(maxBackupFiles).forEach((backup) => {
    try {
      fs.unlinkSync(backup.path);
    } catch {
      // Backup cleanup mag nooit het opslaan van live data blokkeren.
    }
  });
}

// Maak maximaal eens per minuut een herstelpunt, zodat veel live updates niet eindeloos backups spammen.
function createBackup(dataPath, backupDirectory) {
  if (!fs.existsSync(dataPath)) return;
  const now = Date.now();
  if (now - lastBackupAt < backupIntervalMs) return;

  ensureDirectory(backupDirectory);
  const backupPath = path.join(backupDirectory, `data-${timestampForFile()}.json`);
  fs.copyFileSync(dataPath, backupPath);
  lastBackupAt = now;
  cleanupBackups(backupDirectory);
}

function latestBackupPath(backupDirectory) {
  if (!fs.existsSync(backupDirectory)) return "";
  const latest = fs.readdirSync(backupDirectory)
    .filter((file) => /^data-\d{4}-\d{2}-\d{2}T/.test(file) && file.endsWith(".json"))
    .map((file) => ({
      path: path.join(backupDirectory, file),
      time: fs.statSync(path.join(backupDirectory, file)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time)[0];
  return latest?.path || "";
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}



function createPostgresReadStorage() {
  // Algemene state-reads gaan direct naar PostgreSQL. Schrijfacties lopen via domein-specifieke stores.
  async function readState() {
    return readPostgresState();
  }

  function writeState() {
    throw new Error("Algemene PostgreSQL state writes zijn uitgeschakeld. Gebruik de gerichte API stores.");
  }

  function resetStateCache() {
    // Directe PostgreSQL reads hebben geen proces-cache om te legen.
  }

  return { readState, writeState, resetStateCache };
}

function createJsonStorage(dataPath, options = {}) {
  const backupDirectory = options.backupDirectory || path.join(path.dirname(dataPath), "backups");
  let liveState = null;
  let writeVersion = 0;

  function loadFromDisk() {
    try {
      return readJsonFile(dataPath);
    } catch (error) {
      const backupPath = latestBackupPath(backupDirectory);
      if (!backupPath) throw error;
      return readJsonFile(backupPath);
    }
  }

  function readState() {
    if (!liveState) liveState = loadFromDisk();
    return liveState;
  }

  function writeState(state = liveState) {
    liveState = state || liveState || loadFromDisk();
    ensureDirectory(path.dirname(dataPath));
    createBackup(dataPath, backupDirectory);

    // Schrijf eerst naar een tijdelijk bestand en vervang daarna pas data.json, zodat data.json nooit half geschreven is.
    const payload = JSON.stringify(liveState, null, 2);
    const tempPath = path.join(path.dirname(dataPath), `.data-${process.pid}-${Date.now()}-${++writeVersion}.tmp`);
    fs.writeFileSync(tempPath, payload, "utf8");
    fs.renameSync(tempPath, dataPath);
    return liveState;
  }

  function resetStateCache() {
    liveState = null;
  }

  return { readState, writeState, resetStateCache };
}

module.exports = { createJsonStorage, createPostgresReadStorage };
