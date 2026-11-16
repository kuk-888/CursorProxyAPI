# Changelog

## [1.0.0] - 2026-11-13

Initial open-source release of **CursorProxyAPI**.

### Features
- Dual-protocol HTTP gateway: OpenAI (`/v1/chat/completions`, `/v1/responses`, `/v1/models`) and Anthropic (`/v1/messages`, `/v1/messages/count_tokens`, `/v1/models`).
- Three-tier session scheduling: Tier 1 Parked Tool Resume, Tier 2 Warm Agent Prefix Reuse (Chat, Responses, and Messages), and Tier 3 Ephemeral Memory Replay (`settingSources: []`, zero SQLite/ripgrep workspace residue).
- Multi-account upstream key pool (`quota-aware`, `least-busy`, `round-robin`), sticky session affinity, automatic quota/auth circuit-breaker, and optional Web Console (`/dashboard`).

### Security & Reliability Hardening
- Constant-time SHA-256 credential comparison, strict cookie-vs-header CSRF enforcement, configurable `TRUST_PROXY`, and secret redaction on upstream errors.
- Pre-stream upstream error propagation (401/403/429/502 surface as real HTTP statuses on all SSE endpoints).
- Parallel tool-call split-batch deadlock fix and atomic sub-key request reservation.
