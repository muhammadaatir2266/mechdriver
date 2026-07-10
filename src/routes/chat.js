import { Router } from 'express';
import { prisma } from '../db.js';
import { authRequired, loadUser } from '../middleware/auth.js';
import { chatIdFor } from '../utils/helpers.js';

const router = Router();
router.use(authRequired, loadUser);

router.get('/:peerId', async (req, res, next) => {
  try {
    const chatId = chatIdFor(req.currentUser.id, req.params.peerId);
    const messages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    res.json({
      chatId,
      messages: messages.map((m) => ({
        id: m.id,
        chatId: m.chatId,
        requestId: m.requestId,
        senderId: m.senderId,
        receiverId: m.receiverId,
        message: m.body,
        timestamp: m.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:peerId', async (req, res, next) => {
  try {
    const body = (req.body.message || req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Message is required' });

    const peerId = req.params.peerId;
    const chatId = chatIdFor(req.currentUser.id, peerId);

    const message = await prisma.message.create({
      data: {
        chatId,
        senderId: req.currentUser.id,
        receiverId: peerId,
        body,
        requestId: req.body.requestId || null,
      },
    });

    const payload = {
      id: message.id,
      chatId: message.chatId,
      requestId: message.requestId,
      senderId: message.senderId,
      receiverId: message.receiverId,
      message: message.body,
      timestamp: message.createdAt,
    };

    const io = req.app.get('io');
    io?.to(`user:${peerId}`).emit('chat:message', payload);
    io?.to(`user:${req.currentUser.id}`).emit('chat:message', payload);

    res.status(201).json({ message: payload });
  } catch (err) {
    next(err);
  }
});

export default router;
