// In-game UI panel for the realMultiplayer mod.
//
// A small floating panel (top-right) that lets a player host or join a
// session, see the connection status, share their save, and see what each
// player is currently training. All DOM is built imperatively to avoid
// depending on the game's template loader.

import { logger } from '../util/logger.mjs';
import { Msg } from '../net/protocol.mjs';

export class Panel {
  constructor({ transport, actionLock, sync }) {
    this.transport = transport;
    this.actionLock = actionLock;
    this.sync = sync;
    this.root = null;
    this._statusTimer = null;
  }

  mount() {
    if (this.root) return;
    this.root = document.createElement('div');
    this.root.className = 'rmp-panel';
    this.root.innerHTML = `
      <div class="rmp-header">
        <span class="rmp-title">Multiplayer</span>
        <span class="rmp-status" data-rmp="status">Offline</span>
      </div>
      <div class="rmp-body">
        <div class="rmp-row" data-rmp="connectRow">
          <input class="rmp-input" data-rmp="nameInput" placeholder="Your name" maxlength="16" />
        </div>
        <div class="rmp-row rmp-buttons">
          <button class="rmp-btn" data-rmp="hostBtn">Host</button>
          <button class="rmp-btn" data-rmp="joinBtn">Join</button>
        </div>
        <div class="rmp-row" data-rmp="joinRow" hidden>
          <input class="rmp-input" data-rmp="hostIdInput" placeholder="Host code" />
          <button class="rmp-btn" data-rmp="connectBtn">Connect</button>
        </div>
        <div class="rmp-row" data-rmp="hostRow" hidden>
          <label class="rmp-label">Share this code:</label>
          <div class="rmp-codeRow">
            <code class="rmp-code" data-rmp="hostCode">…</code>
            <button class="rmp-btn rmp-btn-sm" data-rmp="copyCodeBtn">Copy</button>
          </div>
        </div>
        <div class="rmp-row" data-rmp="connectedRow" hidden>
          <div class="rmp-peer">
            <span data-rmp="peerName">—</span>
            <span class="rmp-ping" data-rmp="ping">—</span>
          </div>
          <button class="rmp-btn rmp-btn-danger" data-rmp="disconnectBtn">Disconnect</button>
        </div>
        <hr class="rmp-sep" />
        <div class="rmp-players">
          <div class="rmp-player">
            <span class="rmp-dot rmp-dot-local"></span>
            <span class="rmp-playername" data-rmp="localName">You</span>
            <span class="rmp-action" data-rmp="localAction">Idle</span>
          </div>
          <div class="rmp-player">
            <span class="rmp-dot rmp-dot-remote"></span>
            <span class="rmp-playername" data-rmp="remoteName">Peer</span>
            <span class="rmp-action" data-rmp="remoteAction">Idle</span>
          </div>
        </div>
        <div class="rmp-conflict" data-rmp="conflict" hidden>
          Both players are training the same skill — coordinate to avoid wasted effort.
        </div>
        <hr class="rmp-sep" />
        <button class="rmp-btn rmp-btn-sm" data-rmp="copySaveBtn">Copy current save to clipboard</button>
        <p class="rmp-hint" data-rmp="hint">Tip: both players must load the same save before connecting.</p>
      </div>
    `;
    document.body.appendChild(this.root);
    this._wire();
    this._statusTimer = setInterval(() => this._refreshStatus(), 1000);
    this._refresh();
  }

  unmount() {
    if (this._statusTimer) { clearInterval(this._statusTimer); this._statusTimer = null; }
    if (this.root) { this.root.remove(); this.root = null; }
  }

