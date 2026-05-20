# FiveM urenregistratie

Deze opzet gebruikt een push-koppeling: de FiveM resource bepaalt wanneer iemand met een actieve overheidsjob in dienst is en stuurt na afloop van die dienst een urenregistratie naar pManager.

## pManager configuratie

Zet in `.env`:

```env
FIVEM_INGEST_SECRET=een-lange-geheime-sleutel
FIVEM_ALLOWED_JOBS=kmar,defensie,marechaussee,koninklijke marechaussee
```

## Endpoint

`POST /api/fivem/hours`

Headers:

```http
Content-Type: application/json
Authorization: Bearer een-lange-geheime-sleutel
```

Body:

```json
{
  "discordId": "123456789012345678",
  "job": "kmar",
  "startedAt": "2026-05-03T18:00:00.000Z",
  "endedAt": "2026-05-03T20:30:00.000Z",
  "durationMinutes": 150,
  "source": "oranjestad-kmar",
  "sessionId": "unieke-fivem-dienst-id"
}
```

`durationMinutes` mag gebruikt worden in plaats van rekenen met `startedAt` en `endedAt`. Als `sessionId` hetzelfde blijft, werkt pManager de bestaande registratie bij in plaats van dubbel te registreren.

## Belangrijk

- pManager koppelt uren aan het profiel via `discordId`.
- Alleen actieve profielen tellen mee.
- Alleen jobs uit `FIVEM_ALLOWED_JOBS` tellen mee.
- Een registratie mag maximaal 1440 minuten zijn.
- De FiveM resource moet zelf controleren of iemand echt in dienst is met de juiste job.
