import { useState, useEffect } from "react";
import { truncPk } from "./helpers";

// ── Nostr Profile Lookup (client-side, no server relay needed) ────────

export const _nostrProfileCache = new Map(); // pubkey → { name, picture, about, nip05, fetched }

// Seed from sessionStorage — profiles survive navigation without re-fetching
try {
  const stored = localStorage.getItem("nostr_profile_cache");
  if (stored) Object.entries(JSON.parse(stored)).forEach(([k, v]) => _nostrProfileCache.set(k, v));
} catch {}

const _pendingFetches = new Map(); // dedup simultaneous fetches for same pubkey
const NOSTR_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band", "wss://relay.primal.net", "wss://purplepag.es"];

export async function fetchNostrProfile(pubkey) {
  if (_nostrProfileCache.has(pubkey)) return _nostrProfileCache.get(pubkey);

  // Mark as fetching to avoid duplicate requests
  const placeholder = { name: null, picture: null, about: null, nip05: null, fetched: false };
  _nostrProfileCache.set(pubkey, placeholder);

  const fetchPromise = _doFetchNostrProfile(pubkey);
  _pendingFetches.set(pubkey, fetchPromise);
  fetchPromise.finally(() => _pendingFetches.delete(pubkey));
  return fetchPromise;
}

async function _doFetchNostrProfile(pubkey) {
  const placeholder = _nostrProfileCache.get(pubkey);

  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        placeholder.fetched = true;
        resolve(placeholder);
      }
    }, 4000);

    // Query all relays in parallel — first valid response wins
    for (const relay of NOSTR_RELAYS) {
      try {
        const ws = new WebSocket(relay);
        const subId = "p_" + pubkey.slice(0, 8);

        ws.onopen = () => {
          ws.send(JSON.stringify(["REQ", subId, { kinds: [0], authors: [pubkey], limit: 1 }]));
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg[0] === "EVENT" && msg[2]?.kind === 0) {
              const meta = JSON.parse(msg[2].content);
              const profile = {
                name: meta.name || meta.display_name || null,
                picture: meta.picture || null,
                about: meta.about || null,
                nip05: meta.nip05 || null,
                fetched: true,
              };
              _nostrProfileCache.set(pubkey, profile);
              // Persist to sessionStorage for fast re-use across navigation
              try {
                const existing = JSON.parse(localStorage.getItem("nostr_profile_cache") || "{}");
                existing[pubkey] = profile;
                localStorage.setItem("nostr_profile_cache", JSON.stringify(existing));
              } catch {}
              if (!resolved) { resolved = true; clearTimeout(timeout); resolve(profile); }
            }
            if (msg[0] === "EOSE") {
              ws.close();
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                placeholder.fetched = true;
                resolve(placeholder);
              }
            }
          } catch {}
        };

        ws.onerror = () => ws.close();
        // Only try first relay, move to next on failure
        ws.onclose = () => {};
        break; // only connect to first relay
      } catch {}
    }
  });
}

// Hook: useNostrProfile — returns { name, picture, about, loading }
export function useNostrProfile(pubkey) {
  const [profile, setProfile] = useState(() => _nostrProfileCache.get(pubkey) || null);

  useEffect(() => {
    if (!pubkey || pubkey.length !== 64) return;
    // If already cached with a real name, use it immediately
    if (_nostrProfileCache.has(pubkey) && _nostrProfileCache.get(pubkey).name) {
      setProfile(_nostrProfileCache.get(pubkey));
      return;
    }
    let cancelled = false;
    // Delay 400ms — prevents N simultaneous WebSockets on initial render
    const timer = setTimeout(() => {
      fetchNostrProfile(pubkey).then(p => { if (!cancelled) setProfile(p); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pubkey]);

  return {
    name: profile?.name || null,
    picture: profile?.picture || null,
    about: profile?.about || null,
    nip05: profile?.nip05 || null,
    loading: !profile?.fetched,
  };
}

// ── SellerName component — tappable, shows Nostr name or truncated pk ──

export function SellerName({ pubkey, onTap, style }) {
  const { name, loading } = useNostrProfile(pubkey);
  const displayName = name || truncPk(pubkey);
  return (
    <span
      onClick={onTap ? (e) => { e.stopPropagation(); onTap(pubkey); } : undefined}
      style={{
        fontFamily: name ? "inherit" : "monospace",
        fontSize: name ? 13 : 12,
        color: onTap ? "#a78bfa" : "#cbd5e1",
        cursor: onTap ? "pointer" : "default",
        textDecoration: onTap ? "underline" : "none",
        textDecorationColor: "rgba(167,139,250,0.3)",
        ...style,
      }}
    >
      {loading ? "…" : displayName}
    </span>
  );
}

// ── StarRating — display or input ──

export function StarRating({ score, onChange, size = 18 }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {stars.map(s => (
        <span
          key={s}
          onClick={onChange ? () => onChange(s) : undefined}
          style={{
            cursor: onChange ? "pointer" : "default",
            fontSize: size,
            color: s <= score ? "#f59e0b" : "#334155",
            transition: "color 0.15s",
          }}
        >★</span>
      ))}
    </span>
  );
}

// ── Icons ────────────────────────────────────────────────────────────

export const Icons = {
  Back: (p) => <svg {...p} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  Search: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Plus: (p) => <svg {...p} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Tag: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  Package: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  Refresh: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  X: (p) => <svg {...p} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Clock: (p) => <svg {...p} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
};

// ── Toast ────────────────────────────────────────────────────────────

export function Toast({ msg, type, visible }) {
  if (!visible) return null;
  return (
    <div style={{ position: "fixed", bottom: 120, left: 16, right: 16, padding: "12px 16px", borderRadius: 12, background: type === "error" ? "#7f1d1d" : "#064e3b", color: "#fff", fontSize: 13, fontWeight: 500, zIndex: 1000, textAlign: "center", animation: "slideUp 0.25s ease-out", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
      {msg}
    </div>
  );
}

