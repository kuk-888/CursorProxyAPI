# Contributing to CursorProxyAPI

Thank you for contributing!

## Prerequisites

- **Node.js `>= 22.13.0`** (required by `@cursor/sdk@1.0.31`)
- `npm ci` to install dependencies (`@cursor/sdk` is fetched from npm by the developer; it is never committed to this repo)

## Local Development & Testing

All unit and integration tests run offline using mocked `agentFactory` and `modelListFetcher` implementations—no real `crsr_` key is required.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## Pull Request Guidelines

1. Keep `src/` strictly typed (`npm run typecheck` must pass with zero errors and no `any`).
2. Add or update regression tests under `test/` for any protocol, security, or pool-scheduling change.
3. Never commit `.env`, `admin-session.key`, `gateway-keys.json`, `usage-ledger.json`, real `crsr_` keys, JWTs, or private server URLs.
4. Keep both `README.md` and `README_EN.md` in sync when changing environment variables, endpoints, or compatibility boundaries.
