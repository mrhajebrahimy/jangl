import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { log } from './log.js';

const cfg = loadConfig();
const app = createApp(cfg);
app.server.listen(cfg.port, cfg.host, () => log('info', 'listening', { host: cfg.host, port: cfg.port }));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => app.close().then(() => process.exit(0)));
process.on('unhandledRejection', e => { log('error', 'unhandledRejection', { name: e?.name }); });
