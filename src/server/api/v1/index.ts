import express, { Router } from 'express';

import { pairs } from './pairs/routes';

export const api: Router = express.Router();

api.use('/pairs', pairs);
