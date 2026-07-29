// src/mcp/auth.js — pure so it tests under node:test; the Worker is the only caller.
export function authorized(header, token) {
  if (typeof token !== 'string' || token.length < 16) return false; // unset/weak secret => closed
  return header === `Bearer ${token}`;
}
