import express, { Router, Request, Response, NextFunction } from 'express';

import { traded, hot } from './controller.js';

export const pairs: Router = express.Router();

// Have to assert types for the sign function to not breake express RequestHandler
pairs.route('/traded').post((req: Request, res: Response, next: NextFunction) => {
  traded(req, res, next);
});

pairs.route('/hot').post((req: Request, res: Response, next: NextFunction) => {
  hot(req, res, next);
});
