const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, withClient } = require('../modules/db');

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
        (select count(*) from hours) as hours
    `);
    console.log(`Database: ${version.rows[0].version.split(' on ')[0]}`);
    console.log(`Aantallen: ${JSON.stringify(counts.rows[0])}`);
  });

  if (warnings.length) {
    console.log('Waarschuwingen:');
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (!missing.length && !warnings.length) console.log('Productiecheck OK.');
})().catch((error) => {
  console.error(`Productiecheck mislukt: ${error.message}`);
  process.exit(1);
});
