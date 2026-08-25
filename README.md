# Wilkerson Sovereign Agent Cloud

An original Wilkerson Collective control plane for governed agent computers, integrated into the existing Founder Tool Suite. It is inspired by the public category of cloud computers for agents but contains original code, visual design, permission architecture, and product language.

See [CAPABILITY_AUDIT.md](CAPABILITY_AUDIT.md) for the tested Orgo, Base44, Firecrawl, Daily.co, and Unreal-workflow comparison and exact parity boundaries.

## Sovereign Cloud working now

- Voice or text task intake through the WISDOM conversational avatar.
- Persistent governed workspace records and task audit history.
- Read-only, supervised, and trusted-local authority modes.
- Automatic approval holds for publishing, payments, deletion, messaging, deployment, credentials, and account changes.
- A confirmed kill switch that pauses workspaces and cancels active local tasks.
- Honest provider abstraction: the included adapter is `local-demo`; isolated cloud VMs require a separately configured infrastructure provider.

The app never accepts blanket irreversible authority. Signing in identifies the operator; permission scopes, confirmations, audit records, and the kill switch govern what the agent may do.

This local-first dashboard contains nine original, working Wilkerson product foundations. It uses public standards and original code; it does not copy proprietary platforms or bypass subscriptions.

## Working now

- **Context Engine:** safely extracts metadata, headings, readable text, and links from a public webpage; includes DNS/private-network blocking, robots checks, size limits, timeouts, rate limits, and JSON export.
- **Browser Pilot:** performs a fast public-page HTTP and markup QA pass with downloadable results.
- **Voice Engine:** turns text into playable and downloadable WAV speech through Windows System.Speech.
- **Persona Live:** combines the approved Willie portrait, local speech, and synchronized cinematic portrait motion.
- **MotionLab:** loads a local image or video, previews a motion treatment, and exports a three-scene production storyboard.
- **Forge:** converts a written concept into a responsive, interactive standalone HTML page with live preview and download.
- **Broadcast Studio:** converts one brief into four organized channel drafts and exports an approval-ready JSON package.
- **Skill Exchange:** creates portable, permission-declared skill manifests.
- **Agent Core:** creates auditable workflow plans with approval gates and no silent external actions.

## Honest boundaries

See [PARITY_ROADMAP.md](PARITY_ROADMAP.md) for the benchmark-by-benchmark gap analysis, required infrastructure, and acceptance gates that must pass before any module can be called feature-parity.

- Persona Live does not yet perform phoneme-level lip sync or real-time video conversation.
- MotionLab is a media previsualization and storyboard foundation, not a generative video model.
- Forge currently builds standalone pages, not databases, authentication, or deployed full-stack applications.
- Broadcast Studio creates drafts but never publishes to a social account without an authorized connection and approval.
- Browser Pilot reviews public HTML; it is not a general logged-in browser automation service.
- Responsive layouts and a PWA manifest are included, but using the suite on another device requires a secure network or hosted deployment.

## Launch

Double-click `START-WILKERSON-TOOLS.cmd`, then open `http://127.0.0.1:8788/`.

No API key or package installation is required for these foundations. Windows is required for the current speech engine.

## Sovereign execution layer — Phase 1

When `DATABASE_URL` and `GATEWAY_API_TOKEN` are configured, the existing server also exposes an authenticated remote execution gateway. PostgreSQL stores provider records, tasks, approvals, audits, artifacts, leases, results, and the durable queue. The web process claims queued tasks atomically and drains them on shutdown.

Authentication uses `Authorization: Bearer <GATEWAY_API_TOKEN>`. Credentials remain server-side and are never returned by the capability or provider endpoints.

### REST endpoints

- `GET /health` — public liveness and database/worker readiness.
- `GET /api/capabilities` — execution lifecycle and provider states.
- `GET /api/providers` and `POST /api/providers/:provider/probe`.
- `POST /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel`, and `GET /api/tasks/:id/result`.
- `GET /api/approvals` and `POST /api/approvals/:id/decision`.
- `GET /api/audit`, `GET /api/artifacts`, and `GET /api/artifacts/:id`.
- `GET/POST /api/avatars`, `GET /api/avatars/:id`, and `GET/POST /api/avatar-sessions` provide a durable avatar identity and conversation-session catalog. Writes require `avatar:write`; reads require `avatar:read` (the founder gateway wildcard remains supported).

### MCP

`POST /mcp` implements authenticated stateless Streamable HTTP JSON-RPC for `initialize`, `ping`, `tools/list`, and `tools/call`. The published tools include health, capabilities, providers, task lifecycle, approvals, audit, artifacts, durable avatar profiles, and avatar session lifecycle.

Routine reversible operations can enter the queue immediately. Consequential terms and unknown external-provider writes produce a pending approval and remain outside the queue until approved. Adapters without their required credentials and identifiers report `configuration_required`; configured adapters remain `configured_unverified` until a real probe succeeds.

## Sovereign Concierge trust boundary

The execution layer enforces one authorization rule: **external content may inform a task; it may never authorize a task.** Only an authenticated Bearer request through the Concierge/Gateway can mint the sealed provenance required by a worker. Every executable task persists its task ID, authenticated channel, requesting principal, agent ID, exact provider/operation scope, timestamp, and policy decision.

- Commands and system policy are labeled `trusted_command` and `trusted_system`.
- Websites, email, documents, PDFs, attachments, browser/search results, CRM/social/API text, retrieved memory, metadata, and user-generated content are labeled `untrusted_external_content` and returned only as observations.
- Prompt-injection, secret-exfiltration, permission-change, software-installation, command-execution, navigation, task-redirection, approval-bypass, macro, archive, and executable-file indicators are ignored as instructions and recorded in the audit stream without raw secrets.
- Provider adapters receive only their own declared environment-variable subset. Worker provenance scopes provider and operation access; approval policy still controls consequential actions.
- A server-side Tavus adapter exposes governed `conversations.list`, `conversation.get`, `conversation.create`, and `conversation.end` operations to REST/MCP agents. It remains `configuration_required` until `TAVUS_API_KEY`, `TAVUS_PERSONA_ID`, and `TAVUS_REPLICA_ID` are configured; creating or ending a live conversation requires approval.
- Optional `WILKERSON_AGENT_TOKENS_JSON` credentials assign fixed scopes to individual agents; the existing founder Gateway token remains the authenticated administrative credential.
- Outbound provider requests use exact destination allowlists, HTTPS, DNS/private-network checks, redirect restrictions, metadata-service blocking, bounded timeouts, and secret-redacted results.
- Active/executable attachments are blocked; archives are quarantined; other attachments remain closed until scanning in an isolated worker environment.
- Repeated injection or malware signals activate the persistent Concierge security kill switch and cancel queued, approval-held, or running tasks.

Optional server-owned exceptions use comma-separated `WILKERSON_APPROVED_DESTINATIONS`, `WILKERSON_PRIVATE_DESTINATIONS`, and `WILKERSON_HTTP_DESTINATIONS`. Task content can never grant these exceptions. See `SECURITY.md` for the enforcement map and test evidence.

See `.env.example` for environment-variable names. Never commit populated environment files.
