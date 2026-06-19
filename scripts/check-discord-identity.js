const { withClient, closePool } = require("../modules/db");

(async () => {
  const duplicates = await withClient(async (client) => {
    const result = await client.query(`
      select discord_id, array_agg(id order by updated_at desc) as person_ids, count(*)::int as count
      from people
      where coalesce(trim(discord_id), '') <> ''
      group by discord_id
      having count(*) > 1
      order by count(*) desc, discord_id asc
    `);
    return result.rows;
  });
  if (duplicates.length) {
    console.error("Dubbele Discord IDs gevonden. Los deze op voordat een unieke database-index wordt ingeschakeld:");
    for (const row of duplicates) console.error(`- ${row.discord_id}: ${row.person_ids.join(", ")}`);
    throw new Error("Dubbele Discord IDs gevonden.");
  }
  console.log("Geen dubbele Discord IDs gevonden. Nieuwe aanmaak wordt ook al door de applicatie geblokkeerd.");
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => closePool());
