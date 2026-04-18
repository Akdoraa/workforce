# Agent Builder

**Build a real, working AI assistant for your business in one conversation.**

Agent Builder is a guided, consultant-style platform that turns a 10-minute chat into a deployable AI assistant — one that watches your inbox, updates your CRM, runs on a schedule, and tells you what it did. No code. No prompt engineering. No glue scripts.

---

## The problem

Most "AI agents" today fail the moment they meet a real business.

- They don't know anything about *your* customers, *your* inbox, or *your* pipeline.
- They can't actually do things — they can only describe what they would do.
- The ones that *can* do things require a developer to wire them up, babysit prompts, manage tokens, and write the integration code.

The result: small business owners, ops teams, and solopreneurs hear "AI will automate your work" and then discover the only thing that actually got automated was the demo.

## The solution

Agent Builder is a single application where a non-technical user has a conversation with a senior consultant (the Builder Agent) and walks out with a live assistant.

The Builder Agent interviews the user about their workflow, proposes a concrete agent, and assembles a **Blueprint** — a typed, validated specification of the assistant. When the Blueprint is complete and the required accounts are connected, one click deploys it. From that moment on, the assistant runs on its own schedule, uses real integrations, and reports back through a live activity stream.

## How it works

The user journey is four steps, all in one screen:

1. **Interview.** The Builder Agent asks about the work that keeps falling through the cracks. It never asks the user to pick "integrations" — it asks what tools they live in.
2. **Blueprint.** As the conversation progresses, a live preview on the right fills in: the agent's name, what it watches, what it can do, when it runs, and how it sounds. Every change is a tool call from the Builder Agent.
3. **Connect.** The Blueprint declares which accounts the assistant needs (e.g. Gmail, HubSpot). The user connects them inline.
4. **Deploy and monitor.** One click ships the agent. The right panel switches from Blueprint to Dashboard: live/paused toggle, manual run, schedule, connected accounts, and a real-time activity feed of every thought, tool call, and result.

## Features today

Everything below is backed by code in this repo. Items not yet built are called out in the roadmap.

- **Builder Agent chat.** Streaming, tool-using Claude conversation with a defined voice (`SOUL.md`) and operating contract (`AGENTS.md`). The Builder cannot invent capabilities — it can only compose from the integration registry.
- **Blueprint as single source of truth.** A Zod-validated schema (`lib/api-zod/src/blueprint.ts`) covering role, watches, integrations, tools, triggers, capabilities, voice, rules, and deployment status. Patched incrementally via a discriminated stream of events.
- **Live Blueprint preview.** Right-panel UI updates as the Builder calls tools, so the user sees their agent take shape in real time.
- **Integration registry.** A typed registry of integrations and primitives the Builder can compose:
  - **Gmail** — search threads, read threads, send mail.
  - **HubSpot** — search and upsert contacts, log notes, list deals.
  - **Stripe** — list charges.
  - **Slack and Google Calendar** are in flight; Slack has server-side scaffolding (`artifacts/api-server/src/lib/slack.ts`, `routes/slack.ts`) but is not yet exposed in the registry.
- **Connections flow.** Inline account connection on the Blueprint preview, gated by the integrations the agent actually needs.
- **One-click deploy.** When the Blueprint is complete, the Deploy button appears and produces a live agent record the runtime can execute. Deploy today is internal to the running app — it does not yet publish to a separate Replit production deployment.
- **Autonomous runtime.** A scheduler ticks every 30 seconds, fires due triggers, and spawns runs (`artifacts/api-server/src/lib/runtime/scheduler.ts`). The executor (`runtime/executor.ts`) drives a Claude tool-use loop with the agent's specific toolset until the task is done.
- **Activity stream.** Server-Sent Events deliver `run_start`, `thought`, `tool_call`, `tool_result`, `run_end`, and `error` events to the dashboard live.
- **Persistent runtime state.** Deployed agents, activity logs, and scheduler last-fired times are persisted to disk (JSON and JSONL files under `.data/agents`) via `runtime/store.ts`. The Drizzle/Postgres schema in `lib/db` is scaffolded and ready for the migration to managed Postgres on the roadmap below.
- **Agent controls.** Pause, resume, and run-now from the dashboard, with delete available via the API. The store and API support multiple deployed agents per workspace; the sidebar today exposes a "New Agent" entry point, with full agent-list browsing and switching on the near-term polish list.

## Architecture at a glance

A pnpm monorepo with three artifacts and a small set of shared libraries.

- **`artifacts/agent-builder`** — React + Vite web app. Sidebar, chat area, and a right-hand panel that switches between Blueprint preview and deployed-agent dashboard.
- **`artifacts/api-server`** — Express 5 API. Hosts the Builder chat route, deploy endpoint, integration routes, scheduler, executor, and activity stream.
- **`artifacts/mockup-sandbox`** — design canvas for component iteration.
- **`lib/api-zod`** — Zod schemas for Blueprint, chat events, deployed agents, and activity events. The contract the frontend, API, and runtime all share.
- **`lib/api-spec`** — OpenAPI spec with codegen for typed React Query hooks (`lib/api-client-react`); the web app uses these alongside small custom fetch helpers for streaming paths.
- **`lib/db`** — Drizzle ORM scaffold on Replit-managed Postgres, ready for the persistence migration.
- **`lib/integrations-anthropic-ai`** — Anthropic client wired through Replit's AI Integrations proxy.

Two design patterns hold the system together:

- **Blueprint as spec.** The Builder produces it, the Deploy step consumes it, the runtime executes against it. One artifact, one schema, end-to-end.
- **Registry pattern for integrations.** Each integration is a self-contained module that declares its primitives. The Builder composes Blueprints from the registry; the executor binds the same primitives at runtime. Adding an integration is one file, not a refactor.

