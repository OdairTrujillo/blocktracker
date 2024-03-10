import express, { Request, Response, NextFunction } from 'express';
import { Express, RequestHandler } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { logger, ApiError } from 'libchainstream';

import { api } from './api/v1/index.js';
import { config } from './config.js';

// Setup morgan middleware
const requestFormat: string = ':remote-addr [:date[iso]] ":method :url" :status.';
const morganStream: RequestHandler = morgan(requestFormat, {
  stream: {
    write: (message: string) => {
      // Write info removing all line breaks
      return logger.info(message.trim(), { module: 'BlockTracker' });
    }
  }
});

// Init express app
export const app: Express = express();

// Setup CORS
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'PUT', 'POST', 'DELETE'],
    allowedHeaders: ['Accept', 'Content-Type', 'Authorization']
  })
);

// Setup middleware
app.use(morganStream);
// Parse application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
// Parse application/json
app.use(express.json());
// Setup router and routes
app.use('/api/v1', api);

app.get('/', (req: Request, res: Response, next: NextFunction) => {
  res.json({
    message: 'Welcome to BlockTracker API.'
  });
});

// Handler for no route found
app.use((req: Request, res: Response, next: NextFunction) => {
  next({
    message: 'Route not found',
    statusCode: 404,
    level: 'warn'
  });
});

// Handler for other errors.
app.use((err: ApiError, req: Request, res: Response, next: NextFunction) => {
  // Extracting message and setting default values.
  const { stack = 'No trace :(', message, level = 'error', statusCode = 500 } = err;
  if (level === 'error') {
    logger.error(`${config.trace ? stack : message}. Code: ${statusCode}`, {
      module: 'BlockTracker'
    });
  } else {
    logger.info(`${config.trace ? stack : message}. Code: ${statusCode}`, {
      module: 'BlockTracker'
    });
  }

  res.status(statusCode);
  res.json({
    error: true,
    statusCode,
    message
  });
});
