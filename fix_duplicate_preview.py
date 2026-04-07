#!/usr/bin/env python3
"""v2.46.49 — Remove duplicate prevView declaration (build fix)"""

MKT = "/home/satoshi/federated-escrow/escrow-ui/src/pages/Marketplace.jsx"

with open(MKT, "r") as f:
    src = f.read()

# Remove the second (duplicate) declaration - the one with "browse" default
old = '  const [prevView, setPrevView] = useState("browse");\n'
if src.count(old) == 1:
    src = src.replace(old, '', 1)
    with open(MKT, "w") as f:
        f.write(src)
    print("✅ Removed duplicate prevView declaration (browse)")
else:
    count = src.count(old)
    print(f"⚠️  Found {count} occurrences of browse prevView — manual check needed")
    import sys; sys.exit(1)

print("\nNext steps:")
print("  cd ~/federated-escrow/escrow-ui && npx vite build")
print("  cd ~/federated-escrow && rm fix_duplicate_prevview.py")
print('  git add -A && git commit -m "v2.46.49 — fix: remove duplicate prevView declaration (build)"')
print("  git push origin main && git tag v2.46.49 && git push origin v2.46.49")
print("  sudo systemctl restart fedi-escrow")
