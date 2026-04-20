# Hybrid Cloud File Sharing Platform

This is a full-stack file sharing application with a React frontend and an Express backend, using Supabase (Postgres + Storage) as the cloud data layer.

The app lets users upload files, share them with a 6-digit access code (plus link/QR), control who can access private files, and manage files from a dashboard. It also includes a Razorpay-based premium upgrade flow.

## Features

- File upload and sharing with access code, link, and QR code
- Anonymous upload support and authenticated user flows
- Google sign-in (one-tap style OAuth login/registration)
- Access page with preview/download support
- Dashboard for file management, visibility toggle, sharing by email, and activity tracking
- Access control modes: public, allowlist, blocklist
- Strict private-file behavior: private files are only accessible by owner or explicitly shared users
- Subscription plans with Razorpay checkout and verification
- Optional encryption/compression pipeline before storage
- Expiry lifecycle:
  - Default file expiry is 24 hours
  - Only Pro users can extend expiry
  - Expired files are deleted from Supabase Storage and database by cron cleanup

## Tech Stack

- Frontend: React 19, Vite, Tailwind CSS, Framer Motion
- Backend: Node.js, Express, Multer, JWT, Helmet, Rate Limiting
- Cloud: Supabase Postgres + Supabase Storage
- Payments: Razorpay
- Email: Nodemailer (with graceful fallback when SMTP is missing/invalid)

## Project Structure

- `client/` - React frontend
- `server/` - Express API and business logic
- `docker-compose.yml` - Local multi-service run (frontend + backend)
- `SUPABASE_COMPLETE_SCHEMA.sql` - DB schema for Supabase
- `PROJECT_REPORT_CONTENT.md` and synopsis scripts - project documentation/report utilities

## Current Business Rules

- Free users:
  - Max upload size per file: 100 MB
  - Default expiry: 24 hours
  - Cannot extend expiry
- Pro users:
  - Max upload size per file: 5 GB
  - Can extend expiry by requested days
- Private access:
  - If a file is private, access code alone is not enough
  - Access is only allowed for owner or allowlisted users with permission
- Expired files:
  - Cron runs every 10 minutes
  - Deletes file object from Supabase Storage first, then removes DB record
  - Updates owner storage usage after cleanup

## Environment Variables

This repo is configured to use a single shared root `.env` file for both server and frontend runtime/build usage.

Minimum recommended variables:

```env
# Core backend
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
PORT=5000
CLIENT_URL=http://localhost:5173,https://your-production-app.vercel.app

# Frontend
VITE_API_URL=/api
VITE_RAZORPAY_KEY_ID=
VITE_GOOGLE_CLIENT_ID=

# Payments
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Optional email
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
SMTP_FROM=

# Google sign-in
GOOGLE_CLIENT_ID=
# Optional: map origin-specific Google client IDs
# GOOGLE_CLIENT_ID_MAP=https://your-production-app.vercel.app=xxx.apps.googleusercontent.com,https://your-preview-app.vercel.app=yyy.apps.googleusercontent.com

# Optional logging/security
LOG_LEVEL=debug
ENABLE_MALWARE_SCAN=false
MALWARE_SCANNER_PATH=clamscan
MALWARE_SCAN_TIMEOUT_MS=20000
TRUST_PROXY=true
ALLOW_VERCEL_PREVIEWS=false
MULTER_MAX_FILE_SIZE_BYTES=104857600
MAX_FILES_PER_UPLOAD=20
PRIVACY_MINIMIZE_LOGS=true
```

## Vercel Deployment Checklist (Google Sign-In)

Set these values in Vercel Project Settings -> Environment Variables (Production and Preview as needed):

- `GOOGLE_CLIENT_ID` (server runtime)
- `VITE_GOOGLE_CLIENT_ID` (frontend build/runtime fallback)
- `CLIENT_URL` with your allowed frontend origins (comma-separated)
- `VITE_API_URL=/api` when frontend and backend are deployed from the same Vercel project

Google Cloud Console (OAuth Web Client) must include exact Authorized JavaScript origins:

- `https://your-production-app.vercel.app`
- `https://your-custom-domain.com` (if used)

Important:

- Use origin only (no path, no trailing slash)
- Keep `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` aligned unless you intentionally use origin-specific IDs
- If you use different IDs for production vs preview, use `GOOGLE_CLIENT_ID_MAP`

## Local Development

### Prerequisites

- Node.js 18+
- npm
- A Supabase project with schema applied

### Install

```bash
npm install
npm install --prefix server
npm install --prefix client
```

### Run

```bash
npm run start
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- Health check: `GET /api/health`

## Run With Docker

```bash
docker compose up -d --build
```

- Frontend container publishes `5173`
- Backend container publishes `5000`

## API Overview

- Auth routes: `/api/auth/*`
  - register, login, google sign-in, email verification, forgot/reset password, profile, upgrade
- File routes: `/api/files/*`
  - upload, fetch by code, preview, download
- Dashboard routes: `/api/dashboard/*` (protected)
  - my files, stats, delete, extend, visibility, allowlist/blocklist/activity
- Payment routes: `/api/payment/*`
  - plans, create order, verify payment, status, cancel, webhook

## Database Notes

Key tables used by backend logic include:

- `users`
- `files`
- `file_permissions`
- `file_activity`
- `payments`

Supabase Storage bucket used by uploads: `uploads`.

## Useful Root Scripts

- `npm run start` - run frontend and backend concurrently
- `npm run server` - run backend
- `npm run client` - run frontend dev server
- `npm run build` - build frontend

## Troubleshooting

- Payment popup failure:
  - Ensure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are present in server env
  - Ensure frontend uses the correct API URL (`VITE_API_URL`)
- Auth email issues:
  - If SMTP is not configured, the app falls back gracefully instead of blocking auth flows
- Cannot access private file:
  - Owner must share via allowlist for non-owner access

## Security Baseline

### Runtime protections

- Auth endpoints are now rate-limited to reduce brute-force attempts.
- Upload throttling supports plan-aware limits and identity-aware keys.
- Webhook signature verification uses captured raw request body.
- Optional malware scanning now works for both memory and disk-backed uploads.
- Privacy-minimized activity logging can mask email and hash IP via `PRIVACY_MINIMIZE_LOGS=true`.

### CI/CD protections

- GitHub Actions workflow for:
  - secret scanning (`gitleaks`)
  - dependency review on pull requests
  - client build + high-severity dependency audits
- CodeQL static analysis workflow for JavaScript.
- Dependabot updates for server/client npm dependencies and GitHub Actions.

### Firewall and edge recommendations

- On Vercel, keep `ALLOW_VERCEL_PREVIEWS=false` in production unless you explicitly need preview domains.
- If using Cloudflare/WAF, enforce:
  - managed WAF rules
  - bot protection
  - request size limits aligned with `MULTER_MAX_FILE_SIZE_BYTES`
  - geo/IP rules for sensitive admin/payment paths when appropriate

## Status

The project is currently wired for Supabase-first storage and access control, with premium subscription support and active expiry cleanup logic.