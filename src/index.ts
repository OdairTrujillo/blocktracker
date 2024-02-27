import http, { Server } from 'http';
import { logger } from 'libchainstream';

import { app } from './server/index';
import { config } from './config';
import { newBlock } from './events';

import './mods.js'; // Language extensions or prototypes mods

const { hostname, port, url } = config.server;
const apiServer: Server = http.createServer(app);

apiServer.listen(port, Number(hostname), () => {
  logger.info(`Chainstream server is running at ${url}/.`, { module: 'Chainstream' });
});

newBlock();
