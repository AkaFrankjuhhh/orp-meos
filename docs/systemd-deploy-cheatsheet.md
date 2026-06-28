# Systemd deploy cheatsheet

Deze repo draait live voor Defensie en Politie. Deploy daarom klein en bewust.

## Standaard deploy

```bash
cd /pad/naar/pManager
git pull
```

Herstart daarna alleen de services die door de wijziging geraakt worden.

## Service matrix

| Gewijzigd onderdeel | Herstart |
| --- | --- |
| `server.js`, `index.html`, `app.js`, `personeelsportaal/*`, `personeelsportaal.css`, `portal-*.js`, `boot-failsafe.js`, `shared-*` | `defensie-personeelsportaal` en `politie-personeelsportaal` |
| `porto-server.js`, `porto.js`, `porto/*`, `porto.css`, `porto.html`, `modules/porto*`, gedeelde Porto helpers | `defensie-porto` en `politie-porto` |
| `overheid-server.js`, overheid assets/routes | `orp-overheid` |
| `side-tasks-server.js`, `side-tasks.*`, `modules/side-tasks-*` | `orp-side-tasks` |
| `scripts/discord-bot-worker.js`, `modules/discord-*`, nickname/role sync code | Defensie/Politie Discord bot workers |
| `scripts/side-tasks-discord-worker.js`, side-task Discord sync code | `orp-side-tasks-discord-worker` |
| `modules/auth.js`, `modules/http-security.js`, `modules/organizations.js`, `modules/permissions.js`, `modules/postgres-state.js`, `modules/db.js` | Alle portaal/Porto services die live zijn |
| `db/schema.sql` | Eerst migratie/check draaien, daarna geraakte services herstarten |

## Checks na herstart

```bash
systemctl status defensie-personeelsportaal --no-pager
systemctl status politie-personeelsportaal --no-pager
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3010/api/health
```

Voor Porto:

```bash
systemctl status defensie-porto --no-pager
systemctl status politie-porto --no-pager
curl -fsS http://127.0.0.1:3002/api/health
curl -fsS http://127.0.0.1:3012/api/health
```

Gebruik `journalctl -u SERVICE -n 80 --no-pager` als een service niet schoon opkomt.

## Smoke-check

Na een volledige deploy kun je alle lokale standaardpoorten in een keer controleren:

```bash
npm run smoke:check
```

Of geef expliciet de live lokale targets mee:

```bash
node scripts/smoke-check.js http://127.0.0.1:3000 http://127.0.0.1:3002
```

De smoke-check controleert `/api/health` en, waar passend, belangrijke frontend-assets zoals boot-scripts en CSS.
