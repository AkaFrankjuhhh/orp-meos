# Data-opslag pManager en Porto

pManager en het Porto-Systeem worden behandeld als twee losse websites binnen hetzelfde project.
Ze delen dezelfde Discord-login, personeelsprofielen en PostgreSQL database.

## Huidige live-opzet

Voor livegebruik is de gewenste instelling:

```env
STORAGE_MODE=postgres
```

In deze modus leest de algemene applicatiestate direct uit PostgreSQL. Schrijfacties lopen via gerichte stores:

- `modules/porto-postgres-store.js` voor Porto, OPS, statussen, voertuigen en koppels.
- `modules/pmanager-postgres-forms-store.js` voor afwezigheid en I8 formulieren.
- `modules/pmanager-postgres-people-store.js` voor personeel, profielen, trainingen, badges, sancties, W&S, ontslag, herintrede en uren.

Hierdoor hoeft de server niet meer via een tijdelijke JSON-export/import brug te werken.

## data.json

`data.json` blijft alleen handig als:

- lokale fallback;
- handmatige noodkopie;
- eenmalige importbron met `npm run db:import-json`.

Wanneer `STORAGE_MODE=postgres` actief is, wordt nieuwe live-data niet meer teruggeschreven naar `data.json`.
De database is dan leidend.

## Belangrijke scripts

```powershell
npm run db:check
npm run db:init
npm run db:import-json
npm run db:export-state
npm run db:compare-json
npm run prod:check
```

`db:compare-json` kan verschillen tonen zodra de site in PostgreSQL-modus is gebruikt. Dat is normaal: `data.json` loopt dan achter op de database.

## Productieadvies

- Zet `DEV_ALLOW_UNAUTH=false`.
- Gebruik `APP_BASE_URL=https://jouwdomein.nl`.
- Zet de Discord callback op `https://jouwdomein.nl/auth/discord/callback`.
- Draai de Node server via PM2/systemd/Windows service.
- Maak dagelijkse PostgreSQL backups.
