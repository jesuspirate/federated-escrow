// escrow-ui/src/services/nostr-auth.ts
//
// Nostr authentication for Fedi Mini-App Escrow
//
// Uses NIP-07 (window.nostr) to get the user's identity from Fedi's
// injected provider. Uses NIP-98 (kind 27235) to sign HTTP requests
// so the server can verify each API call cryptographically.
//
// Inside Fedi: window.nostr is injected automatically by the in-app browser.
// Outside Fedi: falls back to browser extensions (nos2x, Alby, etc.)
// Dev mode: uses a generated keypair for testing without Fedi/extension.

// ── Types ─────────────────────────────────────────────────────────────────

export interface NostrProvider {
  getPublicKey(): Promise<string>; // hex pubkey
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;
}

export interface UnsignedEvent {
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

export interface AuthState {
  pubkey: string | null; // hex format
  npub: string | null; // bech32 npub format
  provider: "fedi" | "extension" | "dev" | null;
  error: string | null;
}

// ── Bech32 npub encoding (minimal, no deps) ──────────────────────────────

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) ret.push((polymod >> (5 * (5 - i))) & 31);
  return ret;
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }
  return ret;
}

export function hexToNpub(hex: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  const words = convertBits(bytes, 8, 5, true);
  const checksum = bech32CreateChecksum("npub", words);
  const combined = words.concat(checksum);
  return "npub" + "1" + combined.map((d) => BECH32_CHARSET[d]).join("");
}

export function npubToHex(npub: string): string | null {
  if (!npub.startsWith("npub1")) return null;
  const data = npub.slice(5);
  const words: number[] = [];
  for (const c of data) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) return null;
    words.push(idx);
  }
  // Remove 6-char checksum
  const dataWords = words.slice(0, -6);
  const bytes = convertBits(dataWords, 5, 8, false);
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Detect Nostr provider ─────────────────────────────────────────────────

declare global {
  interface Window {
    nostr?: NostrProvider;
  }
}

export function detectProvider(): "fedi" | "extension" | null {
  if (typeof window === "undefined") return null;

  // In Fedi's webview, window.nostr is injected by the app
  // We can detect Fedi by checking for window.fedi or user agent
  if (window.nostr) {
    // Fedi injects both window.nostr and runs in a specific webview
    // For now we treat any window.nostr as potentially Fedi
    // The federation ID in the user's npub confirms they're in Fedi
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("fedi") || ua.includes("fedimint")) {
      return "fedi";
    }
    return "extension";
  }

  return null;
}

// ── Connect to Nostr identity ─────────────────────────────────────────────

export async function connect(): Promise<AuthState> {
  const providerType = detectProvider();

  if (!providerType || !window.nostr) {
    return {
      pubkey: null,
      npub: null,
      provider: null,
      error:
        "No Nostr provider found. Open this app inside Fedi, or install a NIP-07 " +
        "browser extension (nos2x, Alby, etc.) to sign in with your Nostr identity.",
    };
  }

  try {
    const pubkey = await window.nostr.getPublicKey();
    const npub = hexToNpub(pubkey);

    return {
      pubkey,
      npub,
      provider: providerType,
      error: null,
    };
  } catch (err: any) {
    return {
      pubkey: null,
      npub: null,
      provider: null,
      error: `Failed to get public key: ${err.message || err}`,
    };
  }
}

// ── NIP-98 HTTP Auth ──────────────────────────────────────────────────────
//
// Signs a kind 27235 event for HTTP request authentication.
// The server verifies the signature to confirm the caller owns the npub.
//
// Flow:
//   1. Client creates an unsigned event with URL + method
//   2. window.nostr.signEvent() signs it (Fedi shows confirmation dialog)
//   3. Client sends it as `Authorization: Nostr <base64>` header
//   4. Server decodes, verifies signature, extracts pubkey
//
// This replaces the old random token system entirely.

export async function createAuthHeader(
  url: string,
  method: string,
  body?: any
): Promise<string> {
  if (!window.nostr) {
    throw new Error("No Nostr provider available");
  }

  const tags: string[][] = [
    ["u", url],
    ["method", method.toUpperCase()],
  ];

  // Include payload hash for POST/PUT/PATCH
  if (body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    const encoder = new TextEncoder();
    const data = encoder.encode(bodyStr);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    tags.push(["payload", hashHex]);
  }

  const unsignedEvent: UnsignedEvent = {
    created_at: Math.floor(Date.now() / 1000),
    kind: 27235,
    tags,
    content: "",
  };

  const signedEvent = await window.nostr.signEvent(unsignedEvent);

  // Base64 encode the signed event
  const eventJson = JSON.stringify(signedEvent);
  const base64 = btoa(eventJson);

  return `Nostr ${base64}`;
}

// ── Authenticated fetch wrapper ───────────────────────────────────────────
//
// Drop-in replacement for fetch() that automatically adds NIP-98 auth.
// Usage:
//   const res = await authFetch("http://localhost:3000/api/ecash-escrows", {
//     method: "POST",
//     body: JSON.stringify({ amountMsats: 100000 }),
//   });

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = options.method || "GET";
  const body = options.body;

  let authHeader: string;
  try {
    authHeader = await createAuthHeader(url, method, body);
  } catch (err) {
    throw new Error(`NIP-98 auth failed: ${err}`);
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", authHeader);
  if (body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

// ── Dev mode helpers ──────────────────────────────────────────────────────
//
// For local development without Fedi or a browser extension.
// Generates a random keypair and uses simple HMAC-based auth.
// The server accepts dev tokens when NODE_ENV !== "production".

const DEV_STORAGE_KEY = "fedi-escrow-dev-identity";

export function getDevIdentity(): { pubkey: string; npub: string } | null {
  if (typeof localStorage === "undefined") return null;
  const stored = localStorage.getItem(DEV_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

export function createDevIdentity(): { pubkey: string; npub: string } {
  // Generate a random 32-byte hex string as a fake pubkey
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const pubkey = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const npub = hexToNpub(pubkey);

  const identity = { pubkey, npub };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(identity));
  }
  return identity;
}

// Dev fetch — sends pubkey in a simple header (no cryptographic proof)
// Server MUST only accept this in non-production mode
export async function devFetch(
  url: string,
  pubkey: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers || {});
  headers.set("X-Dev-Pubkey", pubkey);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

// ── Extract federation ID from Fedi profile link ──────────────────────────
//
// Fedi profile links look like:
//   https://app.fedi.xyz/link?screen=user&id=@npub1abc...:m1.8fa.in
//
// The federation ID is the part after the colon: "m1.8fa.in"

export function extractFederationId(profileLink: string): string | null {
  try {
    const match = profileLink.match(/:([a-zA-Z0-9.-]+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// Extract npub from Fedi profile link
export function extractNpubFromProfileLink(profileLink: string): string | null {
  try {
    const match = profileLink.match(/@(npub1[a-z0-9]+):/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── Validate fedi:room: community link format ─────────────────────────────

export function isValidCommunityLink(link: string): boolean {
  // Format: fedi:room:!<roomId>:<federationDomain>:::
  return /^fedi:room:![a-zA-Z0-9]+:[a-zA-Z0-9.-]+:::$/.test(link.trim());
}

export function extractFederationFromRoom(roomLink: string): string | null {
  const match = roomLink.match(/^fedi:room:![a-zA-Z0-9]+:([a-zA-Z0-9.-]+):::$/);
  return match ? match[1] : null;
}
