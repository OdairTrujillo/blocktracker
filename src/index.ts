import http, { Server } from 'http';
import { logger } from 'libchainstream';

import { app } from './server/index.js';
import { config } from './server/config.js';
import { trackTrades } from './tracekr.js';

import './mods.js'; // Polyfill

const { hostname, port, url } = config.server;
const apiServer: Server = http.createServer(app);

apiServer.listen(port, Number(hostname), () => {
  logger.info(`BlockTracker server is running at ${url}/.`, { module: 'BlockTracker' });
});

newBlock();
