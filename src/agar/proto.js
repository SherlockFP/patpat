// Shared constants of the KARTOPU ARENA online protocol (tiny, statically imported).
export const VERSION = 5; // bump when the wire protocol changes; rooms of other versions are hidden / refused
export const MAX_HUMANS = 8;
/** ?net=local keeps the client off the public P2P lobby (PeerJS / Nostr) entirely: test browsers must never join it */
export const isNetLocal = (search) => { try { return new URLSearchParams(search).get('net') === 'local'; } catch { return false; } };
export const NET_LOCAL = typeof location !== 'undefined' && isNetLocal(location.search);
/** solo rival: the nearest bot that is a bit heavier than the player (it hunts you, you dethrone it); nobody heavier -> the heaviest bot. -1 = none */
export function pickRival(owners, meId, meMass) {
  let up = -1, upM = 1e18, top = -1, topM = 0;
  for (let i = 1; i < owners.length; i++) {
    const o = owners[i];
    if (i === meId || !o.alive || o.away || o.boss || o.human || o.hideT > 0 || o.mass < 20) continue;
    if (o.mass >= meMass * 1.15 && o.mass < upM) { upM = o.mass; up = i; }
    if (o.mass > topM) { topM = o.mass; top = i; }
  }
  return up >= 0 ? up : top;
}
