# Wilkerson Sovereign Stack capability audit

Audited: 2026-08-25

This project contains original Wilkerson Collective implementations patterned after public product categories. It is not affiliated with, endorsed by, or a source-code copy of the named products.

Full feature-parity requirements and certification gates are maintained in [PARITY_ROADMAP.md](PARITY_ROADMAP.md). No module in the table below is currently certified as full parity with its benchmark.

| Wilkerson module | Public benchmark | What the benchmark does | What works here now | Parity judgment |
|---|---|---|---|---|
| Sovereign Agent Cloud | Orgo | Provisions persistent agent desktops and exposes screenshot, mouse, keyboard, shell, file, template, and lifecycle APIs | Authenticated task gateway, scoped authority, approvals, durable queue, audit, provider registry, workspace planning, and kill switch | Partial. Real computer provisioning and computer actions require configured provider credentials and enabled operations. |
| Forge AI | Base44 | Builds hosted full-stack apps with design, database, accounts, permissions, connectors, and hosting | Creates, previews, and downloads a responsive standalone HTML app. Uses the local coding model when present and a working hosted-safe template when absent | Focused equivalent only. No database, authentication, backend functions, connectors, or hosting pipeline. |
| Context Crawler / Page Extractor | Firecrawl | Scrape, crawl, map, search, and structured extraction APIs | Safe single-page extraction, metadata, links, readable text, bounded same-origin crawling, robots handling, JSON export, SSRF/private-network blocking | Working bounded subset. No broad search, map endpoint, JS browser rendering, or schema-driven multi-page extraction. |
| Wilkerson Rooms | Daily.co | Creates multi-participant video/audio rooms, tokens, embedded calls, screen sharing, and related APIs | Local camera/microphone preview plus mute/device controls in the browser | Device foundation only. It does not create a multi-user room or issue meeting tokens. |
| MotionLab | Unreal Engine workflows | Real-time 3D scenes, materials, animation, physics, VFX, rendering, and interactive applications | Local image/video preview, cinematic motion treatment, and downloadable three-scene storyboard | Previsualization only. It is not a 3D engine, renderer, simulator, or Unreal project editor. |

## Wilkerson-original modules

Persona Live, Browser Pilot, Voice Engine, Broadcast Studio, Skill Exchange, and Agent Core are presented as Wilkerson modules, not as copies of named SaaS products.

## Repairs completed in this audit

- Added the benchmark product names and parity labels to navigation, cards, and every module introduction.
- Added a Forge continuity generator so the hosted Render site produces a working downloadable page without local Ollama.
- Added WISDOM continuity responses when the local model is unavailable.
- Added browser speech fallback when hosted Linux cannot create a Windows WAV file.
- Changed the service worker and asset URLs so deployments no longer remain stuck on stale JavaScript and CSS.
- Corrected claims that implied cloud VMs, multi-user rooms, or 3D rendering were active without providers.

## Verification evidence

- Node syntax checks passed for the server and browser application.
- Automated execution/security suite: 16 passed, 0 failed.
- Browser-tested: source labels, Forge hosted fallback and download control, WISDOM continuity, public-page extraction, bounded crawl, seven-point browser QA, Windows WAV generation, broadcast drafts, skill manifest, and guarded workflow generation.
- Browser console errors during tested flows: none.
- Camera/microphone activation was not triggered during automation because browser device permission is user-controlled.

## Public documentation compared

- Orgo: https://docs.orgo.ai/introduction
- Base44: https://docs.base44.com/Getting-Started/Quick-start-guide
- Firecrawl: https://docs.firecrawl.dev/api-reference/introduction
- Daily: https://docs.daily.co/
- Unreal Engine tools: https://dev.epicgames.com/documentation/unreal-engine/tools-and-editors-in-unreal-engine
