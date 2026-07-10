import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  nearbyRadiusKm: Number(process.env.NEARBY_RADIUS_KM || 25),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@autorecue.app',
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin123!',
  adminName: process.env.ADMIN_NAME || 'AutoRescue Admin',
};
