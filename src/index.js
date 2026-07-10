import http from 'http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createApp } from './app.js';
import { setupSocket } from './socket.js';
import { prisma } from './db.js';

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  },
});

app.set('io', io);
setupSocket(io);

server.listen(config.port, () => {
  console.log(`AutoRescue API listening on :${config.port}`);
});

async function shutdown() {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
