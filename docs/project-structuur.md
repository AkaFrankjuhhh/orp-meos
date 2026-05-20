# Projectstructuur

pManager en het Porto-Systeem worden vanaf nu behandeld als twee losse websites binnen hetzelfde project.

## Websites

- `index.html` + `app.js` + `pmanager-data.js` + `pmanager.css`: pManager
- `porto.html` + `porto.js` + `porto.css`: Porto-Systeem

Ze delen bewust dezelfde login, sessie en personeelsdata.
Ze moeten verder zo veel mogelijk eigen routes, eigen frontendcode en eigen styling krijgen.

## Gedeelde lagen

- `storage.js`: centrale data-opslag, backups en veilige writes naar `data.json`.
- `shared.css`: gedeelde basisstyling die door beide websites wordt geladen.
- `shared-ui.js`: gedeelde browserhelpers die door pManager en Porto worden geladen.
- `modules/auth.js`: Discord OAuth, sessies, cookies en Discord profielinformatie.
- `modules/permissions.js`: server-rechten voor Kader, OvJ/hOvJ, Interne-Zaken, Trainer, Mentor en W&S.
- `modules/discord-webhooks.js`: Discord webhook-URL keuze en berichtopmaak voor afwezigheid, aanname, ontslag en ontslagformulieren.
- `modules/porto.js`: Porto voertuigreeksen, OPS-rechten, actieve eenheden, koppels en Porto payload-opbouw.
- `modules/porto-routes.js`: alle `/api/porto/...` routes voor profiel, status, OPS, voertuigen, koppels en testtools.
- `modules/pmanager-routes.js`: alle pManager API-routes voor personeel, profielen, afwezigheid, I8, mentor, W&S, archief, state en logboek.

## Richting voor verdere opsplitsing

De server wordt stap voor stap kleiner gemaakt:

- `modules/pmanager-domain.js`: pManager domeinlogica voor personeel, profielen, trainingen, sancties, afwezigheid, I8, mentor en archief.
- `modules/pmanager-routes.js`: pManager API-routes blijven dun en roepen domeinlogica aan.
- `modules/porto-routes.js`: Porto API-routes blijven gescheiden van pManager.
- `modules/discord-webhooks.js`: Discord notificaties.
- `modules/permissions.js`: rechten op basis van rang, badges en rollen.

Elke stap moet klein blijven en na afloop getest worden, zodat pManager en Porto niet tegelijk breken.
## Frontend modules

pManager heeft nu een eigen frontendmap:

- `pmanager/module-registry.js`: registreert pManager featuremodules.
- `pmanager/profile.js`: profielkaart, badges, trainingen, uren en sancties.
- `pmanager/people.js`: personeel, medewerkers, W&S en personeelsdialogen.
- `pmanager/i8.js`: I8 formulieren, controle, detailvenster en archiefweergave.
- `pmanager/mentor.js`: mentoroverzicht, checklist, traject en mentor-notities.
- `pmanager/absence.js`: afwezigheidsstatus, overzicht en verwijdercontext.
- `pmanager/archive.js`: personeelsarchief en ontslag-overzicht.

Porto heeft nu een eigen frontendmap:

- `porto/module-registry.js`: registreert Porto featuremodules.
- `porto/audio.js`: OPS-geluiden voor Status 0, Status 6 en Status 7.
- `porto/map.js`: GTA-kaart, zoom, slepen en eenheidmarkers.
- `porto/ops.js`: OPS bediening, verzoeken, eenheden, koppelen en contextacties.
- `porto/duty.js`: Status 0, dienstpaneel, statusknoppen en voertuigkeuze.
- `porto/profile.js`: Porto-profielpopup, trainingen en telefoonnummer.

De modules worden bewust vóór `app.js` en `porto.js` geladen. Daardoor kunnen we functionaliteit stap voor stap uit de hoofdbestanden halen zonder alles tegelijk te breken.