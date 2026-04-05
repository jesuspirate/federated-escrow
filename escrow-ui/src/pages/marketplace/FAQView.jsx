import { useState } from "react";
import { t } from "../i18n";
import M from "./styles";

export default function FAQView({ onBack, subdomain }) {
  const [openIdx, setOpenIdx] = useState(null);

  const faqs = [
    { category: "Getting Started", icon: "🚀", items: [
      { q: "What is SatoshiMarket?", a: "SatoshiMarket is a Bitcoin-native peer-to-peer marketplace built on Fedimint and Nostr. You can buy and sell items, exchange sats for fiat, and even borrow or lend Bitcoin — all secured by escrow." },
      { q: "How does escrow work?", a: "When a trade starts, the seller (or buyer, depending on the trade type) locks their sats in a secure escrow. Both parties must agree the trade is complete before sats are released. If there's a disagreement, a community arbiter casts the deciding vote." },
      { q: "Do I need a Fedi account?", a: "Yes! SatoshiMarket runs as a Fedi Mini-App. You need the Fedi app with a federation wallet. Your identity is your Nostr keypair managed by Fedi — no emails, no passwords." },
      { q: "Is there a fee?", a: "A small 0.5% platform fee is taken from each completed trade. Disputed trades also incur a 1% arbiter fee. There are no listing fees." },
    ]},
    { category: "Buying", icon: "🛒", items: [
      { q: "How do I buy something?", a: "Browse listings, tap one you like, and press the buy button. Your sats will be locked in escrow. Once the seller ships the item (or completes the service), you confirm receipt and the sats are released to them." },
      { q: "What if I don't receive my item?", a: "If the seller doesn't deliver, vote 'Dispute' instead of confirming. An arbiter will review the case and can refund your sats." },
      { q: "What does 'Lock Payment' mean?", a: "Locking means your sats are moved from your Fedi wallet into a secure escrow. They can't be spent by anyone until the trade is resolved. Think of it as putting money in a safe that needs two keys to open." },
    ]},
    { category: "Selling", icon: "🏪", items: [
      { q: "How do I list an item?", a: "Tap 'Create Listing', fill in the details (title, price, description, terms), and submit. Your listing goes live immediately. You can pause or delete it anytime." },
      { q: "How do I get paid?", a: "After the buyer locks payment and you deliver the item, both of you vote to release. The sats are then transferred to your Fedi wallet automatically." },
      { q: "What is 'Federation Only'?", a: "Toggling this on makes your listing visible only to users in your same federation. Great for community-only trades or local services." },
    ]},
    { category: "P2P Trading", icon: "💱", items: [
      { q: "What is P2P sats-for-fiat?", a: "You can sell Bitcoin for fiat currency (like KES, USD, CFA) or buy Bitcoin with fiat. The sats are locked in escrow while the fiat payment happens externally (M-Pesa, bank transfer, cash, etc)." },
      { q: "What's a rate premium?", a: "Sellers can add a percentage premium to the exchange rate. For example, a 3% premium on 10,000 sats means the buyer pays 10,300 sats worth. This compensates the seller for liquidity." },
      { q: "How does bracket pricing work?", a: "Instead of a fixed price, sellers can set a range (e.g., 5,000 — 50,000 sats). Buyers choose how much they want to trade within that range." },
    ]},
    { category: "Lending", icon: "🤝", items: [
      { q: "How do loans work?", a: "A lender creates a loan offer with terms (amount, interest, repayment period). A borrower accepts it, and the lender locks sats in escrow. After both confirm, the borrower receives the sats. A repayment escrow is automatically created." },
      { q: "What are Lending Levels?", a: "Your lending level determines the maximum loan you can borrow. Level 1 (Newcomer): up to 5,000 sats. Level 2 (Member): 25,000. Level 3 (Trusted): 100,000. Level 4 (Senior): 500,000. Level 5 (Elder): 2,000,000. You level up by repaying loans on time." },
      { q: "What happens if I don't repay?", a: "Your trust score drops, reducing your lending level. Future loans will be limited or unavailable. The lender can open a dispute, and overdue loans are flagged on your profile." },
      { q: "How is interest calculated?", a: "Interest is set by the lender as a percentage (e.g., 5%). It's calculated on the principal and added to the repayment amount. For a 5,000 sat loan at 5%, you repay 5,250 sats." },
    ]},
    { category: "Safety & Disputes", icon: "🛡️", items: [
      { q: "What if the other party cheats?", a: "Vote 'Dispute' in the escrow. A community arbiter — a trusted federation member — will review the evidence and cast the deciding vote. The arbiter has 4 hours to respond." },
      { q: "Can the platform steal my sats?", a: "No. Sats are locked as Fedimint e-cash in escrow. The platform cannot move funds unilaterally — it requires 2-of-3 agreement (buyer, seller, arbiter). We are building toward cryptographically enforced non-custodial escrow using Shamir Secret Sharing." },
      { q: "Who are the arbiters?", a: "Arbiters are trusted community members who applied and were approved. They earn a 1% fee for resolving disputes. You can apply to become one from the Arbiters page." },
    ]},
    { category: "Federations", icon: "🏛️", items: [
      { q: "What is a federation?", a: "A federation is a group of people who share a Fedimint wallet. Think of it as a community bank, but run by the community itself. Each federation has its own guardians and rules." },
      { q: "Why does my federation matter?", a: "Trades require both parties to be on the same federation. This is because the escrow locks e-cash that is specific to your federation. It also enables community governance — federation-only listings, local arbiters, and lending within your community." },
      { q: "How do I join a federation?", a: "Open Fedi, go to your home screen, and join a federation using an invite code. Currently supported federations include Bitcoin Life, Global Bitcoin Federation, Afribit Kibera, and Bitsacco." },
    ]},
  ];

  let globalIdx = 0;
  return (
    <div style={M.container}>
      <div style={M.viewHeader}>
        <button style={M.iconBtn} onClick={onBack}><Icons.Back /></button>
        <h2 style={M.viewTitle}>❓ FAQ</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ padding: "0 4px 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Everything you need to know about trading on SatoshiMarket</div>
        </div>

        {faqs.map((cat, ci) => (
          <div key={ci} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>{cat.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>{cat.category}</span>
            </div>
            {cat.items.map((item, ii) => {
              const idx = globalIdx++;
              const isOpen = openIdx === idx;
              return (
                <button key={ii} onClick={() => setOpenIdx(isOpen ? null : idx)} style={{ width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 4, borderRadius: 10, background: isOpen ? "rgba(139,92,246,0.06)" : "#111827", border: isOpen ? "1px solid rgba(139,92,246,0.2)" : "1px solid #1e293b", cursor: "pointer", transition: "all 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: isOpen ? "#a78bfa" : "#e2e8f0", flex: 1 }}>{item.q}</span>
                    <span style={{ fontSize: 14, color: "#475569", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0, marginLeft: 8 }}>▼</span>
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8", lineHeight: 1.7, borderTop: "1px solid #1e293b30", paddingTop: 8 }}>
                      {item.a}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

