# AutoRescue API (Node.js + PostgreSQL)

Deployable backend for the AutoRescue Android app. Built for **Railway**.

## Stack

- Node.js 20+ / Express
- PostgreSQL via Prisma
- JWT auth
- Socket.io (live requests, location, chat)

## Local setup

```bash
cd backend
cp .env.example .env
# Edit DATABASE_URL to your Postgres
npm install
npx prisma db push
npm run db:seed
npm run dev
```

API: `http://localhost:8080`  
Health: `GET /health`

Default admin (from `.env`):
- Email: `admin@autorecue.app`
- Password: `Admin123!`

## Railway deploy

1. Create a Railway project
2. Add a **PostgreSQL** plugin
3. Deploy this `backend` folder (Root Directory = `backend`)
4. Set variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Railway Postgres connection URL (auto if linked) |
| `JWT_SECRET` | long random string |
| `ADMIN_EMAIL` | your admin email |
| `ADMIN_PASSWORD` | strong password |
| `CORS_ORIGIN` | `*` (or your domains) |
| `NEARBY_RADIUS_KM` | `25` |

`railway.toml` runs `prisma db push`, seeds admin, then starts the server.

## API overview

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Register User/Mechanic |
| POST | `/api/auth/login` | — | Login + JWT |
| GET | `/api/auth/me` | JWT | Current profile |
| POST | `/api/requests` | User | Create request with offered price |
| GET | `/api/requests/pricing` | JWT | Category minimum prices |
| GET | `/api/requests/nearby?lat=&lng=` | Mechanic | Nearby pending jobs |
| GET | `/api/requests/active` | JWT | Active job |
| POST | `/api/requests/:id/offers` | Mechanic | Send/update a counter-offer |
| POST | `/api/requests/:id/offers/:offerId/accept` | User | Accept a mechanic offer |
| POST | `/api/requests/:id/offers/:offerId/reject` | User | Reject a mechanic offer |
| PATCH | `/api/requests/:id/status` | Mechanic | Advance status |
| POST | `/api/requests/:id/location` | Mechanic | Live location |
| POST | `/api/requests/:id/cancel` | User | Cancel |
| GET/POST | `/api/chat/:peerId` | JWT | Chat history / send |
| GET | `/api/admin/analytics` | Admin | Dashboard stats |
| GET | `/api/admin/users` | Admin | List users |
| PATCH | `/api/admin/users/:id/status` | Admin | Approve mechanic |
| GET | `/api/admin/requests` | Admin | All requests |

## Socket.io events

Connect with `auth: { token: "<JWT>" }`.

| Event | Direction | Purpose |
|---|---|---|
| `request:new` | server → mechanics | New pending request |
| `request:updated` | server → parties | Status change |
| `offer:updated` | server → user | Mechanic sent/updated offer |
| `offer:accepted` | server → mechanic | User accepted offer |
| `offer:rejected` | server → mechanic | User rejected offer |
| `location:update` | server → user | Mechanic live position |
| `chat:message` | both | New chat message |
| `mechanic:location` | mechanic → server | Push GPS while on job |
| `request:subscribe` | client → server | Join request room |

## Android

Set your Railway URL in:

`app/.../api/ApiConfig.java` → `BASE_URL`
