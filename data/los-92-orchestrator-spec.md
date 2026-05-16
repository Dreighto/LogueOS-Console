# LOS-92 Orchestrator Side — `POST /api/v1/linear/file`

## Purpose

Add a new endpoint to `tools/logueos_mcp_gateway/api_v1.py` that creates a Linear ticket on behalf of the operator. The Console `/ask` dispatch flow calls this endpoint (server-side, via `serverConfig.gatewayUrl`) when the "Track in Linear" toggle is on.

---

## Endpoint spec

**Path:** `POST /api/v1/linear/file`

**Auth:** Same `is_trusted_origin` gate already used on all `/api/v1/*` routes (localhost / Tailscale CGNAT). No new auth required.

**Request body (JSON):**

```json
{
  "title":       "string — required, ticket title",
  "description": "string — required, ticket description / body (Markdown OK)",
  "team":        "string — required, Linear team name e.g. 'LogueOS'",
  "project":     "string | null — optional, Linear project name; null = no project",
  "priority":    1 | 2 | 3 | 4   // 1=Urgent 2=High 3=Medium 4=Low; default 2
}
```

**Success response (200):**

```json
{
  "ticket_id":  "LOS-123",
  "ticket_url": "https://linear.app/project-miru/issue/LOS-123/..."
}
```

**Error response (4xx/5xx):**

```json
{
  "error": "human-readable reason"
}
```

---

## Implementation notes

1. **Resolve team ID**: Use the existing Linear API client already present in `api_v1.py` (the one used by `/api/v1/dispatch` Linear enrichment). Look up `team` by name → ID. If the team name doesn't resolve, return 400 with `{"error": "Unknown team: <name>"}`.

2. **Resolve project ID** (if `project` is non-null): Similarly resolve `project` name → ID within the team. If not found, return 400 with `{"error": "Unknown project: <name>"}`.

3. **Priority mapping**: Linear's `priorityValue` field is already an integer 1–4 matching the spec. Pass through directly.

4. **Create issue**: Use `linearClient.create_issue(title, description, team_id, project_id, priority)` (or equivalent). Return the created issue's `identifier` (e.g. `LOS-123`) and `url`.

5. **No state or label required**: the newly filed ticket lands in the team's default state (Backlog). No labels. The operator or worker can update those later.

6. **No side effects to dispatch**: this endpoint only creates the ticket. The Console server then separately calls `/api/v1/dispatch` with the returned `ticket_id`. These are two discrete calls, not a combined atomic operation.

---

## Files to edit

- `tools/logueos_mcp_gateway/api_v1.py` — add the new route

No other files need changes for the Orchestrator half.

---

## Done-when

- `POST /api/v1/linear/file` with a valid body returns `{ticket_id, ticket_url}` and the ticket appears in Linear.
- Invalid team name returns 400.
- Endpoint passes the `is_trusted_origin` gate (same as all other v1 routes).
