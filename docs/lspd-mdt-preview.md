# LSPD MDT preview

`meos2.orpoverheid.nl` is een openbare testomgeving zonder Discord-login. De
presentatie en gegevensopslag zijn volledig gescheiden van het primaire MEOS.

## Onderdelen

- `lspd.html`: Engelstalige LSPD MDT-shell.
- `lspd.css`: donkere Amerikaanse MDT-presentatie.
- `lspd/locale.js`: Engelse vertaling van dynamisch gerenderde MEOS-velden.
- `assets/lspd-logo.png`: origineel fictief LSPD-embleem met transparante achtergrond.

## Testconfiguratie

De openbare demo staat standaard aan voor uitsluitend `meos2.orpoverheid.nl`.
Dit kan in `/opt/orp/meos/.env` expliciet worden vastgelegd:

```dotenv
LSPD_MDT_PUBLIC_DEMO=true
```

Er is geen Discord callback, botrol of accountkoppeling nodig. De test gebruikt
een vast fictief profiel en een aparte in-memory demostore. Toevoegingen kunnen
tijdens het testen worden opgeslagen, maar verdwijnen na een herstart van de
service. Echte MEOS-, FiveM- en auditgegevens zijn niet bereikbaar via deze host.

Maak voor `meos2.orpoverheid.nl` dezelfde DNS-record aan als voor
`meos.orpoverheid.nl`. Caddy stuurt beide hosts door naar dezelfde Node-service;
de hostcontrole kiest vervolgens automatisch de geisoleerde LSPD-testomgeving.
