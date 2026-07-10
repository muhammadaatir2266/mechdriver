import { Router } from 'express';
import { prisma } from '../db.js';
import { authRequired, loadUser } from '../middleware/auth.js';

const router = Router();
router.use(authRequired, loadUser);

router.get('/', async (req, res, next) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { userId: req.currentUser.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ vehicles });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { make, model, year, plateNumber } = req.body;
    if (!make || !model || !year || !plateNumber) {
      return res.status(400).json({ error: 'make, model, year, plateNumber required' });
    }
    const vehicle = await prisma.vehicle.create({
      data: {
        userId: req.currentUser.id,
        make,
        model,
        year: String(year),
        plateNumber,
      },
    });
    res.status(201).json({ vehicle });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
    if (!vehicle || vehicle.userId !== req.currentUser.id) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
