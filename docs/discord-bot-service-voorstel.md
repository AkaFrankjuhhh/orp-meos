# Discord bot service

Deze service draait de Discord bot los van de website. Daardoor blijft de website online als Discord tijdelijk traag is of als de bot opnieuw moet verbinden.

## Wat deze worker doet

- Verbindt met Discord Gateway zodat de bot online zichtbaar is.
- Verwerkt `discord_sync_jobs` uit PostgreSQL.
- Synchroniseert nicknames en rangrollen voor actieve personeelsleden.
- Past alleen leden aan die de verplichte Discord Defensie rol hebben.
- Slaat profielen over die niet in het personeelsportaal staan.
- Probeert mislukte jobs later opnieuw.

## Lokaal testen

```bash
npm run discord:profiles:dry
npm run discord:profiles:sync
npm run discord:bot
```

## VPS service installeren

```bash
sudo cp deploy/defensie-discord-bot.service.example /etc/systemd/system/defensie-discord-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now defensie-discord-bot
sudo systemctl status defensie-discord-bot --no-pager
```

Logs bekijken:

```bash
journalctl -u defensie-discord-bot -f
```

## Discord Developer Portal

Voor online status is de bot token genoeg. Voor automatisch reageren wanneer iemand de Discord joint is `Server Members Intent` nodig. Zet die aan bij de bot instellingen als je join-detectie wilt gebruiken.

