---
summary: "Removal decision for the retired Discord webhook integration."
read_when:
  - Reviewing removed integrations or deployment environment variables
---

# Discord webhook removal

ClawHub does not use Discord notifications. The outbound Discord webhook
integration was removed from the Convex backend, including publish/highlight
scheduling, payload construction, and its tests.

## Invariants

- Do not configure `DISCORD_WEBHOOK_URL` or
  `DISCORD_WEBHOOK_HIGHLIGHTED_ONLY` in any ClawHub deployment.
- Skill publishing and highlighting must not schedule Discord network requests.
- `SITE_URL` remains a normal application/auth setting; it is no longer read by
  webhook code.
- Reintroducing an outbound notification integration requires a new design
  decision covering destination, event ownership, retries, failure isolation,
  secret storage, and observability. Do not restore the former Discord code by
  default.
