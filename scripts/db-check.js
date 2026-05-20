const { withClient } = require("../modules/db");

(async () => {
  await withClient(async (client) => {
    const result = await client.query("select current_database() as database, current_user as user, version() as version");
    console.log(`Database verbonden: ${result.rows[0].database} als ${result.rows[0].user}`);
    console.log(result.rows[0].version.split(" ").slice(0, 2).join(" "));
  });
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
