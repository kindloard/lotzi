# Namastore

Namastore is a hyperlocal local-commerce marketplace for connecting nearby customers with local shops such as grocery stores, kirana shops, vegetable shops, bakeries, pharmacies, and local retailers.

The MVP goal is simple: onboard 10 real shops, upload real products, and enable real customers to place orders quickly.

## Core Business Idea

Namastore helps local shops sell online without needing their own app or website. Customers can either browse products across all shops or discover nearby shops and order directly from a selected store.

## User Roles

- Customer: browses products, discovers nearby shops, places orders, tracks orders, and views order history.
- Store Owner: creates a shop, uploads products, manages prices and stock, accepts or rejects orders, and manages delivery availability.
- Admin: manages users, shops, products, orders, categories, approvals, and basic reports.

## MVP Features

### Customer

- Sign up and login using backend-owned auth with email OTP verification and Google identity proof
- Browse marketplace products from all shops
- Search products
- Filter by category
- Detect location
- View nearby shops
- View products from a selected shop
- Add products to cart
- Checkout with address
- Choose COD or Razorpay online payment
- Track order status
- Cancel eligible orders
- View order history

### Store Owner

- Sign up and login
- Create and update shop profile
- Set shop location, timings, and delivery availability
- Add, edit, and remove products
- Upload product images using Cloudinary
- Set product price and stock
- Receive new orders
- Accept or reject orders
- Update order status

### Admin

- View and manage users
- Approve or reject shops
- Manage categories
- View products and orders
- Monitor basic reports for sales, shops, and order activity

## Tech Stack

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- Firebase Auth client SDK only for Google sign-in token acquisition
- Google Maps browser APIs

### Backend

- NestJS
- TypeScript
- PostgreSQL
- Prisma ORM
- Firebase Admin SDK only for server-side Google token verification
- Cloudinary
- Razorpay

### Infrastructure

- Frontend: Vercel
- Backend: Render, Railway, Fly.io, or a simple VPS
- Database: Neon, Supabase, Railway PostgreSQL, or managed PostgreSQL
- Image storage: Cloudinary
- Payments: Razorpay
- Maps: Google Maps Platform

## Folder Structure

```txt
namastore/
  README.md
  .gitignore
  .env.example

  frontend/
    package.json
    next.config.ts
    tsconfig.json
    src/
      app/
      components/
      features/
        auth/
        cart/
        checkout/
        marketplace/
        shops/
        orders/
        owner/
        admin/
      lib/
      services/
      styles/
      types/

  backend/
    package.json
    nest-cli.json
    tsconfig.json
    prisma/
      schema.prisma
      migrations/
      seed.ts
    src/
      main.ts
      app.module.ts
      config/
      common/
      database/
      modules/
        auth/
        users/
        shops/
        products/
        categories/
        cart/
        orders/
        payments/
        uploads/
        admin/
      integrations/
        firebase/
        cloudinary/
        razorpay/
        google-maps/

  shared/
    types/
    constants/

  docs/
    architecture.md
    api.md
    database.md
    deployment.md
```

## Local Development

### Prerequisites

- Node.js 20+
- npm
- PostgreSQL
- Firebase project
- Cloudinary account
- Razorpay account
- Google Maps API key

### Setup

1. Install frontend dependencies:

```bash
cd frontend
npm install
```

2. Install backend dependencies:

```bash
cd backend
npm install
```

3. Create environment files:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

4. Start PostgreSQL locally or use a hosted development database.

5. Run database migrations:

```bash
cd backend
npx prisma migrate dev
```

6. Start backend:

```bash
cd backend
npm run dev
```

Use `npm run dev` or `npm run start:dev` during development; both run Nest in watch mode and restart the backend when TypeScript files change. `npm start` runs the compiled `dist` build and does not hot reload.

7. Start frontend:

```bash
cd frontend
npm run dev
```

## Environment Setup

Root `.env.example` documents shared project-level values. The frontend and backend each have their own `.env.example` files with app-specific variables.

Backend environment:

```env
DATABASE_URL=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
GOOGLE_MAPS_API_KEY=
FRONTEND_URL=http://localhost:3000
PORT=4000
```

Frontend environment:

```env
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
```

For mobile GPS testing, open the frontend over HTTPS. Mobile browsers will not show GPS permission prompts on plain `http://192.168.x.x:3000`. Use the frontend HTTPS dev script and keep `NEXT_PUBLIC_API_URL=/api` so API calls stay on the same origin:

```bash
cd frontend
npm run dev:https
```

## API Philosophy

The backend owns business rules. The frontend should not decide order status, shop approval, payment verification, stock updates, or admin permissions.

Use simple REST APIs for MVP:

- `/auth`
- `/users`
- `/shops`
- `/products`
- `/categories`
- `/cart`
- `/orders`
- `/payments`
- `/uploads`
- `/admin`

Keep APIs predictable, typed, and boring. Add GraphQL or advanced API gateways only if there is a real need later.

## Database Philosophy

Use PostgreSQL as the source of truth.

Core tables for MVP:

- users
- shops
- products
- categories
- carts
- cart_items
- orders
- order_items
- payments
- addresses

Keep the schema normalized enough to avoid data chaos, but avoid premature analytics, audit-log, and multi-tenant complexity until the business proves it needs them.

## Security Basics

- Use backend-owned authentication, sessions, JWTs, refresh rotation, revocation, and audit logs.
- Verify Firebase ID tokens only for Google login and map them to backend identities.
- Use role-based access checks for customer, owner, and admin routes.
- Never trust frontend role claims without backend verification.
- Store secrets only in environment variables.
- Validate all request payloads.
- Verify Razorpay payments on the backend.
- Restrict Cloudinary upload operations through backend-controlled signatures or upload endpoints.
- Add rate limiting for auth-sensitive and order/payment endpoints before launch.

## Deployment Basics

Recommended MVP deployment:

- Deploy frontend to Vercel.
- Deploy backend to Render, Railway, Fly.io, or a simple VPS.
- Use managed PostgreSQL from Neon, Supabase, Railway, or another provider.
- Configure production environment variables in each platform.
- Run Prisma migrations during backend deployment.
- Use Cloudinary for product and shop images.
- Use Firebase for auth.
- Use Razorpay test mode first, then switch to live keys after verification.

## Major Folder Purpose

- `frontend`: Next.js customer, store-owner, and admin UI.
- `backend`: NestJS REST API, business logic, authentication verification, payments, uploads, and database access.
- `backend/src/modules`: Core business domains such as shops, products, orders, payments, admin, and users.
- `backend/src/integrations`: External services such as Firebase, Cloudinary, Razorpay, and Google Maps.
- `shared`: Lightweight shared constants and TypeScript types only. Avoid turning this into a complex internal package at MVP stage.
- `docs`: Practical project notes for architecture, API behavior, database design, and deployment.

## Scaling Later

Do not start with microservices. Scale only when the product shows traction.

Possible later improvements:

- Add Redis for caching nearby shops, categories, and hot products.
- Add background jobs for notifications, reports, payment reconciliation, and order reminders.
- Move search to Meilisearch, Typesense, or Elasticsearch if PostgreSQL search becomes weak.
- Add delivery partner workflows if delivery is handled by the platform.
- Split owner/admin/customer dashboards only if the frontend becomes too large.
- Add analytics warehouse only after order volume justifies it.
- Split backend modules into services only when team size and traffic require it.
