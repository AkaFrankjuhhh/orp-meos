const fs = require("node:fs");
const path = require("node:path");
const { readPostgresState } = require("../modules/postgres-state");

const outputPath = process.argv[2] || path.join(__dirname, "..", "db", "postgres-state-export.json");

(async () => {
  const state = await readPostgresState();
  fs.writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`PostgreSQL state export geschreven naar ${outputPath}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
