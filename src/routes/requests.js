import { Router } from 'express';
import { prisma } from '../db.js';
import { authRequired, loadUser, requireRoles } from '../middleware/auth.js';
import { config } from '../config.js';
import {
  CATEGORY_MINIMUM_PRICES,
  distanceKm,
  estimateEtaMinutes,
  minimumPriceFor,
  serializeOffer,
  serializeRequest,
} from '../utils/helpers.js';

const router = Router();

router.use(authRequired, loadUser);

router.get('/pricing', (_req, res) => {
  res.json({
    currency: 'PKR',
    categories: Object.entries(CATEGORY_MINIMUM_PRICES).map(([issueType, minimumPrice]) => ({
      issueType,
      minimumPrice,
    })),
  });
});

router.post('/', async (req, res, next) => {
  try {
    if (req.currentUser.role !== 'USER') {
      return res.status(403).json({ error: 'Only users can create service requests' });
    }
    const { lat, lng, issueType, notes } = req.body;
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }
    const category = issueType || 'Other roadside help';
    const minimumPrice = minimumPriceFor(category);
    const userOfferedPrice = Number(req.body.userOfferedPrice);
    if (!Number.isInteger(userOfferedPrice) || userOfferedPrice < minimumPrice) {
      return res.status(400).json({
        error: `Minimum offer for ${category} is Rs. ${minimumPrice.toLocaleString('en-PK')}`,
        minimumPrice,
      });
    }
    if (userOfferedPrice > 1000000) {
      return res.status(400).json({ error: 'Offered price is too high' });
    }
    const existingActive = await prisma.serviceRequest.findFirst({
      where: {
        driverId: req.currentUser.id,
        status: { in: ['PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] },
      },
    });
    if (existingActive) {
      return res.status(409).json({ error: 'You already have an active service request' });
    }

    const request = await prisma.serviceRequest.create({
      data: {
        driverId: req.currentUser.id,
        driverName: req.currentUser.name,
        userLat: Number(lat),
        userLng: Number(lng),
        issueType: category,
        notes: notes || null,
        userOfferedPrice,
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
      include: req.currentUser.role === 'USER'
        ? {
            offers: {
              where: { status: 'PENDING' },
              orderBy: { amount: 'asc' },
              take: 3,
              include: {
                mechanic: { select: { rating: true, completedJobs: true } },
              },
            },
          }
        : undefined,
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
      where: {
        status: 'PENDING',
        userOfferedPrice: { not: null },
        createdAt: { gte: since },
      },
      include: {
        offers: {
          where: { mechanicId: req.currentUser.id },
          take: 1,
        },
      },
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

router.post('/:id/offers', requireRoles('MECHANIC'), async (req, res, next) => {
  try {
    if (req.currentUser.status !== 'ACTIVE' || req.currentUser.availability !== 'ONLINE') {
      return res.status(403).json({ error: 'Go online before sending offers' });
    }
    const request = await prisma.serviceRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Request is no longer accepting offers' });
    }
    if (request.userOfferedPrice == null) {
      return res.status(400).json({ error: 'This legacy request has no offered price' });
    }

    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount < request.userOfferedPrice) {
      return res.status(400).json({
        error: `Offer must be at least Rs. ${request.userOfferedPrice.toLocaleString('en-PK')}`,
      });
    }
    if (amount > 1000000) {
      return res.status(400).json({ error: 'Offer amount is too high' });
    }

    const active = await prisma.serviceRequest.findFirst({
      where: {
        mechanicId: req.currentUser.id,
        status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] },
      },
    });
    if (active) return res.status(400).json({ error: 'Finish your current job first' });

    const offer = await prisma.serviceOffer.upsert({
      where: {
        requestId_mechanicId: {
          requestId: request.id,
          mechanicId: req.currentUser.id,
        },
      },
      create: {
        requestId: request.id,
        mechanicId: req.currentUser.id,
        mechanicName: req.currentUser.name,
        amount,
      },
      update: {
        amount,
        mechanicName: req.currentUser.name,
        status: 'PENDING',
      },
      include: {
        mechanic: { select: { rating: true, completedJobs: true } },
      },
    });

    const payload = serializeOffer(offer);
    req.app.get('io')?.to(`user:${request.driverId}`).emit('offer:updated', payload);
    res.status(201).json({ offer: payload });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/offers/:offerId/reject', requireRoles('USER'), async (req, res, next) => {
  try {
    const offer = await prisma.serviceOffer.findUnique({
      where: { id: req.params.offerId },
      include: { request: true },
    });
    if (!offer || offer.requestId !== req.params.id || offer.request.driverId !== req.currentUser.id) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    if (offer.request.status !== 'PENDING' || offer.status !== 'PENDING') {
      return res.status(400).json({ error: 'Offer is no longer available' });
    }
    const updated = await prisma.serviceOffer.update({
      where: { id: offer.id },
      data: { status: 'REJECTED' },
    });
    req.app.get('io')?.to(`user:${offer.mechanicId}`).emit('offer:rejected', serializeOffer(updated));
    res.json({ offer: serializeOffer(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/offers/:offerId/accept', requireRoles('USER'), async (req, res, next) => {
  try {
    const accepted = await prisma.$transaction(async (tx) => {
      const offer = await tx.serviceOffer.findUnique({
        where: { id: req.params.offerId },
        include: { request: true, mechanic: true },
      });
      if (!offer || offer.requestId !== req.params.id || offer.request.driverId !== req.currentUser.id) {
        const error = new Error('Offer not found');
        error.status = 404;
        throw error;
      }
      if (offer.status !== 'PENDING' || offer.request.status !== 'PENDING') {
        const error = new Error('Offer is no longer available');
        error.status = 409;
        throw error;
      }
      if (offer.mechanic.status !== 'ACTIVE' || offer.mechanic.availability !== 'ONLINE') {
        const error = new Error('Mechanic is no longer available');
        error.status = 409;
        throw error;
      }

      const active = await tx.serviceRequest.findFirst({
        where: {
          mechanicId: offer.mechanicId,
          status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] },
        },
      });
      if (active) {
        const error = new Error('Mechanic is no longer available');
        error.status = 409;
        throw error;
      }

      let distanceKmValue = null;
      let etaMinutes = null;
      if (offer.mechanic.lastLat != null && offer.mechanic.lastLng != null) {
        distanceKmValue = distanceKmCalc(
          offer.mechanic.lastLat,
          offer.mechanic.lastLng,
          offer.request.userLat,
          offer.request.userLng,
        );
        etaMinutes = estimateEtaMinutes(distanceKmValue);
      }

      const claimed = await tx.serviceRequest.updateMany({
        where: { id: offer.requestId, status: 'PENDING' },
        data: {
          status: 'ACCEPTED',
          mechanicId: offer.mechanicId,
          mechanicName: offer.mechanicName,
          mechanicLat: offer.mechanic.lastLat,
          mechanicLng: offer.mechanic.lastLng,
          distanceKm: distanceKmValue,
          etaMinutes,
          agreedPrice: offer.amount,
          acceptedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        const error = new Error('Another offer was already accepted');
        error.status = 409;
        throw error;
      }

      await tx.serviceOffer.update({
        where: { id: offer.id },
        data: { status: 'ACCEPTED' },
      });
      await tx.serviceOffer.updateMany({
        where: { requestId: offer.requestId, id: { not: offer.id }, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });

      return tx.serviceRequest.findUnique({ where: { id: offer.requestId } });
    }, { isolationLevel: 'Serializable' });

    const payload = serializeRequest(accepted);
    const io = req.app.get('io');
    io?.to(`user:${accepted.driverId}`).emit('request:updated', payload);
    io?.to(`user:${accepted.mechanicId}`).emit('offer:accepted', payload);
    io?.to(`request:${accepted.id}`).emit('request:updated', payload);
    io?.emit('request:taken', { id: accepted.id });
    res.json({ request: payload });
  } catch (err) {
    if (err?.code === 'P2034') {
      err.status = 409;
      err.message = 'Offer acceptance conflicted with another update. Please try again.';
    }
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
  res.status(410).json({ error: 'Send an offer and wait for the user to accept it' });
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

    const updated = await prisma.$transaction(async (tx) => {
      await tx.serviceOffer.updateMany({
        where: { requestId: request.id, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });
      return tx.serviceRequest.update({
        where: { id: request.id },
        data: { status: 'CANCELLED' },
      });
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
