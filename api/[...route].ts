import express from 'express';
import { createApiRouter } from '../server/apiRouter.ts';

const app = express();
app.use('/api', createApiRouter());

export default app;
