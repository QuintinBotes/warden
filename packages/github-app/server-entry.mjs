// Production entrypoint for the Warden GitHub App webhook server.
//
// Reads its GitHub App credentials from the environment and starts listening.
// `createWebhookServer` never auto-listens on import, so this thin wrapper is the
// only place a port is bound. Multi-line PEM keys may be provided with escaped
// newlines (`\n`), which are restored here.
import { createWebhookServer } from './dist/index.js';

const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const port = Number(process.env.PORT ?? 3000);

const server = createWebhookServer({
  appId: process.env.GITHUB_APP_ID ?? '',
  privateKey,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
  webhookPath: process.env.GITHUB_WEBHOOK_PATH ?? '/api/github/webhooks',
});

server.listen(port, () => {
  console.log(`warden github-app listening on :${port}`);
});
