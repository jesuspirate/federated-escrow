// src/escrow_policy.rs

use miniscript::policy::Concrete;
use miniscript::bitcoin::PublicKey;

/// Escrow participants
/// - Seller: locks their sats into escrow (selling BTC for fiat)
/// - Buyer: sends fiat, receives sats on happy path
/// - Arbiter: resolves disputes
pub struct EscrowPolicy {
    pub seller: PublicKey,
    pub buyer: PublicKey,
    pub arbiter: PublicKey,
}

impl EscrowPolicy {
    pub fn new(seller: PublicKey, buyer: PublicKey, arbiter: PublicKey) -> Self {
        Self { seller, buyer, arbiter }
    }

    /// 2-of-3 multisig policy:
    ///
    /// Happy path: Seller + Buyer co-sign → sats go to BUYER
    ///   (Seller confirms fiat received, both sign release)
    ///
    /// Dispute (buyer cheated): Arbiter + Seller → sats RETURN to Seller
    ///   (Buyer claimed they sent fiat but didn't)
    ///
    /// Dispute (seller cheated): Arbiter + Buyer → sats go to Buyer
    ///   (Seller received fiat but won't release)
    pub fn to_miniscript_policy(&self) -> String {
        format!(
            "thresh(2,pk({}),pk({}),pk({}))",
            self.seller, self.buyer, self.arbiter
        )
    }

    /// Parse into a concrete policy
    pub fn parse(&self) -> Result<Concrete<PublicKey>, Box<dyn std::error::Error>> {
        let policy_str = self.to_miniscript_policy();
        let policy = Concrete::<PublicKey>::from_str(&policy_str)?;
        Ok(policy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_roles_documented() {
        // This test just validates our understanding of the flow:
        //
        // SELLER has sats, wants fiat → locks sats in escrow
        // BUYER has fiat, wants sats → sends fiat, then receives sats
        //
        // The 2-of-3 multisig determines WHO the sats go to:
        //   Seller + Buyer sign → Buyer gets sats (happy path)
        //   Arbiter + Seller sign → Seller gets refund (buyer lied)
        //   Arbiter + Buyer sign → Buyer gets sats (seller lied)
        //
        // The DESTINATION ADDRESS in the release TX determines the recipient,
        // not the policy itself. The policy just controls who can authorize.
        assert!(true);
    }
}
