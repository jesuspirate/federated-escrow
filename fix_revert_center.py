#!/usr/bin/env python3
"""Revert justifyContent:center on BillPayView hub root"""
BILLPAY = "/home/satoshi/federated-escrow/escrow-ui/src/pages/marketplace/BillPayView.jsx"
with open(BILLPAY, "r") as f: src = f.read()
old = '      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflowY: "auto", maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box", justifyContent: "center" }}>'
new = '      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflowY: "auto", maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>'
if old in src:
    src = src.replace(old, new, 1)
    with open(BILLPAY, "w") as f: f.write(src)
    print("✅ Reverted justifyContent:center")
else:
    print("⚠️  Pattern not found")
