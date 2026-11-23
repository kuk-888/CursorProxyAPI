# Security Policy

## Supported Versions

Only the latest release on the default branch is supported with security updates.

## Reporting a Vulnerability

**Please do not open public GitHub Issues for security vulnerabilities.**

Use GitHub's **Private Vulnerability Reporting** ("Security" tab → "Report a vulnerability") to submit details privately. Include:
- Affected file(s) and version / commit hash
- Minimal reproduction steps (with all `crsr_` keys, `sk-cgw-` tokens, `adm_` cookies, and passwords redacted)
- Impact assessment

## Security Model & Scope

- **Never expose without authentication**: Open mode is intentionally unsupported; `GATEWAY_TOKEN` is mandatory on startup.
- **Reverse proxy trust**: By default (`TRUST_PROXY=loopback`), `X-Forwarded-For` and `X-Real-IP` are only honored when the TCP peer is loopback (`127.0.0.1` / `::1`). Set `TRUST_PROXY=off` if exposed directly without a proxy.
- **Upstream & admin credentials**: Never commit `.env`, `admin-session.key`, `gateway-keys.json`, or `usage-ledger.json`.
- **Native web tools**: `ALLOW_NATIVE_WEB_TOOLS` defaults to `false` so Cursor SDK's local `LocalFetchExecutor` is not reachable unless explicitly enabled by the operator.

## Known Dependency Advisories (`npm audit`)

This project has a single runtime dependency (`@cursor/sdk@1.0.31`). Transitive advisories reported by `npm audit --omit=dev` (in `undici`, `zod`, `@fastify/busboy`, and `@connectrpc/connect-node`) originate inside `@cursor/sdk` and cannot be overridden independently without risking SDK breakage:

- The HTTP server itself uses Node's built-in `node:http` module (not Fastify or `undici` server).
- We mitigate request-body exhaustion at the gateway boundary via `MAX_BODY_BYTES` and strict `application/json` `Content-Type` enforcement before parsing.
- Keep `Node.js >= 22.13` up to date and place the gateway behind a reverse proxy (Caddy/Nginx) with request-size and rate limits.
