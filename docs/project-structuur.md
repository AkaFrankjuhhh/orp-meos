# Projectstructuur

Defensie Personeelsportaal en het Porto-Systeem worden vanaf nu behandeld als twee losse websites binnen hetzelfde project.

## Websites

- `index.html` + `app.js` + `personeelsportaal-data.js` + `personeelsportaal.css`: Defensie Personeelsportaal
- `porto.html` + `porto.js` + `porto.css`: Porto-Systeem

Ze delen bewust dezelfde login, sessie en personeelsdata.
Ze moeten verder zo veel mogelijk eigen routes, eigen frontendcode en eigen styling krijgen.

## Gedeelde lagen

- `storage.js`: centrale data-opslag, backups en veilige writes naar `data.json`.
- `shared.css`: gedeelde basisstyling die door beide websites wordt geladen.
- `shared-ui.js`: gedeelde browserhelpers die door Defensie Personeelsportaal en Porto worden geladen.
- `modules/auth.js`: Discord OAuth, sessies, cookies en Discord profielinformatie.
- `modules/permissions.js`: server-rechten voor Kader, OvJ/hOvJ, Interne-Zaken, Trainer, Mentor en W&S.
- `modules/discord-webhooks.js`: Discord webhook-URL keuze en berichtopmaak voor afwezigheid, aanname, ontslag en ontslagformulieren.
- `modules/porto.js`: Porto voertuigreeksen, OPS-rechten, actieve eenheden, koppels en Porto payload-opbouw.
- `modules/porto-routes.js`: alle `/api/porto/...` routes voor profiel, status, OPS, voertuigen, koppels en testtools.
- `modules/personeelsportaal-routes.js`: alle Defensie Personeelsportaal API-routes voor personeel, profielen, afwezigheid, I8, mentor, W&S, archief, state en logboek.

## Richting voor verdere opsplitsing

De server wordt stap voor stap kleiner gemaakt:

- `modules/personeelsportaal-domain.js`: Defensie Personeelsportaal domeinlogica voor personeel, profielen, trainingen, sancties, afwezigheid, I8, mentor en archief.
- `modules/personeelsportaal-routes.js`: Defensie Personeelsportaal API-routes blijven dun en roepen domeinlogica aan.
- `modules/porto-routes.js`: Porto API-routes blijven gescheiden van Defensie Personeelsportaal.
- `modules/discord-webhooks.js`: Discord notificaties.
- `modules/permissions.js`: rechten op basis van rang, badges en rollen.

Elke stap moet klein blijven en na afloop getest worden, zodat Defensie Personeelsportaal en Porto niet tegelijk breken.
## Frontend modules

Defensie Personeelsportaal heeft nu een eigen frontendmap:

- `personeelsportaal/module-registry.js`: registreert Defensie Personeelsportaal featuremodules.
- `personeelsportaal/profile.js`: profielkaart, badges, trainingen, uren en sancties.
- `personeelsportaal/people.js`: personeel, medewerkers, W&S en personeelsdialogen.
- `personeelsportaal/i8.js`: I8 formulieren, controle, detailvenster en archiefweergave.
- `personeelsportaal/mentor.js`: mentoroverzicht, checklist, traject en mentor-notities.
- `personeelsportaal/absence.js`: afwezigheidsstatus, overzicht en verwijdercontext.
- `personeelsportaal/archive.js`: personeelsarchief en ontslag-overzicht.

Porto heeft nu een eigen frontendmap:

- `porto/module-registry.js`: registreert Porto featuremodules.
- `porto/audio.js`: OPS-geluiden voor Status 0, Status 6 en Status 7.
- `porto/map.js`: GTA-kaart, zoom, slepen en eenheidmarkers.
- `porto/ops.js`: OPS bediening, verzoeken, eenheden, koppelen en contextacties.
- `porto/duty.js`: Status 0, dienstpaneel, statusknoppen en voertuigkeuze.
- `porto/profile.js`: Porto-profielpopup, trainingen en telefoonnummer.

De modules worden bewust vÃ³Ã³r `app.js` en `porto.js` geladen. Daardoor kunnen we functionaliteit stap voor stap uit de hoofdbestanden halen zonder alles tegelijk te breken.