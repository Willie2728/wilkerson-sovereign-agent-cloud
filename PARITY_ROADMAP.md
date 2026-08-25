# Sovereign application parity roadmap

Reviewed: 2026-08-25

“Parity” means that a Wilkerson module can complete the same core customer jobs as its named benchmark, with comparable persistence, security, reliability, and verified end-to-end behavior. A visual resemblance or a single demonstration flow does not count.

## Executive verdict

None of the five named equivalents is currently at full product parity. The existing stack is a secure governed control plane with several working focused workflows. Full parity requires substantial product-specific services, infrastructure, credentials, and acceptance suites beyond this repository's current implementation.

| Sovereign module | Benchmark | Current verified level | Principal missing systems | What is required for parity |
|---|---|---|---|---|
| Sovereign Agent Cloud | Orgo | Governed control plane | Actual Linux desktop provisioning; sub-second lifecycle; persistent disks; screenshot, mouse, keyboard, shell and file APIs; VNC/embedded viewer; templates; secrets; direct model-computer loop | Configure or build a VM provider, implement every lifecycle/action adapter, encrypted per-computer storage, streaming viewer, template service, quotas, regional capacity, and destructive-action tests |
| Forge AI | Base44 | Standalone front-end generator | Multi-file projects; durable app database; accounts; registration; roles and row-level permissions; backend functions; workflows; email; connectors; payments; branches/version history; collaborative editor; testing agent; analytics; managed publishing, domains and mobile packaging | A separate full-stack app-builder platform: isolated build workers, project/version store, code editor and preview runtime, schema/migration service, auth/RBAC, function runtime, connector vault, deployment pipeline, observability, billing and security scanning |
| Context Crawler / Page Extractor | Firecrawl | Safe HTTP extraction and bounded same-origin crawl | JavaScript/browser rendering; scrape formats; map and search; batch and asynchronous jobs; webhook delivery; schema-driven extraction; actions; proxy/geolocation; large distributed crawl scheduling and anti-bot handling | Browser-rendering worker fleet, queue and job store, extraction models, webhook signing, proxy policy, crawl budgets, robots/terms enforcement, cache and production-scale reliability tests |
| Wilkerson Rooms | Daily.co | Local device preview | Multi-user rooms; participant signaling; WebRTC SFU; room and meeting-token APIs; screen share; recording; transcription; dial-in/streaming; moderation; network adaptation and global media infrastructure | Integrate a calling provider or operate an SFU/TURN platform, then add server-side room/token control, participant UI, recording consent, moderation, webhooks and multi-device/network test coverage |
| MotionLab | Unreal Engine workflows | Image/video motion previsualization and storyboard | 3D scene graph; viewport/editor; asset importing; meshes; materials/shaders; lighting; cameras; skeletal animation; Control Rig; physics; Niagara/VFX; Sequencer; Blueprints/gameplay; packaging and real-time rendering | This must become a separate 3D-engine/editor product or integrate a licensed engine and GPU streaming service. It needs an asset pipeline, renderer, editor, simulation systems, project format, GPU infrastructure and extensive platform testing |

## Wilkerson-original modules

Persona Live, Browser Pilot, Voice Engine, Broadcast Studio, Skill Exchange, and Agent Core do not claim parity with a named external product. They must be judged against their own published contracts. Their present browser workflows are useful foundations, but they are not independently certified production SaaS platforms.

## What can be completed inside this repository

- Keep the governed gateway, provenance, approvals, audit trail, provider leases and kill switch.
- Implement and test provider adapters after API credentials and exact allowed operations are supplied.
- Expand Forge incrementally with project persistence, versioning, a database/auth service, build workers and deployment targets.
- Expand crawler formats and job persistence, while retaining SSRF, private-network and robots controls.
- Add a provider-backed room UI once a Daily API key and server-created meeting-token policy are configured.
- Keep MotionLab as honest previsualization, or split a true engine-backed product into its own repository.

## Inputs that Codex cannot manufacture

- Paid or authorized provider accounts, API keys, quotas and accepted provider terms.
- Production VM, GPU, SFU/TURN, proxy and regional infrastructure budgets.
- Domain, email, payment, app-store and identity-provider ownership.
- Product decisions about tenancy, retention, billing, moderation, compliance and support guarantees.
- A lawful license and distribution plan if Unreal Engine itself is embedded or streamed.

## Certification gates

A module may be labeled “parity” only after all of the following pass:

1. A traceable benchmark capability matrix has no unimplemented core customer job.
2. Every visible control completes a real operation or is clearly disabled with its dependency.
3. Fresh-account, authentication, authorization, tenant-isolation and destructive-action tests pass.
4. Persistence survives service restarts and concurrent usage.
5. Browser, mobile, accessibility, failure-recovery and load tests pass.
6. Provider-backed operations are verified against real configured accounts, not mocks.
7. Security review covers secrets, SSRF, injection, uploads, webhooks, data export/deletion and auditability.
8. The deployed production URL passes the same acceptance suite.

