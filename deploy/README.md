# Deployment bestanden

## PM2

Start de app op de VPS met:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## HTTPS reverse proxy

Gebruik bij voorkeur Caddy voor automatische HTTPS:

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Of gebruik het Nginx voorbeeld als je liever Nginx + certbot gebruikt.

## Health check

Controleer live:

```text
https://jouwdomein.nl/api/health
```

Deze moet `ok: true` teruggeven.
