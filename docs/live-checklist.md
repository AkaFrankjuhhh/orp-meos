# Live checklist Defensie Personeelsportaal

Gebruik deze checklist voordat je de website 24/7 online zet.

## 1. Database

- PostgreSQL draait op de server.
- Database `defensie_portaal` bestaat.
- Schema is aangemaakt met:

```powershell
npm run db:init
```

- Lokale JSON-data is eenmalig geimporteerd met:

```powershell
npm run db:import-json
```

- Daarna moet de live omgeving draaien met:

```env
STORAGE_MODE=postgres
```

## 2. Omgeving

Zet in `.env` minimaal:

```env
PORT=3000
APP_BASE_URL=https://jouwdomein.nl
STORAGE_MODE=postgres
DEV_ALLOW_UNAUTH=false
DATABASE_URL=postgres://USER:WACHTWOORD@HOST:5432/defensie_portaal
DATABASE_SSL=false
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=
DISCORD_DEFENSIE_ROLE_ID=1423468016099918024
```

Discord callback in de Developer Portal:

```text
https://jouwdomein.nl/auth/discord/callback
```

## 3. Productiecheck

Draai voor livegang:

```powershell
npm run prod:check
```

Deze check toont geen wachtwoorden, maar controleert wel env, databaseverbinding en aantallen.

## 4. Backups

Maak handmatig een backup met:

```powershell
npm run db:backup
```

Plan dit op de VPS dagelijks met cron of een systemd timer.

## 5. Server draaien

Voor VPS/Linux is het advies:

- Node app via PM2 of systemd draaien.
- Reverse proxy via Caddy of Nginx.
- HTTPS verplicht.
- Dagelijkse PostgreSQL backup instellen.

Voor test/ngrok:

- lokale server starten met `npm start`;
- ngrok op poort `3000` zetten;
- `APP_BASE_URL` en Discord callback laten matchen met de ngrok URL.

## 6. Test voor livegang

Test met meerdere leden tegelijk:

- Discord login;
- eigen profiel openen;
- afwezigheid indienen en kader-overzicht;
- I8 indienen, in behandeling zetten, goedkeuren/afkeuren;
- training afvinken;
- sanctie toevoegen/verwijderen;
- W&S aannemen;
- Porto Status 0, OPS indeling, statuswijzigingen en uit dienst melden.
