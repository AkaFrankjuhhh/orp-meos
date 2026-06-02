const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, withClient, closePool } = require('../modules/db');

loadEnv();

const requiredEnv = [
  'APP_BASE_URL',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
  'DISCORD_DEFENSIE_ROLE_ID',
  'DATABASE_URL'
];

function mask(value) {
  if (!value) return '';
  return value.replace(/:[^:@/]+@/, ':***@');
}

(async () => {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  const warnings = [];
  const storageMode = String(process.env.STORAGE_MODE || 'json').toLowerCase();
  if (storageMode !== 'postgres') warnings.push('STORAGE_MODE staat niet op postgres.');
  if (String(process.env.DEV_ALLOW_UNAUTH || '').toLowerCase() !== 'false') warnings.push('DEV_ALLOW_UNAUTH staat niet expliciet op false.');
  if (!String(process.env.APP_BASE_URL || '').startsWith('https://')) warnings.push('APP_BASE_URL gebruikt geen https URL.');

  console.log('Defensie Personeelsportaal productiecheck');
  console.log(`Storage mode: ${storageMode}`);
  console.log(`APP_BASE_URL: ${process.env.APP_BASE_URL || '-'}`);
  console.log(`DATABASE_URL: ${mask(process.env.DATABASE_URL || '') || '-'}`);

  if (missing.length) {
    console.log(`Ontbrekende env waardes: ${missing.join(', ')}`);
    process.exitCode = 1;
  }

  await withClient(async (client) => {
    const version = await client.query('select version() as version');
    const counts = await client.query(`
      select
        (select count(*) from people) as people,
        (select count(*) from absences) as absences,
        (select count(*) from i8_forms) as i8_forms,
        (select count(*) from resignation_forms) as resignation_forms,
        (select count(*) from porto_units) as porto_units,
        (select count(*) from app_sessions where expires_at > now()) as active_sessions,
        (select count(*) from hours) as hours,
        (select count(*) from discord_sync_jobs) as discord_sync_jobs
    `);
    console.log(`Database: ${version.rows[0].version.split(' on ')[0]}`);
    console.log(`Aantallen: ${JSON.stringify(counts.rows[0])}`);
    const duplicatePortoUnits = await client.query(`
      select member_id, count(*)::int as active_units
      from porto_units
      where active = true
        and member_id is not null
        and member_id <> ''
      group by member_id
      having count(*) > 1
      limit 5
    `);
    if (duplicatePortoUnits.rows.length) {
      warnings.push(`Dubbele actieve Porto-units gevonden voor ${duplicatePortoUnits.rows.length} member(s). Draai db:init of cleanup.`);
    }
    const portoUniqueIndex = await client.query("select to_regclass('public.porto_units_one_active_member_uidx') as index_name");
    if (!portoUniqueIndex.rows[0]?.index_name) {
      warnings.push('Unieke Porto active-member index ontbreekt. Draai npm run db:init.');
    }
  });

  if (warnings.length) {
    console.log('Waarschuwingen:');
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (!missing.length && !warnings.length) console.log('Productiecheck OK.');
  await closePool();
})().catch(async (error) => {
  console.error(`Productiecheck mislukt: ${error.message}`);
  await closePool().catch(() => {});
  process.exit(1);
});


