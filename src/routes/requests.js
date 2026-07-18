import { Router } from 'express';
import { prisma } from '../db.js';
import { authRequired, loadUser, requireRoles } from '../middleware/auth.js';
import { config } from '../config.js';
import { distanceKm, estimateEtaMinutes, serializeRequest } from '../utils/helpers.js';

const router = Router();

router.use(authRequired, loadUser);

router.post('/', async (req, res, next) => {
  try {
    if (req.currentUser.role !== 'USER') {
      return res.status(403).json({ error: 'Only users can create service requests' });
    }
    const { lat, lng, issueType, notes } = req.body;
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const request = await prisma.serviceRequest.create({
      data: {
        driverId: req.currentUser.id,
        driverName: req.currentUser.name,
        userLat: Number(lat),
        userLng: Number(lng),
        issueType: issueType || 'Roadside Assistance',
        notes: notes || null,
        status: 'PENDING',
      },
    });

    const payload = serializeRequest(request);
    req.app.get('io')?.emit('request:new', payload);

    res.status(201).json({ request: payload });
  } catch (err) {
    next(err);
  }
});

router.get('/active', async (req, res, next) => {
  try {
    const where =
      req.currentUser.role === 'MECHANIC'
        ? {
            mechanicId: req.currentUser.id,
            status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] },
          }
        : {
            driverId: req.currentUser.id,
            status: { in: ['PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] },
          };

    const request = await prisma.serviceRequest.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ request: serializeRequest(request) });
  } catch (err) {
    next(err);
  }
});

