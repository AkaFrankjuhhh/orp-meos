# Porto als eigen service

Porto kan los van het Defensie Personeelsportaal draaien via `porto-server.js`.
Daarmee kun je het personeelsportaal herstarten zonder actieve OPS/Porto-gebruikers uit hun werk te halen.

## Architectuur

- Personeelsportaal/forms: `server.js` op poort `3000`
- Porto-Systeem: `porto-server.js` op poort `3002`
- Database: voorlopig dezelfde PostgreSQL database
- Auth: Porto heeft een eigen Discord login/callback op `porto.orpdefensie.nl`

De oude `/porto.html` route in `server.js` blijft voorlopig bestaan als fallback. Zodra Caddy `porto.orpdefensie.nl` naar poort `3002` stuurt, gebruikt iedereen de nieuwe Porto-service.

## Belangrijk voor Discord OAuth

Voeg in de Discord Developer Portal deze redirect URI toe:

```txt
https://porto.orpdefensie.nl/auth/discord/callback
```

Laat de bestaande portal callback ook staan:

```txt
https://orpdefensie.nl/auth/discord/callback
```

## VPS installatie

Vanaf de projectmap:

```bash
git pull
sudo cp deploy/defensie-porto.service.example /etc/systemd/system/defensie-porto.service
sudo systemctl daemon-reload
sudo systemctl enable defensie-porto
sudo systemctl start defensie-porto
sudo systemctl status defensie-porto
```

Controleer lokaal op de VPS:

```bash
curl -s http://127.0.0.1:3002/api/health
```

## Caddy

Zet `porto.orpdefensie.nl` naar de Porto-service:

```caddy
porto.orpdefensie.nl {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3002
}
```

En laat `orpdefensie.nl` plus de form-subdomeinen naar `127.0.0.1:3000` wijzen.

Daarna:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Deploy gebruik

Personeelsportaal update:

```bash
git pull
sudo systemctl restart defensie-personeelsportaal
```

Porto blijft dan draaien.

Porto update:

```bash
git pull
sudo systemctl restart defensie-porto
```

Personeelsportaal blijft dan draaien.

## Aandachtspunt

Live events zijn proces-lokaal. Porto-wijzigingen binnen Porto blijven live, maar personeelswijzigingen uit het portaal pushen niet automatisch een event naar de Porto-service. Porto blijft wel via eigen API/polling actuele databasegegevens ophalen. Een latere verbetering kan PostgreSQL `NOTIFY/LISTEN` zijn voor proces-overstijgende live updates.
