// Peer-to-peer transport built on top of PeerJS.
//
// PeerJS gives us a free public broker for signalling, so two players only
// need to exchange a short host ID to establish a direct WebRTC connection.
// The library is injected from a CDN at runtime (see setup.mjs) so the mod
// package stays small and build-free.
//
// The transport is a small event emitter with a single peer connection.
// Both roles use the same surface; the only difference is who initiates.

import { logger } from '../util/logger.mjs';
import { encode, decode, Msg } from './protocol.mjs';

const PEERJS_VERSION = '1.5.4';
const PEERJS_CDN = `https://unpkg.com/peerjs@${PEERJS_VERSION}/dist/peerjs.min.js`;

/** Load the PeerJS UMD bundle from CDN, resolving to window.Peer. */
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-peerjs]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Peer));
      existing.addEventListener('error', () => reject(new Error('PeerJS failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = PEERJS_CDN;
    s.async = true;
    s.dataset.peerjs = 'true';
    s.onload = () => {
      if (window.Peer) resolve(window.Peer);
      else reject(new Error('PeerJS loaded but window.Peer is undefined'));
    };
    s.onerror = () => reject(new Error('Failed to download PeerJS from CDN'));
    document.head.appendChild(s);
  });
}

/**
 * A minimal event-driven transport over a single PeerJS DataConnection.
 * Emits: 'open' | 'message' (msg) | 'close' | 'error' (err) | 'id' (myId)
 */
export class Transport {
  constructor() {
    this.peer = null;
    this.conn = null;
    this._listeners = new Map();
    this._myRole = null;
    this._myName = '';
    this._peerName = '';
    this._pingTimer = null;
    this._lastPong = 0;
  }

  on(evt, cb) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(cb);
  }

  _emit(evt, ...args) {
    const cbs = this._listeners.get(evt);
    if (cbs) for (const cb of cbs) {
      try { cb(...args); } catch (e) { logger.error('listener error', evt, e); }
    }
  }

  get isConnected() {
    return !!this.conn && this.conn.open;
  }

  get myId() { return this.peer ? this.peer.id : ''; }
  get role() { return this._myRole; }
  get myName() { return this._myName; }
  get peerName() { return this._peerName; }

  /** Become the host. Resolves with the host ID to share. */
  async host(name = 'Host') {
    const Peer = await loadPeerJS();
    this._myRole = 'host';
    this._myName = name;
    return new Promise((resolve, reject) => {
      // Use a random ID with a stable prefix so it's easy to read aloud.
      this.peer = new Peer(`melvor-mp-${randomId()}`, { debug: 1 });
      this.peer.on('open', (id) => {
        logger.info('Host ready, id =', id);
        this._emit('id', id);
        resolve(id);
      });
      this.peer.on('connection', (conn) => this._attachConn(conn));
      this.peer.on('error', (err) => {
        logger.error('peer(host) error', err);
        this._emit('error', err);
        if (!this.conn) reject(err);
      });
    });
  }

  /** Connect to a host by their shared ID. */
  async connect(hostId, name = 'Peer') {
    const Peer = await loadPeerJS();
    this._myRole = 'peer';
    this._myName = name;
    return new Promise((resolve, reject) => {
      this.peer = new Peer(`melvor-mp-${randomId()}`, { debug: 1 });
      this.peer.on('open', () => {
        logger.info('Connecting to', hostId);
        const conn = this.peer.connect(hostId, { reliable: true });
        this._attachConn(conn, resolve, reject);
      });
      this.peer.on('error', (err) => {
        logger.error('peer(client) error', err);
        this._emit('error', err);
        reject(err);
      });
    });
  }

  _attachConn(conn, onReady, onErr) {
    this.conn = conn;
    conn.on('open', () => {
      logger.info('Data connection open');
      // Exchange names.
      this.send({ t: Msg.HELLO, name: this._myName, role: this._myRole });
      this._startPing();
      this._emit('open');
      if (onReady) onReady();
    });
    conn.on('data', (raw) => {
      const msg = decode(raw);
      if (!msg) return;
      if (msg.t === Msg.HELLO) {
        this._peerName = msg.name || 'Player';
        this.send({ t: Msg.WELCOME, name: this._myName, role: this._myRole });
        this._emit('open'); // surface connected state once we know the peer
        return;
      }
      if (msg.t === Msg.WELCOME) {
        this._peerName = msg.name || 'Player';
        return;
      }
      if (msg.t === Msg.PING) { this.send({ t: Msg.PONG, ts: msg.ts }); return; }
      if (msg.t === Msg.PONG) { this._lastPong = Date.now(); return; }
      this._emit('message', msg);
    });
    conn.on('close', () => {
      logger.info('Data connection closed');
      this._stopPing();
      this.conn = null;
      this._emit('close');
    });
    conn.on('error', (err) => {
      logger.error('conn error', err);
      this._emit('error', err);
      if (onErr) onErr(err);
    });
  }

  send(msg) {
    if (!this.isConnected) return false;
    try {
      // Log every outgoing message
      const msgName = msg.t || 'unknown';
      logger.info(`[SEND] ${msgName}`, JSON.stringify(msg).slice(0, 200));
      this.conn.send(encode(msg));
      return true;
    } catch (e) {
      logger.error('send failed', e);
      return false;
    }
  }

  _startPing() {
    this._stopPing();
    this._lastPong = Date.now();
    this._pingTimer = setInterval(() => {
      if (!this.isConnected) return;
      this.send({ t: Msg.PING, ts: Date.now() });
      // If we haven't heard a pong in 30s, consider the link dead.
      if (Date.now() - this._lastPong > 30000) {
        logger.warn('Ping timeout, closing connection');
        try { this.conn && this.conn.close(); } catch { /* noop */ }
      }
    }, 10000);
  }

  _stopPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  get latencyMs() {
    return this._lastPong ? Date.now() - this._lastPong : -1;
  }

  close() {
    this._stopPing();
    try { this.conn && this.conn.close(); } catch { /* noop */ }
    try { this.peer && this.peer.destroy(); } catch { /* noop */ }
    this.conn = null;
    this.peer = null;
    this._emit('close');
  }
}

function randomId() {
  // 4 base36 chars -> ~1.7M possibilities, plenty for a friendly code.
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}
