# Warden GitHub App — cross-repo coverage sync webhook server.
#
# This is a workspace package, so the build context is the REPO ROOT:
#   docker build -f packages/github-app/Dockerfile -t warden-github-app .
FROM node:20-slim

WORKDIR /app
RUN corepack enable

# Install workspace deps, then build github-app and everything it depends on.
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @warden/github-app... build

ENV PORT=3000
EXPOSE 3000

# createWebhookServer never auto-listens; this thin entry binds the port.
CMD ["node", "packages/github-app/server-entry.mjs"]
