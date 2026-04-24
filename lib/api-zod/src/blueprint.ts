import { z } from "zod";

export const BlueprintStatus = z.enum([
  "drafting",
  "ready",
  "deploying",
  "deployed",
]);
export type BlueprintStatus = z.infer<typeof BlueprintStatus>;

export const BlueprintIntegration = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string().optional(),
  reason: z.string().optional(),
});
export type BlueprintIntegration = z.infer<typeof BlueprintIntegration>;

export const BlueprintTrigger = z.object({
  id: z.string(),
  description: z.string(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  task: z.string().optional(),
});
export type BlueprintTrigger = z.infer<typeof BlueprintTrigger>;

export const BlueprintTool = z.object({
  id: z.string(),
  name: z.string(),
  primitive: z.string().optional(),
  description: z.string().optional(),
});
export type BlueprintTool = z.infer<typeof BlueprintTool>;

export const BlueprintCapability = z.object({
  id: z.string(),
  description: z.string(),
  proposed: z.boolean().default(false),
});
export type BlueprintCapability = z.infer<typeof BlueprintCapability>;

export const BlueprintMemory = z.object({
  enabled: z.boolean().default(false),
  description: z.string().optional(),
});
export type BlueprintMemory = z.infer<typeof BlueprintMemory>;

export const BlueprintDashboardLayout = z.object({
  sections: z.array(z.string()).default([]),
});
export type BlueprintDashboardLayout = z.infer<typeof BlueprintDashboardLayout>;

export const Blueprint = z.object({
  name: z.string(),
  role_summary: z.string().default(""),
  system_prompt: z.string(),
  soul: z.string().default(""),
  agents_md: z.string().default(""),
  watches: z.array(z.string()).default([]),
  integrations: z.array(BlueprintIntegration).default([]),
  triggers: z.array(BlueprintTrigger).default([]),
  tools: z.array(BlueprintTool).default([]),
  capabilities: z.array(BlueprintCapability).default([]),
  memory: BlueprintMemory.default({ enabled: false }),
  dashboard_layout: BlueprintDashboardLayout.default({ sections: [] }),
  status: BlueprintStatus.default("drafting"),
  deployment: z
    .object({ id: z.string(), url: z.string() })
    .nullable()
    .default(null),
  // Per-blueprint runtime safety knobs. Defaults applied by the executor
  // if absent. Both are wall-clock milliseconds.
  run_timeout_ms: z.number().int().positive().optional(),
  tool_timeout_ms: z.number().int().positive().optional(),
  agent_runtime_model: z.enum([
  "claude",
  "root",
  "gpt-4",
  "gpt-3.5-turbo",
  "groq",
]).optional().default("claude"),
});
export type Blueprint = z.infer<typeof Blueprint>;

export const BlueprintPatch = Blueprint.partial();
export type BlueprintPatch = z.infer<typeof BlueprintPatch>;

export const BuilderChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type BuilderChatMessage = z.infer<typeof BuilderChatMessage>;

export const BuilderChatRequest = z.object({
  blueprint: Blueprint,
  messages: z.array(BuilderChatMessage).min(1),
});
export type BuilderChatRequest = z.infer<typeof BuilderChatRequest>;

export const BuilderStreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal("blueprint_patch"), patch: BlueprintPatch }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type BuilderStreamEvent = z.infer<typeof BuilderStreamEvent>;

export const DeployAgentResponse = z.object({
  deployment_id: z.string(),
  url: z.string(),
});
export type DeployAgentResponse = z.infer<typeof DeployAgentResponse>;

export const ActivityEvent = z.object({
  id: z.string(),
  ts: z.number(),
  run_id: z.string().nullable().default(null),
  kind: z.enum([
    "run_start",
    "run_end",
    "thought",
    "tool_call",
    "tool_result",
    "info",
    "error",
  ]),
  text: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const RunStatus = z.enum([
  "running",
  "succeeded",
  "failed",
  "timed_out",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunTriggerSource = z.enum(["manual", "cron"]);
export type RunTriggerSource = z.infer<typeof RunTriggerSource>;

export const Run = z.object({
  id: z.string(),
  agent_id: z.string(),
  trigger_source: RunTriggerSource,
  trigger_id: z.string().nullable().default(null),
  trigger_description: z.string().nullable().default(null),
  task: z.string().default(""),
  started_at: z.number(),
  ended_at: z.number().nullable().default(null),
  status: RunStatus,
  failure_reason: z.string().nullable().default(null),
  failure_summary: z.string().nullable().default(null),
  /**
   * Set when a run aborts because a connected account couldn't authorize
   * the action (missing scope, revoked, etc.). The dashboard uses this to
   * deep-link a "Reconnect" button to the Connections screen.
   */
  failed_integration_id: z.string().nullable().default(null),
  tool_call_count: z.number().default(0),
});
export type Run = z.infer<typeof Run>;

export const DeployedAgent = z.object({
  id: z.string(),
  blueprint: Blueprint,
  created_at: z.number(),
  paused: z.boolean().default(false),
  last_run_at: z.number().nullable().default(null),
  current_run: Run.nullable().optional(),
  last_run: Run.nullable().optional(),
});
export type DeployedAgent = z.infer<typeof DeployedAgent>;

export function emptyBlueprint(): Blueprint {
  return Blueprint.parse({
    name: "New Agent",
    role_summary: "",
    system_prompt: "",
    soul: "",
    agents_md: "",
    watches: [],
    integrations: [],
    triggers: [],
    tools: [],
    capabilities: [],
    memory: { enabled: false },
    dashboard_layout: { sections: [] },
    status: "drafting",
    deployment: null,
  });
}
