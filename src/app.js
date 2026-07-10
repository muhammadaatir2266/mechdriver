import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import requestRoutes from './routes/requests.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';
import vehicleRoutes from './routes/vehicles.js';
import billingRoutes from './routes/billing.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'autorecue-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/requests', requestRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api/billing', billingRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}
