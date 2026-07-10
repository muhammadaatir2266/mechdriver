import { Router } from 'express';
import { prisma } from '../db.js';
import { authRequired, loadUser, publicUser, requireRoles } from '../middleware/auth.js';
import { serializeRequest, STATUS_LABEL } from '../utils/helpers.js';

const router = Router();
router.use(authRequired, loadUser, requireRoles('ADMIN'));

router.get('/analytics', async (_req, res, next) => {
  try {
    const [users, mechanics, pendingApprovals, activeRequests, completed] = await Promise.all([
      prisma.user.count({ where: { role: 'USER' } }),
      prisma.user.count({ where: { role: 'MECHANIC' } }),
      prisma.user.count({ where: { role: 'MECHANIC', status: 'INACTIVE' } }),
      prisma.serviceRequest.count({
        where: { status: { in: ['PENDING', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] } },
      }),
      prisma.serviceRequest.count({ where: { status: 'COMPLETED' } }),
    ]);

    res.json({
      totalUsers: users,
      totalMechanics: mechanics,
      pendingApprovals,
      activeRequests,
      completedRequests: completed,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const role = req.query.role ? String(req.query.role).toUpperCase() : null;
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const where = {};
    if (role && ['USER', 'MECHANIC', 'ADMIN'].includes(role)) where.role = role;
    if (status && ['ACTIVE', 'INACTIVE'].includes(status)) where.status = status;

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ users: users.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const status = String(req.body.status || '').toUpperCase();
    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
      return res.status(400).json({ error: 'status must be ACTIVE or INACTIVE' });
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/requests', async (_req, res, next) => {
  try {
    const requests = await prisma.serviceRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ requests: requests.map(serializeRequest) });
  } catch (err) {
    next(err);
  }
});

router.get('/reports', async (_req, res, next) => {
  try {
    const byStatus = await prisma.serviceRequest.groupBy({
      by: ['status'],
      _count: { status: true },
    });
    res.json({
      statusBreakdown: byStatus.map((row) => ({
        status: STATUS_LABEL[row.status] || row.status,
        count: row._count.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
