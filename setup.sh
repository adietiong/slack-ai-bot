#!/usr/bin/env sh
# One-shot setup for the Slack + Claude Code bot.
# Installs dependencies, seeds .env, builds, and runs the test suite.
# Safe to re-run: it never overwrites an existing .env.
set -e

echo "==> Checking prerequisites"
if ! command -v node >/dev/null 2>&1; then
  echo "  ! Node.js is not installed. Install Node 18+ from https://nodejs.org and re-run." >&2
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  ! Node 18+ required (found $(node -v))." >&2
  exit 1
fi
echo "  Node $(node -v), npm $(npm -v)"

echo "==> Installing dependencies"
npm install

echo "==> Seeding .env"
if [ -f .env ]; then
  echo "  .env already exists — leaving it untouched."
else
  cp .env.example .env
  echo "  Created .env from .env.example — open it and fill in your tokens and repo paths."
fi

echo "==> Building"
npm run build

echo "==> Running tests"
npm test

cat <<'DONE'

==> Setup complete.

Next steps:
  1. Edit .env — set SLACK_BOT_TOKEN, SLACK_APP_TOKEN, one Claude auth
     token (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN), BACKEND_PATH,
     FRONTEND_PATH, and the TRELLO_* values.
  2. Create a Slack app (Socket Mode on). Bot scopes:
     app_mentions:read, chat:write, channels:history, groups:history,
     files:read. Subscribe to events: app_mention, message.channels.
     Install it to your workspace.
  3. Start the bot:  npm run dev

See README.md for usage, optional features, and the safety model.
DONE
