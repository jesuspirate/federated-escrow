// ═══════════════════════════════════════════════════════════════════════
// Marketplace Helpers — pure utility functions extracted from Marketplace.jsx
// ═══════════════════════════════════════════════════════════════════════

import { SATS_FOR_FIAT, BILL_PAY, LENDING, FED_NAMES_GLOBAL } from "./constants";

// ── Trade Type Detection ──
export function isBillPay(category) { return category?.toLowerCase().trim() === BILL_PAY; }
export function isSatsForFiat(category) { return category?.toLowerCase().trim() === SATS_FOR_FIAT; }
export function isLending(category) { return category?.toLowerCase().trim() === LENDING; }
export function isLenderTrade(category) { return isLending(category); }
export function isSpecialCategory(category) { return isSatsForFiat(category) || isLending(category) || isBillPay(category); }

// ── Formatting ──
export function fmtSats(msats) { return Math.floor(msats / 1000).toLocaleString(); }
export function fmtSatsShort(msats) {
  const sats = Math.floor(msats / 1000);
  if (sats >= 1000000) return (sats / 1000000).toFixed(1) + "M";
  if (sats >= 10000) return (sats / 1000).toFixed(0) + "K";
  if (sats >= 1000) return (sats / 1000).toFixed(1) + "K";
  return sats.toLocaleString();
}
export function fmtVolume(msats) {
  const sats = Math.floor(msats / 1000);
  if (sats >= 1_000_000_000) return (sats / 1_000_000_000).toFixed(1) + "B";
  if (sats >= 1_000_000) return (sats / 1_000_000).toFixed(1) + "M";
  if (sats >= 100_000) return (sats / 1_000).toFixed(0) + "K";
  if (sats >= 1_000) return (sats / 1_000).toFixed(1) + "K";
  return sats.toLocaleString();
}

export function msatsToFiat(msats, rates, currency = "USD") {
  if (!rates || !rates.btcUsd) return null;
  const btc = msats / 100_000_000_000;
  const usd = btc * rates.btcUsd;
  if (currency === "USD") return usd;
  const rate = rates.rates?.[currency];
  return rate ? usd * rate : null;
}

export function fmtFiat(msats, rates, currency = "USD") {
  const val = msatsToFiat(msats, rates, currency);
  if (val === null) return null;
  const sym = { USD: "$", EUR: "€", GBP: "£", TZS: "TSh", KES: "KSh", NGN: "₦", UGX: "USh", GHS: "GH₵", XOF: "CFA", ZAR: "R", BRL: "R$", CAD: "CA$", AUD: "A$", JPY: "¥", CHF: "CHF", INR: "₹" }[currency] || currency + " ";
  if (val < 0.01) return sym + val.toFixed(4);
  if (val < 1000) return sym + val.toFixed(2);
  return sym + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ── Pubkey helpers ──
export function truncPk(hex) {
  if (!hex || hex.length < 16) return hex || "";
  return hex.slice(0, 8) + "…" + hex.slice(-8);
}

// ── Federation helpers ──
export function getFedName(prefix, domain) {
  if (domain && domain.toLowerCase().includes("bitsacco")) return "Bitsacco";
  if (prefix && FED_NAMES_GLOBAL[prefix]) return FED_NAMES_GLOBAL[prefix].name;
  if (domain) return domain.replace(/^m\d+\./, "").replace(/\.in$/, "").replace(/\.com$/, "");
  return domain || prefix || "Unknown";
}

export function getFedInfo(prefix, domain) {
  if (prefix && FED_NAMES_GLOBAL[prefix]) return FED_NAMES_GLOBAL[prefix];
  if (domain && domain.toLowerCase().includes("bitsacco")) return { name: "Bitsacco", emoji: "🏛️", color: "#f59e0b" };
  if (domain) return { name: domain.replace(/^m\d+\./, "").replace(/\.in$/, "").replace(/\.com$/, ""), emoji: "🏛️", color: "#64748b" };
  return null;
}

// ── Live rate recalculation for bill-pay ──
export function recalcBillPaySats(listing, fiatRates) {
  if (!fiatRates || !fiatRates.btcUsd) return null;
  const fm = (listing.terms || "").match(/Fiat needed:\s*(\w+)\s+([\d.]+)/);
  const rm = (listing.terms || "").match(/Rate:\s*(\d+)/);
  if (!fm) return null;
  const fx = fiatRates.rates[fm[1]] || 1;
  const usd = parseFloat(fm[2]) / fx;
  const base = Math.floor((usd / fiatRates.btcUsd) * 100000000);
  const prem = rm ? parseInt(rm[1]) : 0;
  return Math.floor(base * (1 + prem / 100));
}
