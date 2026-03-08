# Deployment Guide — Cloudflare Pages + D1

## Recommended free stack

- GitHub repository
- Cloudflare Pages
- Cloudflare D1
- Optional Weglot

## Deploy with GitHub

1. Push this folder to GitHub.
2. In Cloudflare, create a new **Pages** project and connect your GitHub repository.
3. Set the build output directory to `public`.
4. Add the D1 binding:
   - Variable name: `AUTHBRIDGE_DB`
   - Database: your D1 database
5. Add these secrets:
   - `BOOTSTRAP_KEY`
   - `WEGLOT_API_KEY` (optional)
6. Deploy.

## Deploy with Wrangler direct upload

```bash
npm install
npx wrangler pages deploy public
```

## Local development with D1

```bash
npx wrangler pages dev public --d1 AUTHBRIDGE_DB=YOUR_DATABASE_ID
```

Or keep the `d1_databases` section in `wrangler.jsonc` and use:

```bash
npm run dev
```

## First boot checklist

- Database created
- Migration applied
- Secrets added
- First admin created through `/admin`
- Admin approved at least one developer request
- Developer created at least one OAuth client

## Pretty routes

The project uses Pages **advanced mode** with a single `_worker.js` router, while still serving static assets from `public/`.
