#!/usr/bin/env bash
# One-time push of Color Iris to GitHub. Run from the project folder:
#   bash push-to-github.sh
set -e

REMOTE_URL="https://github.com/FirmaBrands/color-iris.git"

# Clear any stale git lock files (left over from the setup environment)
rm -f .git/HEAD.lock .git/index.lock .git/objects/maintenance.lock 2>/dev/null || true

# Commit the helper files if they aren't committed yet
git add -A
git diff --cached --quiet || git commit -m "Add deploy helper script and instructions"

# Add the remote if it isn't already set
if git remote | grep -q '^origin$'; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git branch -M main
git push -u origin main

echo ""
echo "✅ Pushed to $REMOTE_URL"
echo "Next: enable Pages at https://github.com/FirmaBrands/color-iris/settings/pages"
echo "      Set 'Source' to 'GitHub Actions'. The deploy workflow will run automatically."