  _wire() {
    const $ = (sel) => this.root.querySelector(`[data-rmp="${sel}"]`);

    $('hostBtn').addEventListener('click', async () => {
      const name = $('nameInput').value.trim() || 'Host';
      $('hostBtn').disabled = true;
      try {
        const id = await this.transport.host(name);
        $('hostCode').textContent = id;
        this._showRow('hostRow');
      } catch (e) {
        logger.error('host failed', e);
        alert(`Failed to host: ${e.message || e}`);
      } finally {
        $('hostBtn').disabled = false;
      }
    });

    $('joinBtn').addEventListener('click', () => {
      this._showRow('joinRow');
    });

    $('connectBtn').addEventListener('click', async () => {
      const name = $('nameInput').value.trim() || 'Peer';
      const hostId = $('hostIdInput').value.trim();
      if (!hostId) { alert('Enter the host code.'); return; }
      $('connectBtn').disabled = true;
      try {
        await this.transport.connect(hostId, name);
      } catch (e) {
        logger.error('connect failed', e);
        alert(`Failed to connect: ${e.message || e}`);
      } finally {
        $('connectBtn').disabled = false;
      }
    });

    $('disconnectBtn').addEventListener('click', () => this.transport.close());

    $('copyCodeBtn').addEventListener('click', () => {
      const code = $('hostCode').textContent;
      copyToClipboard(code);
      $('copyCodeBtn').textContent = 'Copied!';
      setTimeout(() => ($('copyCodeBtn').textContent = 'Copy'), 1200);
    });

    $('copySaveBtn').addEventListener('click', async () => {
      try {
        const save = game.generateSaveString();
        await copyToClipboard(save);
        $('copySaveBtn').textContent = 'Copied!';
      } catch (e) {
        logger.error('save copy failed', e);
        alert(`Could not copy save: ${e.message || e}`);
      } finally {
        setTimeout(() => ($('copySaveBtn').textContent = 'Copy current save to clipboard'), 1500);
      }
    });

    // Transport events drive panel state.
    this.transport.on('open', () => {
      this._showRow('connectedRow');
      this._hideRow('hostRow');
      this._hideRow('joinRow');
      // As the joining peer, ask the host for a full state snapshot.
      if (this.transport.role === 'peer') this.sync.requestSnapshot();
      this._refresh();
    });
    this.transport.on('close', () => {
      this._hideRow('connectedRow');
      this._hideRow('hostRow');
      this.actionLock.reset();
      this._refresh();
    });
    this.transport.on('error', (e) => {
      $('status').textContent = 'Error';
      logger.error('transport error', e);
    });

    // Action lock changes refresh the "who trains what" display.
    this.actionLock.setOnChange(() => this._refreshActions());
  }

  _showRow(name) {
    const el = this.root.querySelector(`[data-rmp="${name}"]`);
    if (el) el.hidden = false;
  }
  _hideRow(name) {
    const el = this.root.querySelector(`[data-rmp="${name}"]`);
    if (el) el.hidden = true;
  }

  _refreshStatus() {
    const $ = (s) => this.root.querySelector(`[data-rmp="${s}"]`);
    if (!this.root) return;
    const status = $('status');
    if (this.transport.isConnected) {
      status.textContent = 'Connected';
      status.classList.add('rmp-ok');
      $('ping').textContent = `${this.transport.latencyMs}ms`;
    } else if (this.transport.myId) {
      status.textContent = 'Hosting';
      status.classList.remove('rmp-ok');
      $('ping').textContent = '—';
    } else {
      status.textContent = 'Offline';
      status.classList.remove('rmp-ok');
      $('ping').textContent = '—';
    }
  }

  _refresh() {
    if (!this.root) return;
    this._refreshStatus();
    this._refreshActions();
  }

  _refreshActions() {
    if (!this.root) return;
    const $ = (s) => this.root.querySelector(`[data-rmp="${s}"]`);
    const lock = this.actionLock;
    $('localName').textContent = this.transport.myName || 'You';
    $('remoteName').textContent = this.transport.peerName || 'Peer';
    $('localAction').textContent = lock.local ? formatAction(lock.local) : 'Idle';
    $('remoteAction').textContent = lock.remote ? formatAction(lock.remote) : 'Idle';
    $('conflict').hidden = !lock.isConflict();
  }
}

function formatAction(claim) {
  if (!claim) return 'Idle';
  const skill = game.skills.getObjectByID(claim.skillId);
  const skillName = skill ? skill.name : claim.skillId;
  if (claim.recipeId) {
    return `${skillName} (${claim.recipeId.split(':').pop()})`;
  }
  return skillName;
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts (some browser clients).
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}
