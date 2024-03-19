import { ServerConfig } from 'libchainstream';

export interface ApiConfig {
  server: ServerConfig;
  trace: boolean;
}

export const config: ApiConfig = {
  server: {
    hostname: process.env.SERVER_HOSTNAME,
    port: process.env.SERVER_PORT,
    url: `http://${process.env.SERVER_HOSTNAME}:${process.env.SERVER_PORT}`
  },
  trace: process.env.TRACE_STACK === 'true'
};
