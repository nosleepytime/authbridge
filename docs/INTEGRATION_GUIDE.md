# Integration Guide — Add “Sign in with AuthBridge” to a website or app

This project implements a practical **OAuth 2 authorization code flow** starter.

## Before integration

The website or app owner must:

1. Create an AuthBridge account
2. Request developer access from `/developer`
3. Wait for admin approval
4. Create an OAuth client
5. Save the generated `client_id`
6. Save the `client_secret` if the app is confidential
7. Register the exact redirect URI(s)

## Issuer / metadata

Metadata endpoint:

```text
https://YOUR-DOMAIN/.well-known/oauth-authorization-server
```

## Authorization endpoint

```text
GET https://YOUR-DOMAIN/oauth/authorize
```

### Required query parameters

- `client_id`
- `redirect_uri`
- `response_type=code`
- `scope`
- `state`

### Public clients

For SPAs or mobile apps, also send:

- `code_challenge`
- `code_challenge_method=S256`

## Token endpoint

```text
POST https://YOUR-DOMAIN/oauth/token
```

Send as `application/x-www-form-urlencoded` or JSON.

### Confidential client example

```js
const body = new URLSearchParams({
  grant_type: 'authorization_code',
  client_id: 'ab_xxxxx',
  client_secret: 'YOUR_CLIENT_SECRET',
  code: 'CODE_FROM_CALLBACK',
  redirect_uri: 'https://example.com/callback'
});

const tokenRes = await fetch('https://YOUR-DOMAIN/oauth/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body
});

const token = await tokenRes.json();
console.log(token);
```

### Public client with PKCE example

```js
const body = new URLSearchParams({
  grant_type: 'authorization_code',
  client_id: 'ab_xxxxx',
  code: 'CODE_FROM_CALLBACK',
  redirect_uri: 'https://example.com/callback',
  code_verifier: 'THE_ORIGINAL_CODE_VERIFIER'
});

const tokenRes = await fetch('https://YOUR-DOMAIN/oauth/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body
});

const token = await tokenRes.json();
console.log(token);
```

## User info endpoint

```text
GET https://YOUR-DOMAIN/oauth/userinfo
Authorization: Bearer ACCESS_TOKEN
```

### Example

```js
const meRes = await fetch('https://YOUR-DOMAIN/oauth/userinfo', {
  headers: {
    Authorization: `Bearer ${token.access_token}`
  }
});

const profile = await meRes.json();
console.log(profile);
```

## Browser login flow example

```js
const authUrl = new URL('https://YOUR-DOMAIN/oauth/authorize');
authUrl.searchParams.set('client_id', 'ab_xxxxx');
authUrl.searchParams.set('redirect_uri', 'https://example.com/callback');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'profile email');
authUrl.searchParams.set('state', crypto.randomUUID());

window.location.href = authUrl.toString();
```

## What the callback receives

After user login and consent, the browser is redirected to:

```text
https://example.com/callback?code=AUTH_CODE&state=YOUR_STATE
```

## How permission works in this project

“Permission to add this login option” is handled by the built-in workflow:

1. Developer requests access
2. Admin reviews the project/use case
3. Admin approves or rejects
4. Approved developers can create OAuth clients
5. End users still see a consent screen when authorizing the app

## Recommended UX text

- Button text: `Continue with AuthBridge`
- Secondary text: `We only request the profile data needed to sign you in.`

## Important reminder

This starter uses opaque access tokens and a user info endpoint. If later you want strict OIDC-style ID tokens for broader ecosystem compatibility, add asymmetric JWT signing plus a JWKS endpoint.
