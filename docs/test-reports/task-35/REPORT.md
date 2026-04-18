# Task #35 — Deploy Flow End-to-End Test Report

**Date:** 2026-04-18
**App under test:** Workforce (`artifacts/agent-builder`) + API Server (`artifacts/api-server`)
**Test runner:** Playwright-based testing subagent invoked via the testing skill (`runTest`).
**Code changes:** None — this task is pure validation. All code paths exercised are already on disk.

---

## Environment snapshot

`GET /api/connections` at the start of the test run:

| Integration | connected | needs_reauthorization | Notes |
| --- | --- | --- | --- |
| gmail | true | **true** | Missing scopes: `gmail.readonly`, `gmail.send` |
| hubspot | true | false | (briefly returned 429 once during warm-up) |
| stripe | true | false | |
| slack | — | — | **Not in the integration registry at all** (only gmail/hubspot/stripe registered in `artifacts/api-server/src/lib/registry/`). |

---

## Scenario A — Suggested prompt (Gmail + Slack, weekday 9am)

**Prompt sent verbatim:**

> "Every weekday at 9am, scan my Gmail inbox for new customer support emails from the last 24 hours, summarize them, and post the summary to my Slack #support channel."

| Checkpoint | Result | Notes |
| --- | --- | --- |
| (a) Blueprint streamed and finalized | ✅ PASS | Finalized blueprint named "Support Inbox Digest" with sections *What I'll watch*, *What I'll do*, *When I'll do it*, *Accounts I need access to*, *How I'll sound*. |
| (b) Required integrations correctly listed | ⚠️ PARTIAL | Blueprint listed **Gmail only**. Slack was silently dropped from the workflow because it is not in the registry. The chat never told the user. |
| (c) Trigger / schedule | ✅ PASS | "Every weekday at 09:00 UTC" rendered as expected. |
| (d) Launch button gating | ✅ PASS | Button stayed disabled and read **"Connect every account to launch"** because Gmail required reauthorization. The test correctly stopped here without faking a connected state. |
| (e) Launch / Deployed dashboard / Run-now | ⏸️ N/A | Not exercised in this scenario — gating was working as designed. Verified separately in Scenario B. |

**Subagent reference:** `8b6bdb74-03c2-47f5-8ef6-965f71e73a0a`

---

## Scenario B — Stripe + HubSpot prompt (both connected)

Run because Scenario A's gating was correct but did not exercise the post-Launch path. Picked integrations that were both fully connected so we could actually push through to deploy + Run-now.

**Prompt sent verbatim:**

> "Every weekday at 9am, pull yesterday's successful Stripe charges, and for each customer email that isn't already a HubSpot contact, create a new HubSpot contact with their email and total spend. Email me a summary at the end is NOT needed — just keep it to Stripe and HubSpot."

| Checkpoint | Result | Notes |
| --- | --- | --- |
| (a) Blueprint streamed and finalized | ✅ PASS | Blueprint reached `ready` with Stripe + HubSpot listed under "Accounts I need access to". |
| (b) Required integrations correctly listed | ✅ PASS | Both Stripe and HubSpot. Both showed Connected in the ConnectCard. |
| (c) Launch button enabled | ✅ PASS | Button text "Launch assistant", enabled. |
| (d) Deploy POST succeeded | ✅ PASS | `POST /api/agents/:id/deploy` → 200; right pane swapped to deployed dashboard. Deployed agent id: **`ec5c8fd5-596e-4500-9ba9-08d14a4a9708`**. |
| (e) Deployed dashboard rendered | ✅ PASS | Dashboard shows agent header, schedule, Run-now button, Activity stream. See screenshot `screenshots/scenario-b-deployed.jpeg`. |
| (f) Live activity SSE stream connected | ✅ PASS | `GET /api/agents/:id/activity/stream` opened cleanly. No SSE errors in browser console. (`request aborted` line in API log corresponds to the test navigating away — not an error.) |
| (g) Run-now produced events / successful run | ❌ **FAIL** | Run was created (`60b336c7-446f-41fc-9f14-5d6f4b8ab851`) but failed almost instantly. Activity stream: "List charges…" then "Didn't finish". `/api/agents/:id/runs` shows status=`failed`. API log: `[runtime] run 60b336c7-... failed: Stripe connection not found`. |

**Subagent reference:** `a6b8bd42-ae3e-4d0d-9184-ebc54dac06dc`
**Screenshot:** `screenshots/scenario-b-deployed.jpeg`

---

## Console / API errors observed

**Browser console (during builder pane while api-server was warming up):**

```
[unhandledrejection] SyntaxError: Unexpected end of JSON input
  at fetchConnections (artifacts/agent-builder/src/lib/agent-api.ts:26:27)
  at refresh (artifacts/agent-builder/src/components/BlueprintPreview.tsx:42:17)
```

This already has a tracked task ("Stop the connections check from crashing the builder pane") in the project task list — not duplicated.

**API server (during Scenario B Run-now):**

```
[runtime] run 60b336c7-446f-41fc-9f14-5d6f4b8ab851 failed: Stripe connection not found
```

---

## Defect log

| # | Severity | Defect | Filed as |
| --- | --- | --- | --- |
| D1 | High | Run-now fails immediately with "Stripe connection not found" even though `/api/connections` reports stripe as connected. The runtime connector resolution disagrees with the connections endpoint. Reproduces 100% on a fresh deploy. | Follow-up #36 |
| D2 | Medium | Builder silently drops integrations that are not in the registry (e.g. Slack), re-scoping the workflow without telling the user in chat. The user sees a finalized blueprint that quietly does something different from what they asked for. | Follow-up #37 |
| D3 | Low | `fetchConnections` throws "Unexpected end of JSON input" on transient empty responses, surfacing as an unhandled rejection in the browser console. | Already covered by existing inbox task "Stop the connections check from crashing the builder pane" — not re-filed. |

---

## Overall verdict

The deploy *plumbing* (blueprint → readiness gating → deploy POST → dashboard swap → SSE activity stream) works end-to-end and is safe from a UX perspective: launch is correctly blocked when integrations aren't truly connectable. The deploy flow is **partially shippable**: a user can finalize, launch, and reach a deployed dashboard, but Run-now will not actually succeed for any Stripe-using agent until D1 is fixed, and Slack-mentioning prompts will quietly mislead users until D2 is addressed.
