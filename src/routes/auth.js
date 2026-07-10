import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { prisma } from '../db.js';
import { authRequired, loadUser, publicUser, signToken } from '../middleware/auth.js';

const router = Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg, details: errors.array() });
    return false;
  }
  return true;
}

function mapRole(input) {
  const r = String(input || 'USER').toUpperCase();
  if (r === 'DRIVER' || r === 'USER') return 'USER';
  if (r === 'MECHANIC') return 'MECHANIC';
  if (r === 'ADMIN') return 'ADMIN';
  return null;
}

router.post(
  '/register',
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional(),
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const role = mapRole(req.body.role || 'USER');
      if (!role || role === 'ADMIN') {
        return res.status(400).json({ error: 'Role must be User or Mechanic' });
      }

      const existing = await prisma.user.findUnique({
        where: { email: req.body.email.toLowerCase() },
      });
      if (existing) return res.status(409).json({ error: 'Email already registered' });

      const passwordHash = await bcrypt.hash(req.body.password, 10);
      const user = await prisma.user.create({
        data: {
          name: req.body.name.trim(),
          email: req.body.email.toLowerCase().trim(),
          phone: req.body.phone || null,
          passwordHash,
          role,
          status: role === 'MECHANIC' ? 'INACTIVE' : 'ACTIVE',
        },
      });

      if (role === 'MECHANIC') {
        return res.status(201).json({
          message: 'Registered. Wait for admin approval before logging in.',
          user: publicUser(user),
          requiresApproval: true,
        });
      }

      const token = signToken(user);
      return res.status(201).json({ token, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/login',
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res, next) => {
    try {
      if (!validate(req, res)) return;
      const expectedRole = mapRole(req.body.role);

      const user = await prisma.user.findUnique({
        where: { email: req.body.email.toLowerCase().trim() },
      });
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });

      const ok = await bcrypt.compare(req.body.password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

      if (expectedRole && user.role !== expectedRole) {
        return res.status(403).json({
          error: `This account is registered as ${user.role}. Choose the matching role.`,
        });
      }

      if (user.role === 'MECHANIC' && user.status === 'INACTIVE') {
        return res.status(403).json({ error: 'Mechanic account pending admin approval' });
      }

      const token = signToken(user);
      return res.json({ token, user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/me', authRequired, loadUser, (req, res) => {
  res.json({ user: publicUser(req.currentUser) });
});

router.patch('/me', authRequired, loadUser, async (req, res, next) => {
  try {
    const data = {};
    if (req.body.name) data.name = req.body.name;
    if (req.body.phone !== undefined) data.phone = req.body.phone;
    if (req.body.fcmToken !== undefined) data.fcmToken = req.body.fcmToken;
    if (req.body.availability && ['ONLINE', 'OFFLINE'].includes(req.body.availability)) {
      data.availability = req.body.availability;
    }
    if (req.body.lat != null && req.body.lng != null) {
      data.lastLat = Number(req.body.lat);
      data.lastLng = Number(req.body.lng);
    }

    const user = await prisma.user.update({
      where: { id: req.currentUser.id },
      data,
    });
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

export default router;
