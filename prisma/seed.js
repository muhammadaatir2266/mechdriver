import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { config } from '../src/config.js';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(config.adminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { email: config.adminEmail.toLowerCase() },
    update: {
      name: config.adminName,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
    },
    create: {
      name: config.adminName,
      email: config.adminEmail.toLowerCase(),
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`Admin ready: ${admin.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
