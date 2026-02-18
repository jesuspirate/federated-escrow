// src/escrow_tx.rs

use bitcoin::{Address, Amount, Transaction, Txid};

/// Represents the escrow lifecycle
pub struct EscrowTransaction {
    /// The seller locks sats here
    pub escrow_address: Address,
    /// Where sats go on happy path (BUYER's address)
    pub buyer_payout_address: Address,
    /// Where sats return on refund (SELLER's address)
    pub seller_refund_address: Address,
    /// The fee in satoshis
    pub fee_sats: u64,
}

impl EscrowTransaction {
    pub fn new(
        escrow_address: Address,
        buyer_payout_address: Address,
        seller_refund_address: Address,
        fee_sats: u64,
    ) -> Self {
        Self {
            escrow_address,
            buyer_payout_address,
            seller_refund_address,
            fee_sats,
        }
    }

    /// Build the FUNDING transaction
    /// Seller sends their sats INTO the escrow multisig
    pub fn build_funding_tx(&self, seller_utxo: Txid, amount: Amount) -> Transaction {
        // Seller's UTXO → Escrow Address
        todo!("Build funding TX: Seller locks sats into escrow")
    }

    /// Build the RELEASE transaction (happy path)
    /// Seller confirmed fiat received → sats go to BUYER
    /// Requires: Seller + Buyer signatures
    pub fn build_release_to_buyer_tx(
        &self,
        escrow_utxo: Txid,
        amount: Amount,
    ) -> Transaction {
        // Escrow UTXO → Buyer's payout address (minus fees)
        todo!("Build release TX: Escrow → Buyer")
    }

    /// Build the REFUND transaction (dispute: buyer lied)
    /// Arbiter sides with seller → sats return to SELLER
    /// Requires: Arbiter + Seller signatures
    pub fn build_refund_to_seller_tx(
        &self,
        escrow_utxo: Txid,
        amount: Amount,
    ) -> Transaction {
        // Escrow UTXO → Seller's refund address (minus fees)
        todo!("Build refund TX: Escrow → Seller")
    }

    /// Build the DISPUTE RELEASE transaction (dispute: seller lied)
    /// Arbiter sides with buyer → sats go to BUYER
    /// Requires: Arbiter + Buyer signatures
    pub fn build_dispute_release_to_buyer_tx(
        &self,
        escrow_utxo: Txid,
        amount: Amount,
    ) -> Transaction {
        // Escrow UTXO → Buyer's payout address (minus fees)
        todo!("Build dispute release TX: Escrow → Buyer")
    }
}
