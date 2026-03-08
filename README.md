# AuthBridge for Cloudflare Pages

A full starter for building your own **"Sign in with X"** service on **Cloudflare Pages + D1**.

## What this project includes

- User sign up
- User sign in
- Session cookie auth
- Developer access request workflow
- Admin approval workflow
- OAuth client creation
- OAuth authorization code flow
- PKCE support for public clients
- Consent screen
- Access token endpoint
- User info endpoint
- Weglot-ready pages

## Architecture

- **Cloudflare Pages** for static pages and the `_worker.js` advanced mode router
- **D1** for users, sessions, developer requests, apps, codes, consents and access tokens
- **Weglot** optional JavaScript translation on the auth pages

## Quick start

### 1) Install dependencies

```bash
npm install
```

### 2) Create a D1 database

```bash
npx wrangler d1 create authbridge-db
```

Copy the returned `database_id` into `wrangler.jsonc`.

### 3) Apply the schema

Local:

```bash
npx wrangler d1 migrations apply AUTHBRIDGE_DB --local
```

Remote:

```bash
npx wrangler d1 migrations apply AUTHBRIDGE_DB --remote
```

### 4) Add secrets

Create at least these secrets in Cloudflare:

```bash
npx wrangler secret put BOOTSTRAP_KEY
npx wrangler secret put WEGLOT_API_KEY
```

`WEGLOT_API_KEY` is optional. If you do not set it, the pages still work.

### 5) Run locally

```bash
npm run dev
```

### 6) Deploy

```bash
npm run deploy
```

Or connect the repository to Cloudflare Pages and set the build output directory to `public`.

## First admin creation

After deployment:

1. Open `/admin`
2. Use the bootstrap form
3. Enter the same `BOOTSTRAP_KEY` value you stored in Cloudflare
4. Create your first admin account
5. Log in with that admin account and approve developer requests

## Core URLs

- Home: `/`
- Login: `/login`
- Sign up: `/signup`
- Dashboard: `/dashboard`
- Developer portal: `/developer`
- Admin: `/admin`

## OAuth endpoints

- Authorization: `/oauth/authorize`
- Token: `/oauth/token`
- User info: `/oauth/userinfo`
- Revocation: `/oauth/revoke`
- Metadata: `/.well-known/oauth-authorization-server`

## Supported scopes

- `profile`
- `email`

## Production hardening still recommended

This starter really runs, but for a stronger production system you should still add:

- Email verification
- Forgot password / reset password
- Rate limiting / bot protection
- Audit logs
- MFA
- Stronger token strategy with asymmetric signing and JWKS if you want full OIDC style ID tokens
- Better admin moderation tooling
