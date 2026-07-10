import { Router } from 'express';
import { prisma } from '../db.js';
import { authRequired, loadUser, requireRoles } from '../middleware/auth.js';

const router = Router();
router.use(authRequired, loadUser);

router.post('/', requireRoles('MECHANIC'), async (req, res, next) => {
  try {
    const { requestId, amount, description } = req.body;
    if (!requestId || amount == null || !description) {
      return res.status(400).json({ error: 'requestId, amount, description required' });
    }

    const request = await prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!request || request.mechanicId !== req.currentUser.id) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const invoice = await prisma.invoice.upsert({
      where: { requestId },
      create: {
        requestId,
        driverId: request.driverId,
        mechanicId: req.currentUser.id,
        amount: Number(amount),
        description,
      },
      update: {
        amount: Number(amount),
        description,
      },
    });

    if (request.status !== 'COMPLETED') {
      await prisma.serviceRequest.update({
        where: { id: requestId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }

    res.status(201).json({ invoice });
  } catch (err) {
    next(err);
  }
});

router.get('/by-request/:requestId', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { requestId: req.params.requestId },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (
      invoice.driverId !== req.currentUser.id &&
      invoice.mechanicId !== req.currentUser.id &&
      req.currentUser.role !== 'ADMIN'
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/pay', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice || invoice.driverId !== req.currentUser.id) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { paid: true },
    });
    res.json({ invoice: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/ratings', async (req, res, next) => {
  try {
    const { requestId, mechanicId, score, review } = req.body;
    if (!requestId || !mechanicId || !score) {
      return res.status(400).json({ error: 'requestId, mechanicId, score required' });
    }

    const rating = await prisma.rating.upsert({
      where: { requestId },
      create: {
        requestId,
        driverId: req.currentUser.id,
        mechanicId,
        score: Number(score),
        review: review || null,
      },
      update: {
        score: Number(score),
        review: review || null,
      },
    });

    const agg = await prisma.rating.aggregate({
      where: { mechanicId },
      _avg: { score: true },
      _count: { score: true },
    });

    await prisma.user.update({
      where: { id: mechanicId },
      data: {
        rating: agg._avg.score || 5,
        completedJobs: agg._count.score,
      },
    });

    res.status(201).json({ rating });
  } catch (err) {
    next(err);
  }
});

export default router;
