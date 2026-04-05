// ═══════════════════════════════════════════════════════════════════════
// Marketplace Constants — extracted from Marketplace.jsx
// ═══════════════════════════════════════════════════════════════════════

export const MAPI = "/api/marketplace/listings";

export const FED_NAMES_GLOBAL = {
  "AwEEiItw7A": { name: "Bitcoin Life", emoji: "🏛️", color: "#a78bfa" },
  "AwEEG8tk5g": { name: "Global Bitcoin Federation", emoji: "🏛️", color: "#f59e0b" },
  "AwEE_yhqbg": { name: "Afribit Kibera", emoji: "🏛️", color: "#10b981" },
};

export const DEV_IDENTITIES = {
  seller:  "aa".repeat(32),
  buyer:   "bb".repeat(32),
  arbiter: "cc".repeat(32),
};

export const SATS_FOR_FIAT = "sats-for-fiat";
export const BILL_PAY = "bill-pay";
export const LENDING = "lending";

export const CURRENCY_SYMBOLS = {
  USD: "$", EUR: "€", GBP: "£", CFA: "CFA ", KES: "KSh ", TZS: "TSh ", NGN: "₦",
  BRL: "R$", ARS: "ARS ", INR: "₹", ZAR: "R", CAD: "CA$", CHF: "CHF ", AUD: "A$", JPY: "¥",
};

export const PAYMENT_METHODS = [
  { key: "mpesa", label: "M-Pesa", icon: "📱", region: "East Africa" },
  { key: "airtel", label: "Airtel Money", icon: "📱", region: "East Africa" },
  { key: "mtn", label: "MTN MoMo", icon: "📱", region: "West Africa" },
  { key: "orange", label: "Orange Money", icon: "🟧", region: "West Africa" },
  { key: "wave", label: "Wave", icon: "🌊", region: "West Africa" },
  { key: "opay", label: "OPay", icon: "💚", region: "West Africa" },
  { key: "chipper", label: "Chipper Cash", icon: "💸", region: "Africa" },
  { key: "cashapp", label: "Cash App", icon: "💵", region: "US" },
  { key: "zelle", label: "Zelle", icon: "💸", region: "US" },
  { key: "venmo", label: "Venmo", icon: "💙", region: "US" },
  { key: "wise", label: "Wise", icon: "🌍", region: "Global" },
  { key: "paypal", label: "PayPal", icon: "🅿️", region: "Global" },
  { key: "bank", label: "Bank Transfer", icon: "🏦", region: "Global" },
  { key: "cash", label: "Cash (in person)", icon: "💰", region: "Local" },
  { key: "revolut", label: "Revolut", icon: "💳", region: "Europe" },
  { key: "pix", label: "PIX", icon: "🇧🇷", region: "Brazil" },
  { key: "upi", label: "UPI", icon: "🇮🇳", region: "India" },
  { key: "gcash", label: "GCash", icon: "📱", region: "Philippines" },
  { key: "ecocash", label: "EcoCash", icon: "📱", region: "Zimbabwe" },
];

export const BILL_TYPES = [
  { id: "electricity", label: "Electricity", icon: "⚡" },
  { id: "phone", label: "Phone / Airtime", icon: "📱" },
  { id: "internet", label: "Internet", icon: "🌐" },
  { id: "rent", label: "Rent", icon: "🏠" },
  { id: "school", label: "School Fees", icon: "🎓" },
  { id: "car", label: "Car Payment", icon: "🚗" },
  { id: "water", label: "Water", icon: "💧" },
  { id: "insurance", label: "Insurance", icon: "🛡️" },
  { id: "other", label: "Other", icon: "📦" },
];

export const CONDITION_KEYS = { "new": "mkCondNew", "used": "mkCondUsed", "digital": "mkCondDigital", "service": "mkCondService" };

export const FED_LIMITS = { MAX_TX_SATS: 2_000_000, PROBE_SATS: 1 };

export const CATEGORIES = [
  { key: "all", label: "Public", icon: "🌍" },
  { key: "mine", label: "Mine", icon: "🏠" },
  { key: "sats-for-fiat", label: "P2P", icon: "₿" },
  { key: "lending", label: "Lending", icon: "🤝" },
  { key: "electronics", label: "Electronics", icon: "📱" },
  { key: "services", label: "Services", icon: "🛠️" },
  { key: "digital", label: "Digital", icon: "💾" },
  { key: "clothing", label: "Clothing", icon: "👕" },
  { key: "shipping", label: "Shipping", icon: "📦" },
  { key: "other", label: "Other", icon: "🏷️" },
];

export const LEARN_DISMISSED_KEY = "fedi-mk-learn-dismissed";
