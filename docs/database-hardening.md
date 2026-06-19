# Database Hardening

## Waarom

Personeels- en formulieracties schrijven gericht naar PostgreSQL. Volledige browsermomentopnames verwijderen geen records meer stilzwijgend. Een gerichte verwijderactie geeft expliciet door welke rij moet verdwijnen.

## Discord-ID integriteit

Nieuwe medewerkers met een Discord-ID die al aan een ander profiel is gekoppeld, worden door de applicatie geweigerd. Nadat bestaande dubbelen zijn opgelost kan PostgreSQL dit ook afdwingen:

```powershell
npm run db:discord-identity:check
npm run db:discord-identity:enforce
```

De tweede opdracht verandert alleen de database wanneer de controle geen dubbele Discord-ID's vindt.

## Productie-instellingen

Gebruik per servicebestand een beperkte databasepool. De standaard is vier verbindingen per proces:

```env
NODE_ENV=production
DEV_ALLOW_UNAUTH=false
DATABASE_POOL_MAX=4
```

Verhoog `DATABASE_POOL_MAX` alleen na het controleren van PostgreSQL-verbindingen. Met meerdere portalen, Porto-services en workers is een lage, voorspelbare limiet veiliger dan iedere service tien verbindingen geven.

## Neventaken in Porto

De beide Porto-services lezen de status van DSI, HRB, KLu en DNR uit de centrale neventakendatabase. Zet daarom in zowel `.env` als `.env.politie` dezelfde waarde als de `DATABASE_URL` van `.env.side-tasks`:

```env
SIDE_TASK_DATABASE_URL=postgres://defensie_portal:WACHTWOORD@localhost:5432/side_tasks_portal
SIDE_TASK_DATABASE_POOL_MAX=2
```
