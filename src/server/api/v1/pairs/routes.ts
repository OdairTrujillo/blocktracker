import express, { Router, Request, Response, NextFunction } from 'express';

import { read } from './controller.js';

export const pairs: Router = express.Router();

// Have to assert types for the sign function to not breake express RequestHandler
pairs.route('/traded').post((req: Request, res: Response, next: NextFunction) => {
  read(req, res, next);
});
