const { withClient, closePool } = require("../modules/db");

(async () => {
  await withClient(async (client) => {
    const duplicates = await client.query(`
      select discord_id
      from people
      where coalesce(trim(discord_id), '') <> ''
      group by discord_id
      having count(*) > 1
    `);
    if (duplicates.rowCount) {
      throw new Error("Er zijn nog dubbele Discord IDs. Draai eerst: npm run db:discord-identity:check");
    }
    await client.query(`
      create unique index if not exists people_discord_id_unique_idx
      on people(discord_id)
      where coalesce(trim(discord_id), '') <> ''
    `);
  });
  console.log("Unieke Discord-ID bescherming is ingeschakeld.");
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => closePool());
