#!/bin/bash

# --- Ship Script (v3) ---
# Automates tests, add, commit, push, and PR creation.
# NOTE:
# - No auto-merge to main.
# - No auto issue-closing.
# - E2E tests only run when explicitly requested.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- 1. Validation & Args ---

# Check if commit message and issue number were provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "❌ Error: Commit message and Issue number are required."
  echo "Usage: ./ship.sh \"feat(scope): Your commit message\" <issue_number> [--no-tests|--full-ci]"
  exit 1
fi

COMMIT_MESSAGE="$1"
ISSUE_NUMBER="$2"
RUN_MODE="unit" # default: run unit/integration tests only

# Optional third arg: test mode
if [ "$3" == "--no-tests" ]; then
  RUN_MODE="none"
elif [ "$3" == "--full-ci" ]; then
  RUN_MODE="full"
fi

# Validate if the second argument is a number
if ! [[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]]; then
   echo "❌ Error: Invalid issue number provided: '$ISSUE_NUMBER'. Must be an integer."
   exit 1
fi

# Get the current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Prevent running on the main branch
if [ "$CURRENT_BRANCH" == "main" ]; then
  echo "❌ Error: Cannot run ship.sh on the 'main' branch."
  exit 1
fi

echo "🚀 Starting ship process for branch '$CURRENT_BRANCH' (Issue #$ISSUE_NUMBER)..."

# --- 2. Pre-flight: Working Tree Sanity Check ---

# Require a clean working tree (no UNSTAGED changes).
# Staged changes are allowed and will be committed as-is.
if ! git diff --quiet; then
  echo "❌ Error: You have unstaged changes."
  echo "   Please commit or stash them, or stage them explicitly with 'git add', before running ship.sh."
  echo "   This script will only commit what is already staged."
  exit 1
fi

# --- 3. Test Gate (configurable) ---

case "$RUN_MODE" in
  "none")
    echo "⚠️ Skipping tests (RUN_MODE=none)."
    ;;
  "unit")
    echo "🧪 Running unit/integration test suite (npm test)..."
    npm test
    echo "✅ Unit/Integration Tests Passed."
    ;;
  "full")
    echo "🧪 Running full CI gate (unit/integration + e2e)..."
    npm test
    echo "✅ Unit/Integration Tests Passed."
    echo "🧪 Running E2E test suite (npm run test:e2e)..."
    if ! npm run test:e2e; then
      echo "❌ E2E Tests Failed. Aborting ship."
      echo "   Please fix the tests before running ./ship.sh again (or use --no-tests / default mode intentionally)."
      exit 1
    fi
    echo "✅ E2E Tests Passed."
    ;;
  *)
    echo "❌ Error: Unknown RUN_MODE '$RUN_MODE'."
    exit 1
    ;;
esac

# --- 4. Git Operations (staged-only) ---

# At this point:
# - Only staged changes will be committed.
# - Nothing is auto-added for you.

echo "   Committing staged changes with message: '$COMMIT_MESSAGE'..."
git commit -m "$COMMIT_MESSAGE"

# Push the current branch to the remote origin
echo "   Pushing branch '$CURRENT_BRANCH' to origin..."
git push origin HEAD # Use HEAD to push the current branch safely

# --- 5. GitHub PR Creation ---

echo "   Creating Pull Request..."

# Extract the type (e.g., feat, fix, chore) from the commit message for the title
COMMIT_TYPE=$(echo "$COMMIT_MESSAGE" | cut -d'(' -f1)
COMMIT_SCOPE_MSG=$(echo "$COMMIT_MESSAGE" | sed -E 's/^[a-z]+\(([^)]+)\):\s*(.*)/\u\1: \2/') # Capitalize scope and message
PR_TITLE="$COMMIT_SCOPE_MSG (#$ISSUE_NUMBER)" # Add issue number to title

# Create the PR using GitHub CLI, grabbing the URL
PR_URL=$(gh pr create \
  --title "$PR_TITLE" \
  --body "Automated PR created by ship.sh for branch '$CURRENT_BRANCH'. Closes #$ISSUE_NUMBER" \
  --base "main" \
  --head "$CURRENT_BRANCH")

if [ -z "$PR_URL" ]; then
  echo "❌ Error: Failed to create PR (no URL returned)."
  exit 1
fi

echo "✅ Pull Request created successfully!"
echo "   PR URL: $PR_URL"

# --- 6. End of automated flow (no auto-merge, no issue close) ---

echo ""
echo "📌 Next steps:"
echo "  1) Review the PR on GitHub:"
echo "     $PR_URL"
echo "  2) Merge it via the GitHub UI when you're satisfied."
echo "  3) The issue #$ISSUE_NUMBER will be auto-closed by 'Closes #$ISSUE_NUMBER' once the PR is merged."
echo ""
echo "🚢 Ship process complete (up to PR creation)."

exit 0