router.get('/nearby', requireRoles('MECHANIC'), async (req, res, next) => {
  try {
    const lat = Number(req.query.lat ?? req.currentUser.lastLat);
    const lng = Number(req.query.lng ?? req.currentUser.lastLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Mechanic location required (lat/lng)' });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pending = await prisma.serviceRequest.findMany({
      where: { status: 'PENDING', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const nearby = pending
      .map((r) => {
        const km = distanceKm(lat, lng, r.userLat, r.userLng);
        return {
          ...serializeRequest(r),
          distanceKm: Number(km.toFixed(2)),
          etaMinutes: estimateEtaMinutes(km),
        };
      })
      .filter((r) => r.distanceKm <= config.nearbyRadiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({ requests: nearby });
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const where =
      req.currentUser.role === 'MECHANIC'
        ? { mechanicId: req.currentUser.id }
        : { driverId: req.currentUser.id };

    const requests = await prisma.serviceRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ requests: requests.map(serializeRequest) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const request = await prisma.serviceRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const isParty =
      request.driverId === req.currentUser.id ||
      request.mechanicId === req.currentUser.id ||
      req.currentUser.role === 'ADMIN';
    if (!isParty) return res.status(403).json({ error: 'Forbidden' });

    res.json({ request: serializeRequest(request) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/accept', requireRoles('MECHANIC'), async (req, res, next) => {
  try {
    const existing = await prisma.serviceRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.status !== 'PENDING') {
      return res.status(400).json({ error: 'Request is not available' });
    }

    const active = await prisma.serviceRequest.findFirst({
      where: {
        mechanicId: req.currentUser.id,
        status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] },
      },
    });
    if (active) return res.status(400).json({ error: 'Finish your current job first' });

    const lat = Number(req.body.lat ?? req.currentUser.lastLat);
    const lng = Number(req.body.lng ?? req.currentUser.lastLng);
    let distanceKm = null;
    let etaMinutes = null;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      distanceKm = distanceKmCalc(lat, lng, existing.userLat, existing.userLng);
      etaMinutes = estimateEtaMinutes(distanceKm);
    }

    const request = await prisma.serviceRequest.update({
      where: { id: existing.id },
      data: {
        status: 'ACCEPTED',
        mechanicId: req.currentUser.id,
        mechanicName: req.currentUser.name,
        mechanicLat: Number.isFinite(lat) ? lat : null,
        mechanicLng: Number.isFinite(lng) ? lng : null,
        distanceKm,
        etaMinutes,
        acceptedAt: new Date(),
      },
    });

    const payload = serializeRequest(request);
    const io = req.app.get('io');
    io?.to(`user:${request.driverId}`).emit('request:updated', payload);
    io?.to(`request:${request.id}`).emit('request:updated', payload);
    io?.emit('request:taken', { id: request.id });

    res.json({ request: payload });
  } catch (err) {
    next(err);
  }
});

function distanceKmCalc(a, b, c, d) {
  return Number(distanceKm(a, b, c, d).toFixed(2));
}

router.post('/:id/reject', requireRoles('MECHANIC'), async (req, res) => {
  // Client-side dismiss; no DB change for pending pool
  res.json({ ok: true });
});

router.patch('/:id/status', requireRoles('MECHANIC'), async (req, res, next) => {
  try {
    const request = await prisma.serviceRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.mechanicId !== req.currentUser.id) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const nextMap = {
      ACCEPTED: 'ON_THE_WAY',
      ON_THE_WAY: 'ARRIVED',
      ARRIVED: 'COMPLETED',
    };
    const labelToCode = {
      'ON THE WAY': 'ON_THE_WAY',
      'ON_THE_WAY': 'ON_THE_WAY',
      ARRIVED: 'ARRIVED',
      COMPLETED: 'COMPLETED',
      'On the Way': 'ON_THE_WAY',
      Arrived: 'ARRIVED',
      Completed: 'COMPLETED',
    };
    const rawNext = req.body.status;
    const nextStatus =
      (rawNext ? labelToCode[rawNext] || String(rawNext).toUpperCase().replace(/\s+/g, '_') : null)
      || nextMap[request.status];
    if (!nextStatus || !['ON_THE_WAY', 'ARRIVED', 'COMPLETED'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid status transition' });
    }

    const data = { status: nextStatus };
    if (nextStatus === 'COMPLETED') {
      data.completedAt = new Date();
      await prisma.user.update({
        where: { id: req.currentUser.id },
        data: { completedJobs: { increment: 1 } },
      });
    }

    const updated = await prisma.serviceRequest.update({
      where: { id: request.id },
      data,
    });

    const payload = serializeRequest(updated);
    const io = req.app.get('io');
    io?.to(`user:${updated.driverId}`).emit('request:updated', payload);
    io?.to(`request:${updated.id}`).emit('request:updated', payload);

    res.json({ request: payload });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const request = await prisma.serviceRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.driverId !== req.currentUser.id && req.currentUser.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (['COMPLETED', 'CANCELLED'].includes(request.status)) {
      return res.status(400).json({ error: 'Request already closed' });
    }

    const updated = await prisma.serviceRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED' },
    });

    const payload = serializeRequest(updated);
    const io = req.app.get('io');
    if (updated.mechanicId) {
      io?.to(`user:${updated.mechanicId}`).emit('request:updated', payload);
    }
    io?.to(`request:${updated.id}`).emit('request:updated', payload);

    res.json({ request: payload });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/location', requireRoles('MECHANIC'), async (req, res, next) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng required' });
    }

    const request = await prisma.serviceRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.mechanicId !== req.currentUser.id) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (!['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'].includes(request.status)) {
      return res.status(400).json({ error: 'Request not trackable' });
    }

    const km = distanceKmCalc(Number(lat), Number(lng), request.userLat, request.userLng);
    const eta = estimateEtaMinutes(km);

    const updated = await prisma.serviceRequest.update({
      where: { id: request.id },
      data: {
        mechanicLat: Number(lat),
        mechanicLng: Number(lng),
        distanceKm: km,
        etaMinutes: eta,
      },
    });

    await prisma.user.update({
      where: { id: req.currentUser.id },
      data: { lastLat: Number(lat), lastLng: Number(lng) },
    });

    const payload = serializeRequest(updated);
    const io = req.app.get('io');
    io?.to(`user:${updated.driverId}`).emit('location:update', payload);
    io?.to(`request:${updated.id}`).emit('location:update', payload);

    res.json({ request: payload });
  } catch (err) {
    next(err);
  }
});

export default router;
