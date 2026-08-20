# MEOS beveiliging en productiepad

## Wat server-side wordt afgedwongen

- Discord OAuth state moet zowel in de serveropslag als in de browsercookie overeenkomen.
- MEOS gebruikt een host-only, `HttpOnly`, `SameSite=Lax` sessiecookie.
- Discord rollen en het gekoppelde portaalprofiel worden periodiek opnieuw gecontroleerd met de bot.
- Een account zonder exact gekoppelde Discord-ID in Politie of Defensie krijgt geen toegang.
- Naam, rang, dienstnummer en schrijversgegevens komen uit het gekoppelde portaalprofiel.
- Wetboekartikelen, strafregels, totalen en boetebedrag worden opnieuw berekend op de server.
- Definitieve PV's zijn onveranderbaar; de documenttekst wordt server-side opgebouwd.
- Verwijderrechten en inzage in alle PV's worden op iedere API-route gecontroleerd.
- Gevoelige HTML- en JSON-antwoorden gebruiken `Cache-Control: no-store`.

## Productie-instellingen

Gebruik voor live minimaal:

```env
NODE_ENV=production
SESSION_COOKIE_SECURE=true
DEV_ALLOW_UNAUTH=false
MEOS_REQUIRE_PORTAL_IDENTITY=true
MEOS_SESSION_MAX_AGE_SECONDS=3600
MEOS_AUTHORIZATION_REFRESH_MS=300000
MEOS_AUTHORIZATION_MAX_STALE_MS=1800000
MEOS_DISCORD_BOT_TOKEN=<bot-token>
MEOS_AUDIT_STORAGE=postgres
MEOS_AUDIT_DATABASE_URL=postgres://meos_app:<wachtwoord>@127.0.0.1:5432/meos
```

Zolang de echte FiveM-bron nog niet beschikbaar is, blijft de demo-dataset actief en worden wijzigingen atomisch bewaard in:

```env
MEOS_DATA_SOURCE=demo
MEOS_CASE_DATA_PATH=/opt/orp/meos-data/meos-case-data.json
```

Zet pas bij de overgang naar de FiveM views ook de schrijfbare dossierdatabase aan:

```env
MEOS_DATA_SOURCE=fivem
MEOS_CASE_DATABASE_URL=postgres://meos_app:<wachtwoord>@127.0.0.1:5432/meos
```

Bewaar de bot-token en databasewachtwoorden alleen in `.env` op de VPS. Commit deze nooit.

## Gefaseerde FiveM-koppeling

1. Maak eerst de vier read-only views in de FiveM database.
2. Geef `meos_readonly` uitsluitend `CONNECT`, `USAGE` en `SELECT` op die views.
3. Vul `MEOS_FIVEM_DATABASE_URL` en zet daarna pas `MEOS_DATA_SOURCE=fivem`.
4. Draai `npm run meos:check-db` en controleer `/databron` met KL/Kader/OVJ.
5. Houd de MEOS schrijfdatabase apart van de FiveM bronverbinding.

## Operationele controles

- Controleer na iedere release `journalctl -u orp-meos.service -n 100 --no-pager`.
- Controleer periodiek mislukte logins, verwijderacties en definitieve PV's in het auditlog.
- Maak dagelijks een databaseback-up en test periodiek of die teruggezet kan worden.
- Neem zolang demo-opslag actief is ook `MEOS_CASE_DATA_PATH` mee in de dagelijkse back-up.
- Roteer direct een token of wachtwoord dat ooit in chat, screenshots of Git terechtkomt.
