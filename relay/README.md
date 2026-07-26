# realMultiplayer relay server

Tiny WebSocket relay that pairs two Melvor Idle players and shuttles messages
between them. First to connect becomes the host; the second joins as peer.

## Quick start

Requires [Node.js](https://nodejs.org) (LTS).

```
npm install
node server.js        # listens on port 8080
```

Then pick one:

- **Same network (LAN):** both players use `ws://<your-local-ip>:8080`
- **Over the internet:** run `cloudflared tunnel --url http://localhost:8080`
  and both players use the printed `https://...trycloudflare.com` URL with
  `https://` replaced by `wss://`

Both players paste the **same** address into the mod's Multiplayer panel and
click **Connect**.

Full step-by-step guide (including cloudflared download links and
troubleshooting): see **"Running your own relay server"** in the
[main README](../README.md).
