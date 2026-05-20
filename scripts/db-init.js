const fs = require("node:fs");
const path = require("node:path");
const { withClient } = require("../modules/db");

(async () => {
  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, "");
  await withClient(async (client) => {
    await client.query(schema);
  });
  console.log("Database schema is aangemaakt/bijgewerkt.");
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});


