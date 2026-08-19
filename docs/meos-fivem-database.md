# MEOS FiveM databasekoppeling

MEOS leest FiveM data via vaste read-only database views. Daardoor hoeft de MEOS code later niet aangepast te worden als de echte FiveM tabellen anders heten.

## Benodigde `.env`

```env
MEOS_DATA_SOURCE=fivem
MEOS_FIVEM_DB_DRIVER=postgres
MEOS_FIVEM_DATABASE_URL=postgres://meos_readonly:<wachtwoord>@127.0.0.1:5432/fivem
MEOS_FIVEM_DATABASE_SSL=false
MEOS_CASE_DATA_PATH=/opt/orp/meos-data/meos-case-data.json

MEOS_FIVEM_PLAYERS_VIEW=meos_people_view
MEOS_FIVEM_VEHICLES_VIEW=meos_vehicles_view
MEOS_FIVEM_HOUSING_VIEW=meos_housing_view
MEOS_FIVEM_WARRANTS_VIEW=meos_arrest_warrants_view
```

Controleer de koppeling daarna met:

```bash
npm run meos:check-db
```

Voor machineleesbare output:

```bash
npm run meos:check-db -- --json
```

## KL/Kader healthcheck

De MEOS pagina `/databron` en API `/api/meos/data-health` zijn alleen zichtbaar met:

```env
MEOS_DEFENSIE_HEALTH_ROLE_IDS=<defensie kader rol id>
MEOS_POLITIE_HEALTH_ROLE_IDS=<politie korpsleiding/kader rol id>
```

Als deze leeg blijven, gebruikt MEOS de bestaande portal envs `DISCORD_KADER_ROLE_ID` en `DISCORD_POLITIE_KORPSLEIDING_ROLE_ID` als fallback.

## Read-only database gebruiker

Voer dit uit op de database waar de FiveM views staan. Gebruik een sterk wachtwoord.

```sql
create role meos_readonly with login password '<sterk-wachtwoord>';

grant connect on database fivem to meos_readonly;
grant usage on schema public to meos_readonly;
grant select on meos_people_view to meos_readonly;
grant select on meos_vehicles_view to meos_readonly;
grant select on meos_housing_view to meos_readonly;
grant select on meos_arrest_warrants_view to meos_readonly;
```

MEOS gebruikt alleen `select` voor FiveM basisdata. Strafbladen, notities en boetes worden opgeslagen in `MEOS_CASE_DATA_PATH`; auditlogs blijven in `MEOS_AUDIT_LOG_PATH`.

MEOS normaliseert server-side:

- BSN naar `ORP-BSN-<cijfers>`
- vingerafdruk naar `ORP-V-<cijfers>`
- kentekens en VIN naar hoofdletters

## View contract

Maak deze views met exact deze kolomnamen. Pas alleen de `from ...` en JSON-extracties aan op jouw FiveM schema.

```sql
create or replace view meos_people_view as
select
  p.citizenid::text as id,
  concat_ws(' ', p.firstname, p.lastname)::text as name,
  coalesce(p.bsn, 'ORP-BSN-' || p.citizenid)::text as bsn,
  coalesce(p.fingerprint, 'ORP-V-' || p.citizenid)::text as fingerprint,
  p.birthdate::text as birth_date,
  coalesce(p.height, '')::text as height,
  coalesce(p.status, 'Geen signalering')::text as status,
  coalesce(p.licenses, '[]'::jsonb)::jsonb as licenses
from players p;

create or replace view meos_vehicles_view as
select
  v.plate::text as plate,
  v.citizenid::text as owner_id,
  coalesce(concat_ws(' ', p.firstname, p.lastname), '')::text as owner,
  coalesce(v.model, v.vehicle)::text as model,
  coalesce(v.vin, '')::text as vin,
  coalesce(v.primary_color, '')::text as primary_color,
  coalesce(v.secondary_color, '')::text as secondary_color,
  coalesce(v.pearl_color, '')::text as pearl_color,
  coalesce(v.apk_status, 'Goedgekeurd')::text as apk_status,
  coalesce(v.wok, false)::boolean as wok,
  coalesce(v.stolen, false)::boolean as stolen,
  coalesce(v.stolen_reason, '')::text as stolen_reason,
  coalesce(v.stolen_date, '')::text as stolen_date,
  coalesce(v.impounded, false)::boolean as impounded,
  coalesce(v.service_vehicle, false)::boolean as service_vehicle
from owned_vehicles v
left join players p on p.citizenid = v.citizenid;

create or replace view meos_housing_view as
select
  h.id::text as id,
  h.citizenid::text as person_id,
  coalesce(concat_ws(' ', p.firstname, p.lastname), '')::text as owner,
  coalesce(h.location, h.address, '')::text as location,
  coalesce(h.label, h.name, '')::text as building,
  coalesce(h.status, 'Actief')::text as status
from player_houses h
left join players p on p.citizenid = h.citizenid;

create or replace view meos_arrest_warrants_view as
select
  w.id::text as id,
  w.citizenid::text as person_id,
  coalesce(concat_ws(' ', p.firstname, p.lastname), '')::text as person_name,
  w.reason::text as reason,
  w.issued_at::text as issued_at,
  w.issued_by::text as issued_by,
  coalesce(w.priority, 'Normaal')::text as priority,
  coalesce(w.status, 'Actief')::text as status,
  coalesce(w.instruction, '')::text as instruction
from arrest_warrants w
left join players p on p.citizenid = w.citizenid;
```

`meos_people_view` en `meos_vehicles_view` zijn verplicht. `meos_housing_view` en `meos_arrest_warrants_view` mogen tijdelijk ontbreken; `/databron` toont ze dan als optioneel missend.

`npm run meos:check-db` gebruikt hetzelfde contract als `/databron`, maar is sneller voor onderhoud op de VPS.
