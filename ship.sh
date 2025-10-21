#!/bin/bash

# --- Ship Script ---
# Automates the process of adding, committing, pushing, and creating a PR.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- 1. Validation ---

# Check if a commit message was provided
if [ -z "$1" ]; then
  echo "❌ Error: Commit message is required."
  echo "Usage: ./ship.sh \"feat(scope): Your commit message\""
  exit 1
fi

# Get the current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Prevent running on the main branch
if [ "$CURRENT_BRANCH" == "main" ]; then
  echo "❌ Error: Cannot run ship.sh on the 'main' branch."
  exit 1
fi

echo "🚀 Starting ship process for branch '$CURRENT_BRANCH'..."

# --- 2. Git Operations ---

# Stage all changes
echo "   Adding all changes..."
git add .

# Commit with the provided message
echo "   Committing with message: '$1'..."
git commit -m "$1"

# Push the current branch to the remote origin
echo "   Pushing branch '$CURRENT_BRANCH' to origin..."
git push origin HEAD # Use HEAD to push the current branch safely

# --- 3. GitHub PR Creation ---

echo "   Creating Pull Request..."
# Extract the type (e.g., feat, fix, chore) from the commit message for the title
COMMIT_TYPE=$(echo "$1" | cut -d'(' -f1)
COMMIT_SCOPE_MSG=$(echo "$1" | sed -E 's/^[a-z]+\(([^)]+)\):\s*(.*)/\u\1: \2/') # Capitalize scope and message
PR_TITLE="$COMMIT_SCOPE_MSG"

# Create the PR using GitHub CLI, grabbing the URL
PR_URL=$(gh pr create \
  --title "$PR_TITLE" \
  --body "Automated PR created by ship.sh for branch '$CURRENT_BRANCH'." \
  --base "main" \
  --head "$CURRENT_BRANCH")

# --- 4. Output ---

echo "✅ Pull Request created successfully!"
echo "   PR URL: $PR_URL"

echo "🚢 Ship process complete."

exit 0