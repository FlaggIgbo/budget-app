#!/bin/sh
set -e

# Pre-push screenshot verification and regeneration script
# Regenerates Playwright screenshots for components & pages when frontend code changes

if [ "$SKIP_SCREENSHOTS" = "1" ] || [ "$SKIP_SCREENSHOTS" = "true" ]; then
  echo "⏭️ SKIP_SCREENSHOTS is set; skipping screenshot check."
  exit 0
fi

REMOTE_NAME="$1"
REMOTE_URL="$2"
ZERO_SHA="0000000000000000000000000000000000000000"

has_frontend_changes=0

# Read git push ref specifications from stdin if available
if [ ! -t 0 ]; then
  while read -r local_ref local_sha remote_ref remote_sha; do
    # Skip branch deletion
    if [ "$local_sha" = "$ZERO_SHA" ] || [ "$local_sha" = "(delete)" ]; then
      continue
    fi

    if [ "$remote_sha" = "$ZERO_SHA" ] || [ -z "$remote_sha" ]; then
      base_sha=$(git merge-base "$local_sha" "$REMOTE_NAME/main" 2>/dev/null || \
                 git merge-base "$local_sha" "$REMOTE_NAME/master" 2>/dev/null || \
                 git rev-parse "$local_sha~1" 2>/dev/null || echo "")

      if [ -n "$base_sha" ]; then
        range="$base_sha..$local_sha"
      else
        range="$local_sha"
      fi
    else
      range="$remote_sha..$local_sha"
    fi

    # Check for frontend changes in push range
    changed=$(git diff --name-only "$range" 2>/dev/null | grep -E '^(client/src/|scripts/generate-screenshots)' | grep -v '^screenshots/' || true)
    if [ -n "$changed" ]; then
      has_frontend_changes=1
      echo "🎨 Frontend changes detected in push range ($range):"
      echo "$changed" | sed 's/^/   • /'
      break
    fi
  done
fi

# Also check working tree and recent commits if stdin was empty or not in push loop
if [ $has_frontend_changes -eq 0 ]; then
  uncommitted=$(git status --porcelain client/src/ 2>/dev/null | grep -v 'screenshots/' || true)
  if [ -n "$uncommitted" ]; then
    has_frontend_changes=1
    echo "🎨 Uncommitted frontend changes detected:"
    echo "$uncommitted" | sed 's/^/   • /'
  fi
fi

if [ $has_frontend_changes -eq 0 ]; then
  head_diff=$(git diff --name-only HEAD~1..HEAD 2>/dev/null | grep -E '^(client/src/)' | grep -v '^screenshots/' || true)
  if [ -n "$head_diff" ]; then
    has_frontend_changes=1
    echo "🎨 Frontend changes detected in latest commit (HEAD):"
    echo "$head_diff" | sed 's/^/   • /'
  fi
fi

# If no frontend changes were found, proceed with push
if [ $has_frontend_changes -eq 0 ]; then
  echo "✅ No frontend code changes detected. Skipping screenshot regeneration."
  exit 0
fi

echo "📸 Frontend code changed. Regenerating component and page screenshots with Playwright..."
node scripts/generate-screenshots.js

# Check if screenshots were added or modified
screenshot_diff=$(git status --porcelain screenshots/ 2>/dev/null || true)

if [ -n "$screenshot_diff" ]; then
  echo ""
  echo "📸 Updated screenshots detected:"
  echo "$screenshot_diff" | sed 's/^/   • /'

  # Stage and commit the updated screenshots automatically
  git add screenshots/
  git commit --no-verify -m "chore(screenshots): regenerate component & page screenshots"

  echo ""
  echo "=========================================================================="
  echo "✅ Screenshots regenerated and committed automatically:"
  echo "   $(git log -1 --oneline)"
  echo ""
  echo "⚠️  Push was paused so the new screenshot commit is included."
  echo "👉 Please run 'git push' again now to push your commits and new screenshots!"
  echo "=========================================================================="
  exit 1
else
  echo "✅ Screenshots are already up to date with frontend changes."
  exit 0
fi
