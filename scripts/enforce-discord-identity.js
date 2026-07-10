const { withClient, closePool } = require("../modules/db");

(async () => {
  await withClient(async (client) => {
    const duplicates = await client.query(`
      select discord_id
      from people
      where coalesce(trim(discord_id), '') <> ''
        and lower(coalesce(status, 'Actief')) not in ('inactief', 'ontslagen', 'gearchiveerd', 'archief', 'blacklist', 'geblacklist')
      group by discord_id
      having count(*) > 1
    `);
    if (duplicates.rowCount) {
      throw new Error("Er zijn nog dubbele Discord IDs. Draai eerst: npm run db:discord-identity:check");
    }
    await client.query(`
      create unique index if not exists people_current_discord_id_unique_idx
      on people(discord_id)
      where coalesce(trim(discord_id), '') <> ''
        and lower(coalesce(status, 'Actief')) not in ('inactief', 'ontslagen', 'gearchiveerd', 'archief', 'blacklist', 'geblacklist')
    `);
  });
  console.log("Unieke Discord-ID bescherming is ingeschakeld voor actuele profielen.");
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => closePool());
