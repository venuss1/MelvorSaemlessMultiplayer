// Simple WebSocket relay server for the Melvor Idle realMultiplayer mod.
//
// Two players connect to this server. The server pairs them and relays
// every message from one to the other. No WebRTC, no NAT traversal — just
// plain WebSocket, which works through any firewall that allows HTTPS.
//
// Usage:
//   node server.js [port]
//
// Default port: 8080

const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2] || '8080', 10);
const wss = new WebSocketServer({ port: PORT });

// Simple room model: first player to connect becomes the host and waits.
// Second player joins the same room. They get paired and messages relay.
let host = null;
let peer = null;

console.log(`[mp-server] Listening on port ${PORT}`);
console.log(`[mp-server] Waiting for players to connect...`);

function tryPair() {
  if (host && peer && host.readyState === 1 && peer.readyState === 1) {
    console.log('[mp-server] Paired! Relaying messages between host and peer.');
    host.send(JSON.stringify({ t: 'paired', role: 'host' }));
    peer.send(JSON.stringify({ t: 'paired', role: 'peer' }));
  }
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[mp-server] New connection from ${ip}`);

  if (!host) {
    host = ws;
    console.log('[mp-server] Assigned as HOST. Waiting for peer...');
    ws.send(JSON.stringify({ t: 'waiting' }));
    ws.on('message', (data) => {
      if (peer && peer.readyState === 1) peer.send(data.toString());
    });
    ws.on('close', () => {
      console.log('[mp-server] Host disconnected.');
      host = null;
      if (peer) { try { peer.send(JSON.stringify({ t: 'peer_left' })); } catch {} }
    });
  } else if (!peer) {
    peer = ws;
    console.log('[mp-server] Assigned as PEER. Attempting to pair...');
    ws.on('message', (data) => {
      if (host && host.readyState === 1) host.send(data.toString());
    });
    ws.on('close', () => {
      console.log('[mp-server] Peer disconnected.');
      peer = null;
      if (host) { try { host.send(JSON.stringify({ t: 'peer_left' })); } catch {} }
    });
    tryPair();
  } else {
    console.log('[mp-server] Room full — rejecting extra connection.');
    ws.send(JSON.stringify({ t: 'error', msg: 'Room is full (2 players max).' }));
    ws.close();
  }

  ws.on('error', (err) => console.error('[mp-server] WS error:', err.message));
});

wss.on('error', (err) => console.error('[mp-server] Server error:', err.message));
