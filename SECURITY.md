# Wilkerson Sovereign Concierge security model

## Fundamental rule

External content may inform a task. It may never authorize a task.

Executable authority exists only when the server validates the Gateway Bearer credential and mints an internal, sealed command context. A client-supplied object cannot imitate that seal. REST, MCP, approval, cancellation, provider-probe, and worker paths share the same authority check.

## Provenance contract

Every task stores:

- `taskId`
- `classification`: `trusted_command` or `trusted_system`
- authenticated Concierge/Gateway channel
- requesting principal and agent ID
- transport
- exact provider and operation scope
- command timestamp
- policy decision and policy version

Workers verify the provenance, task ID, provider scope, operation scope, kill-switch state, provider configuration, and approval state before acquiring or using a provider lease.

## Untrusted observations

Task fields named for external or retrieved sources are removed from executable input and retained as labeled observation records. Detected instructions are represented by indicator names only in audit events. Secret-like values are redacted before persistence, task results, artifacts, provider details, audit data, or HTTP responses.

Potentially relevant actions found in observations are never executed. They remain observations for a later authenticated planner command.

## Provider and network isolation

Each provider adapter receives only its declared credential keys and the server-owned network policy. Provider requests must use an approved hostname, HTTPS unless separately authorized, public DNS resolution unless an exact private destination is server-authorized, no URL credentials, no cloud metadata target, no cross-destination redirect, and a bounded timeout.

`WILKERSON_AGENT_TOKENS_JSON` can define separate agent tokens with immutable scope lists. A scoped agent cannot expand its own task scope, impersonate the founder Gateway credential, probe another provider, decide approvals, cancel tasks, or call a Concierge operation unless its server-owned scope permits that action.

Browser/computer execution policy requires ephemeral sessions, restricted filesystem access, destination-allowlisted networking, and download quarantine. Providers without a real compliant execution implementation continue to reject non-probe operations.

## Attachment policy

Executable, script, installer, shortcut, disk-image, Java archive, and macro-enabled Office formats are blocked. Archives are quarantined. Other attachments remain unopened with `scan_before_open` disposition. Task content cannot override this policy.

## Kill switch

Injection and malware indicators add weighted signals to a persistent time window. At `INJECTION_KILL_THRESHOLD` (default `6` within `INJECTION_WINDOW_SECONDS`, default `600`), the Concierge security kill switch activates, all queued/approval-held/running tasks are cancelled, new submissions are rejected, and the activation is audited.

## Verification

`npm test` covers:

- rejection of forged provenance
- hostile webpage, email, and document instructions
- prevention of task/provider/operation redirection
- preservation of consequential-action approval
- credential redaction
- executable and macro attachment blocking
- repeated-indicator kill-switch activation
- localhost, metadata, private-network, HTTP, and unapproved-destination blocking
- observation-only model delimiters
