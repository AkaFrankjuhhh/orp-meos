# Politie-kant uitrollen

Deze codebase kan nu organisatie-afhankelijk draaien met `ORP_ORGANIZATION`.

- `ORP_ORGANIZATION=defensie` gebruikt de bestaande Defensie rangen, rollen, OPS en dienstnummerreeksen.
- `ORP_ORGANIZATION=politie` gebruikt Politie rangen, rollen, OC en de 21-dienstnummerreeks.

## Services

Gebruik aparte services zodat Defensie en Politie elkaar niet hoeven te herstarten:

- Defensie portaal: `server.js` op poort `3000`
- Defensie porto: `porto-server.js` op poort `3002`
- Politie portaal: `server.js` met `ORP_ORGANIZATION=politie` op poort `3010`
- Politie porto: `porto-server.js` met `ORP_ORGANIZATION=politie` op poort `3012`

Voorbeelden staan in:

- `deploy/politie-personeelsportaal.service.example`
- `deploy/politie-porto.service.example`
- `deploy/Caddyfile.example`

## Database

Voor een echte gescheiden politie-omgeving is een aparte PostgreSQL database aanbevolen, bijvoorbeeld:

```text
postgres://postgres:WACHTWOORD@localhost:5432/politie_portaal
```

Als beide services dezelfde `DATABASE_URL` gebruiken, delen ze ook dezelfde medewerkers, I8, afwezigheid en blacklist. Dat is niet wenselijk voor de eerste politie-uitrol.

## Discord rollen

Zet in de politie `.env` minimaal:

```text
ORP_ORGANIZATION=politie
DISCORD_POLITIE_ROLE_ID=1423471185391255705
DISCORD_POLITIE_KORPSLEIDING_ROLE_ID=1423471166495916052
DISCORD_POLITIE_BESTUUR_ROLE_ID=1425219424943865987
DISCORD_POLITIE_MEOS_ROLE_ID=1425715749862772818
DISCORD_POLITIE_OC_ROLE_ID=1424523648819003484
DISCORD_POLITIE_OPCO_ROLE_ID=1424523648412155994
DISCORD_POLITIE_OVD_ROLE_ID=1424523647816699996
```

Rangrollen zijn optioneel en kunnen later gevuld worden zodra die Discord rollen bestaan.

## Belangrijke keuzes

- Politie-aanname via W&S start als `Aspirant`.
- Inspecteur en hoger worden automatisch gesorteerd in `21-01 t/m 21-20`.
- Brigadier t/m Aspirant gebruikt vrije nummers vanaf `21-21`, zodat de leidingnummers niet botsen.
- Korpsleiding heeft kaderrechten.
- Bestuur kan meekijken en afwezigheid keuren.
- Politie I8-goedkeuring loopt via `OvJ`/`hOvJ`.

## Nog bewust apart houden

`orpoverheid.nl` is nog niet als router gebouwd. Die moet straks een eigen kleine service krijgen die na Discord-login kijkt naar de rollen/profielen en dan doorstuurt naar `orpdefensie.nl` of `orppolitie.nl`.
