# Waar Zit Wat

Korte wegwijzer voor snelle fixes in pManager. Gebruik dit als eerste kaart voordat je door de hele repo zoekt.

## Startpunten

- Personeelsportaal UI: `index.html`, `app.js`, `personeelsportaal/`, `personeelsportaal.css`
- Porto UI: `porto.html`, `porto.js`, `porto/`, `porto.css`
- Publieke formulieren: `public-forms.html`, `public-forms.js`, `modules/public-forms.js`
- Neventaken: `side-tasks.html`, `side-tasks.js`, `side-tasks-server.js`, `modules/side-tasks-*`
- MEOS/Overheid: `meos.html`, `meos/`, `meos.css`, `overheid-server.js`, `modules/meos-*`
- Discord bot/worker: `scripts/discord-bot-worker.js`, `modules/discord-bot.js`, `modules/discord-sync-jobs.js`

## Vaak Voorkomende Bugs

### Uren kloppen niet

Kijk eerst hier:

- `modules/porto-duty-hours.js`: maakt urenregels uit porto units.
- `modules/porto-duty-hours-job.js`: schrijft porto diensturen periodiek weg.
- `modules/personeelsportaal-domain.js`: bouwt profieluren en live/recovered porto uren.
- `personeelsportaal/hours.js`: toont uren op profiel.
- `tests/porto-duty-hours.test.js`
- `tests/personnel-hours-client.test.js`
- `tests/organization-coupling.test.js`

Let extra op:

- `assignedAt`, `startedAt`, `endedAt`
- gekoppelde leden
- OPS/OC roepnummer
- dubbele runtime units
- operationele weekgrens

### Porto mensen komen terug in dienst

Kijk eerst hier:

- `modules/porto-routes.js`: status, uitdienst, koppelen en verplaatsen.
- `modules/porto-postgres-store.js`: runtime opslag van porto units.
- `modules/porto.js`: actieve units, sweep, presence en rechten.
- `porto/duty.js`: eigen statusknoppen.
- `porto/ops.js`: OPS/OC acties.
- `tests/porto-offduty.test.js`

### Porto voertuigen of roepnummers wijzigen

Kijk eerst hier:

- `config/porto-vehicles.js`: centrale voertuigreeksen en voertuigkeuzes.
- `modules/porto.js`: gebruikt de config en bewaakt porto gedrag.
- `modules/porto-routes.js`: valideert en schrijft voertuigkeuzes.
- `tests/organization-coupling.test.js`

### Discord rollen verdwijnen of komen verkeerd terug

Kijk eerst hier:

- `modules/organizations.js`: organisatieconfig, badges, trainingen en role mappings.
- `modules/discord-bot.js`: gewenste nicknames en rollen.
- `scripts/discord-bot-worker.js`: verwerkt Discord sync jobs.
- `modules/discord-sync-jobs.js`: queue opslag.
- `tests/discord-rank-sync.test.js`
- `tests/organization-coupling.test.js`

Let extra op:

- organisatie: Defensie of Politie
- actief profiel versus oud profiel
- `discord_id` op de juiste persoon
- scheidingsrollen in `.env`
- handmatig gegeven rollen die niet door het portaal beheerd worden

### Mentor, Trainer en IBT

Kijk eerst hier:

- `personeelsportaal/mentor.js`
- `personeelsportaal/trainer.js`
- `modules/mentor-tests-logic.js`
- `modules/mentor-tests-store.js`
- `modules/personeelsportaal-domain.js`
- `tests/mentor-tests-logic.test.js`
- `tests/static-assets.test.js`

### I8 formulieren

Kijk eerst hier:

- `personeelsportaal/i8.js`
- `app.js`
- `index.html`
- `modules/personeelsportaal-routes.js`
- `modules/personeelsportaal-postgres-forms-store.js`
- `tests/static-assets.test.js`

### Aanname, ontslag en oude profielen

Kijk eerst hier:

- `modules/personeelsportaal-routes.js`
- `modules/personeelsportaal-domain.js`
- `modules/personeelsportaal-postgres-people-store.js`
- `modules/people-identity.js`
- `modules/person-status.js`
- `tests/dismissal-flow.test.js`
- `tests/people-identity.test.js`
- `tests/person-status.test.js`

### Publieke formulieren en Discord webhooks

Kijk eerst hier:

- `public-forms.js`
- `modules/public-forms.js`
- `modules/public-forms-store.js`
- `modules/discord-webhooks.js`
- `scripts/retry-public-form-webhooks.js`
- `tests/static-assets.test.js`

### Systeemstatus en performance

Kijk eerst hier:

- `modules/personeelsportaal-routes.js`
- `modules/db.js`
- `modules/discord-sync-status.js`
- `modules/postgres-event-bridge.js`
- `tests/static-assets.test.js`

### MEOS zoeken, dossiers en databron

Kijk eerst hier:

- `meos/app.js`: pagina's, routing, personen/voertuigenprofielen en Wetboek-modal.
- `meos/api.js`: browsercalls naar `/api/meos/...`.
- `meos/core.js`: gedeelde browserhelpers.
- `meos/pages/databron.js`: KL/Kader-only databronstatus.
- `modules/meos-api-routes.js`: MEOS API-routes.
- `modules/meos-store.js`: storefactory, cache en fallbackgedrag.
- `modules/meos-store-demo.js`: demo/conceptdata.
- `modules/meos-store-fivem.js`: toekomstige FiveM databaseviews en MEOS dossierbestand.
- `docs/meos-fivem-database.md`
- `tests/meos-store.test.js`
- `tests/meos-auth-rules.test.js`

## Mappenafspraak

- `config/`: stabiele lijsten en mappings.
- `modules/`: serverlogica, domeinlogica, stores en externe koppelingen.
- `personeelsportaal/`: clientmodules voor het personeelsportaal.
- `porto/`: clientmodules voor porto.
- `meos/`: clientmodules voor MEOS.
- `scripts/`: losse beheer- en workerprocessen.
- `tests/`: regressietests per buggebied.
- `docs/`: uitleg, deploystappen en onderhoudskaarten.

## Praktische Werkwijze

1. Zoek eerst in deze gids welk domein geraakt wordt.
2. Lees de bijbehorende module en test.
3. Maak de wijziging klein.
4. Voeg of update een test bij hetzelfde buggebied.
5. Draai gericht de relevante test.
6. Draai daarna `npm.cmd test` voor de volledige regressiecheck.

Als een wijziging een grote rootfile raakt, probeer dan eerst te kijken of het gedrag naar een bestaande featuremodule kan worden verplaatst.