---

## Hackathon scoring narrative

### 1. Flawless, clean, technically impressive

- **Typed end-to-end through the API surface.** Zod schemas in `lib/api-zod` are the source of truth for every payload that crosses the wire. They feed the OpenAPI spec, which generates React Query hooks for the frontend, and they validate runtime state on read in `runtime/store.ts`. The Blueprint shape is described once.
- **Blueprint-as-spec design.** The Builder Agent doesn't generate prose that someone has to interpret — it emits structured tool calls that mutate a validated Blueprint. The Deploy button and the runtime read the same object. No translation layer, no drift.
- **Real integrations, not mocks.** Gmail, HubSpot, and Stripe are wired against their real APIs through the registry. The agent that gets deployed actually does the work.
- **Autonomous runtime.** A real scheduler, a real Claude tool-use executor, a real SSE activity stream. Deployed agents run on their own and report back live — this is not a chat demo dressed up as automation.
- **Observability built in.** Every run emits structured events (thought, tool call, tool result, error) that stream into the dashboard. Debugging a deployed agent is reading its activity feed, not reading server logs.
- **Discipline in the prompt layer.** The Builder has a written voice (`SOUL.md`) and a written operating contract (`AGENTS.md`) — a forbidden-vocabulary list, a mapping from user language to registry IDs, and explicit deploy criteria. The Builder behaves consistently because the rules are written down, not improvised per request.

### 2. Replit end-to-end workflows

- **pnpm monorepo with multiple artifacts.** Web app, API server, and design canvas live in one project, each registered as a Replit artifact with its own preview path. The workspace template's routing, codegen, and TypeScript project references are used as intended.
- **Replit-managed Postgres ready.** The `lib/db` scaffold targets Replit's built-in Postgres via Drizzle, lined up for the persistence migration.
- **Replit AI Integrations.** Anthropic access is proxied through Replit's AI Integrations layer — no API key handling, no separate billing setup.
- **Replit's integration system for third-party APIs.** Stripe and HubSpot are installed via Replit's connector system. The Builder doesn't care how credentials are obtained; it just composes the primitives the registry exposes.
- **Workflows for every artifact.** Each artifact has a managed workflow that starts on demand, so the entire stack runs from a single cold start.
- **Deployable on Replit Deployments.** The whole project is structured to ship to a Replit production environment — the monorepo, build pipeline, and managed services are already in place.

The product is not just *built on* Replit — it would be substantially harder to build anywhere else in the same time budget.

### 3. Best business model

**Target customer.** Small business owners, ops teams at 5–50-person companies, and solopreneurs running on a stack of Gmail, a CRM, Stripe, and a calendar. They feel the pain of repetitive coordination work but cannot justify a developer or a six-figure automation consulting engagement.

**The wedge.** Replace the first chunk of weekly hours an owner spends on inbox triage, CRM hygiene, and follow-ups. That is the slot a virtual assistant or junior ops hire occupies today. An assistant built in 10 minutes that does the same job for a fraction of the cost is an obvious trade.

**Pricing hypothesis.** Per-agent monthly subscription with integration tiers — a base price per deployed agent, with premium integrations (CRM, payments, scheduling) on a higher tier. Usage caps on runs per month for predictable costs. Annual pricing for SMBs that prefer one invoice.

**Why it expands.** Each new integration in the registry unlocks a new class of agents the same customer can build. The product gets more valuable as the registry grows, without the customer doing more work. Customers who deploy one agent typically discover three more they want.

**The moat.**
- **Integration registry depth.** The hard part of this category isn't the LLM — it's the long tail of well-typed, well-tested integrations. The registry pattern makes that tail straightforward to extend.
- **Blueprint as a marketable artifact.** Blueprints are portable. A future marketplace of vetted Blueprints — "the founder's inbox triage agent," "the e-commerce refund handler" — turns the platform into a network rather than a tool.
- **Consultant-quality builder.** Most no-code agent tools dump a UI on the user and call it self-service. The Builder Agent runs the discovery interview the way a senior consultant would. That is the actual unlock for non-technical buyers.

---

## Roadmap / what's next

Near-term polish and capability expansion, all already proposed as tasks in the project:

- **More integrations.** Slack and Google Calendar are next, so assistants can notify channels and schedule meetings end-to-end.
- **Real connect buttons.** Move the Gmail, Slack, and Calendar connect flows from validation gates to first-class OAuth click-throughs.
- **Connection identity and account switching.** Show the actual connected Gmail address on the Connect card; let users disconnect or switch accounts without rebuilding the agent.
- **Permission pre-flight.** Show users exactly which scopes an account is missing, and block runs that would fail before they start.
- **Calendar event lifecycle.** Let assistants update and cancel events they created, not just create them.
- **Richer Slack output.** Blocks and attachments, not just plain text.
- **Runtime hardening.** Concurrency locks, timeouts, structured failure surfacing in the activity log, log rotation, atomic writes, input validation, redaction.
- **Demo UX polish.** Drop slugs from the UI, surface stream state clearly, group runs in the activity log, and mark untrusted external content to defend against prompt injection.
- **Persistence migration.** Move runtime state from the file-backed store in `.data/agents` to the Drizzle/Postgres schema in `lib/db`, and surface a richer multi-agent sidebar on top of it.
- **Production deploy pipeline.** Wire the in-app Deploy action to a Replit Deployments-backed publish step so agents run in a separate production environment rather than alongside the builder.

The platform is already complete enough to build, run, and observe real assistants today. The roadmap is about hardening the surface and matching it to the substance underneath.
