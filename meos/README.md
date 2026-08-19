# MEOS Frontend

Deze map bevat browsermodules voor `meos.html`.

## Bestanden

- `app.js`: hoofdentrypoint, pagina-routing en schermrendering.
- `api.js`: JSON calls naar `/api/meos/...`, inclusief login-redirect bij 401 en CSRF-header voor mutaties.
- `core.js`: kleine gedeelde browserhelpers zoals DOM-selectors, escaping, normalisatie en PNG-conversie.
- `pages/databron.js`: rendering voor de KL/Kader-only databronstatus.

## Afspraak

Nieuwe MEOS functionaliteit komt bij voorkeur in deze map, niet meer in de root `meos.js`.
De root `meos.js` blijft alleen als compatibiliteitsloader voor oude cache of oude HTML.

Als een pagina groter wordt dan alleen een paar renderhelpers, krijgt die pagina een eigen bestand onder `pages/`.
