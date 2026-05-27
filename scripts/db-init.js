const fs = require("node:fs");
const path = require("node:path");
const { withClient, closePool } = require("../modules/db");

(async () => {
  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, "");
  await withClient(async (client) => {
    await client.query(schema);
  });
  console.log("Database schema is aangemaakt/bijgewerkt.");
  await closePool();
})().catch(async (error) => {
  console.error(error.message);
  await closePool().catch(() => {});
  process.exit(1);
});
