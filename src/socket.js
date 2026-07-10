import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { prisma } from './db.js';
import { serializeRequest } from './utils/helpers.js';

export function setupSocket(io) {
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers.authorization || '').replace('Bearer ', '');
      if (!token) return next(new Error('Unauthorized'));
      const payload = jwt.verify(token, config.jwtSecret);
      socket.user = payload;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.sub;
    socket.join(`user:${userId}`);

    socket.on('request:subscribe', (requestId) => {
      if (requestId) socket.join(`request:${requestId}`);
    });

    socket.on('request:unsubscribe', (requestId) => {
      if (requestId) socket.leave(`request:${requestId}`);
    });

    socket.on('mechanic:location', async (data) => {
      try {
        if (socket.user.role !== 'MECHANIC') return;
        const { requestId, lat, lng } = data || {};
        if (!requestId || lat == null || lng == null) return;

        const request = await prisma.serviceRequest.findUnique({ where: { id: requestId } });
        if (!request || request.mechanicId !== userId) return;
        if (!['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'].includes(request.status)) return;

        const R = 6371;
        const dLat = ((request.userLat - lat) * Math.PI) / 180;
        const dLon = ((request.userLng - lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat * Math.PI) / 180) *
            Math.cos((request.userLat * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
        const km = Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
        const etaMinutes = Math.max(1, Math.ceil((km / 35) * 60));

        const updated = await prisma.serviceRequest.update({
          where: { id: requestId },
          data: {
            mechanicLat: Number(lat),
            mechanicLng: Number(lng),
            distanceKm: km,
            etaMinutes,
          },
        });

        await prisma.user.update({
          where: { id: userId },
          data: { lastLat: Number(lat), lastLng: Number(lng) },
        });

        const payload = serializeRequest(updated);
        io.to(`user:${updated.driverId}`).emit('location:update', payload);
        io.to(`request:${updated.id}`).emit('location:update', payload);
      } catch (err) {
        console.error('mechanic:location error', err.message);
      }
    });

    socket.on('disconnect', () => {});
  });
}
