#!/bin/bash

# --- Ship Script (v2) ---
# Automates E2E testing, add, commit, push, PR creation, merge, and cleanup.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- 1. Validation ---

# Check if commit message and issue number were provided
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "❌ Error: Commit message and Issue number are required."
  echo "Usage: ./ship.sh \"feat(scope): Your commit message\" <issue_number>"
  exit 1
fi

COMMIT_MESSAGE="$1"
ISSUE_NUMBER="$2"

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

# --- 2. THE E2E TEST GATE ---

echo "   Running E2E test suite as a final CI gate..."
if ! npm run test:e2e; then
    echo "❌ E2E Tests Failed. Aborting ship."
    echo "   Please fix the tests before running ./ship.sh again."
    exit 1
fi
echo "✅ E2E Tests Passed."

# --- 3. Git Operations ---

# Stage all changes
echo "   Adding all changes..."
git add .

# Commit with the provided message
echo "   Committing with message: '$COMMIT_MESSAGE'..."
git commit -m "$COMMIT_MESSAGE"

# Push the current branch to the remote origin
echo "   Pushing branch '$CURRENT_BRANCH' to origin..."
git push origin HEAD # Use HEAD to push the current branch safely

# --- 4. GitHub PR Creation ---

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

echo "✅ Pull Request created successfully!"
echo "   PR URL: $PR_URL"

# --- 5. Merge PR and Cleanup ---

# Extract PR number from URL (assuming standard GitHub URL format)
PR_NUMBER=$(echo "$PR_URL" | awk -F'/' '{print $NF}')
if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
   echo "❌ Error: Could not parse PR number from URL: '$PR_URL'"
   exit 1
fi
echo "   Extracted PR Number: $PR_NUMBER"

# Merge the PR using squash and delete the remote branch
echo "   Merging PR #$PR_NUMBER..."
gh pr merge "$PR_NUMBER" --squash --delete-branch
echo "✅ PR #$PR_NUMBER merged and remote branch deleted."

# Close the associated issue
echo "   Closing Issue #$ISSUE_NUMBER..."
gh issue close "$ISSUE_NUMBER"
echo "✅ Issue #$ISSUE_NUMBER closed."

# Switch back to main and pull latest changes (including the merge)
echo "   Switching back to 'main' and pulling latest changes..."
git switch main
git pull origin main

# Delete the local feature branch
echo "   Deleting local branch '$CURRENT_BRANCH'..."
git branch -d "$CURRENT_BRANCH"
echo "✅ Local branch '$CURRENT_BRANCH' deleted."

# --- 6. Output ---

echo "🚢 Ship process complete."

exit 0