import http, { Server } from 'http';
import { logger } from 'libchainstream';

import { app } from './server/index.js';
import { config } from './config.js';
import { newBlock } from './events.js';

import './mods.js'; // Language extensions or prototypes mods

const { hostname, port, url } = config.server;
const apiServer: Server = http.createServer(app);

apiServer.listen(port, Number(hostname), () => {
  logger.info(`BlockTracker server is running at ${url}/.`, { module: 'BlockTracker' });
});

newBlock();
