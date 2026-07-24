// Wire protocol for the realMultiplayer mod.
//
// Every message is a JSON object of the shape:
//   { t: <MessageType>, ...payload }
//
// Messages are intentionally small and idempotent where possible: state
// messages carry absolute values (new XP, new bank qty) rather than deltas,
// so a duplicated or out-of-order message converges to the same result.

export const Msg = Object.freeze({
  // Handshake / presence
  HELLO: 'hello',        // { name, role: 'host'|'peer' }
  WELCOME: 'welcome',    // { name, role }
  PING: 'ping',          // { ts }
  PONG: 'pong',          // { ts }

  // Action reservation (which skill each player is training)
  ACTION_CLAIM: 'claim', // { skillId, recipeId|null, label }
  ACTION_RELEASE: 'release', // { skillId }

  // State sync (absolute values)
  XP: 'xp',              // { skillId, xp, abyssalXp? }
  MASTERY: 'mastery',    // { skillId, actionId, xp }
  MASTERY_POOL: 'pool',  // { skillId, realmId, xp }
  BANK: 'bank',          // { itemId, qty }
  CURRENCY: 'currency',  // { currencyId, qty }

  // Bulk state exchange (peer asks host for a full snapshot on connect)
  STATE_REQUEST: 'state_req',
  STATE_SNAPSHOT: 'state_snap', // { skills: [{id,xp,abyssalXp?}], bank: [{id,qty}], ... }
});

export const encode = (msg) => JSON.stringify(msg);

export const decode = (data) => {
  try {
    const msg = typeof data === 'string' ? JSON.parse(data) : data;
    if (!msg || typeof msg.t !== 'string') return null;
    return msg;
  } catch {
    return null;
  }
};
