import express, { Router } from 'express';

import { pairs } from './pairs/routes.js';

export const api: Router = express.Router();

api.use('/pairs', pairs);
