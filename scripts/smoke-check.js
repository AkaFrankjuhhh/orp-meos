const DEFAULT_TARGETS = [
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3002",
  "http://127.0.0.1:3010",
  "http://127.0.0.1:3012",
  "http://127.0.0.1:3020",
  "http://127.0.0.1:3030"
];

const PORTAL_ASSETS = [
  "/portal-boot.js",
  "/portal-client-errors.js",
  "/portal-loader-failsafe.js",
  "/boot-failsafe.js",
  "/shared.css",
  "/personeelsportaal.css",
  "/app.js"
];

const PORTO_ASSETS = [
  "/porto-config.js",
  "/shared.css",
  "/porto.css",
  "/porto.js"
];

function targetsFromArgs() {
  const args = process.argv.slice(2).filter(Boolean);
  if (args.length) return args;
  return String(process.env.SMOKE_TARGETS || "")
    .split(/[,\s]+/)
    .map((target) => target.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function checkUrl(url, { expectJson = false } = {}) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} gaf HTTP ${response.status}`);
  if (expectJson) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${url} gaf geen geldige JSON terug`);
    }
  }
  return text;
}

function assetsForHealth(health) {
  if (health.service === "portal") return PORTAL_ASSETS;
  if (health.service === "porto") return PORTO_ASSETS;
  return [];
}

async function checkTarget(baseUrl) {
  const health = await checkUrl(`${baseUrl}/api/health`, { expectJson: true });
  if (!health.ok) throw new Error(`${baseUrl}/api/health meldt ok=false`);

  const assets = assetsForHealth(health);
  for (const asset of assets) {
    await checkUrl(`${baseUrl}${asset}`);
  }

  return {
    baseUrl,
    service: health.service || "unknown",
    organization: health.organization || health.task || "",
    storageMode: health.storageMode || "",
    database: health.database?.checked ? (health.database.ok ? "ok" : "fout") : "n.v.t.",
    assets: assets.length
  };
}

async function main() {
  const targets = (targetsFromArgs().length ? targetsFromArgs() : DEFAULT_TARGETS).map(normalizeBaseUrl);
  let failed = 0;

  for (const target of targets) {
    try {
      const result = await checkTarget(target);
      console.log(`[ok] ${result.baseUrl} ${result.service}${result.organization ? `/${result.organization}` : ""} db=${result.database} assets=${result.assets}`);
    } catch (error) {
      failed += 1;
      console.error(`[fail] ${target} ${error.message}`);
    }
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
