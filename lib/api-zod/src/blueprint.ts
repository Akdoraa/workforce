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
  reason: z.string().optional(),
});
export type BlueprintIntegration = z.infer<typeof BlueprintIntegration>;

export const BlueprintTrigger = z.object({
  id: z.string(),
  description: z.string(),
});
export type BlueprintTrigger = z.infer<typeof BlueprintTrigger>;

export const BlueprintTool = z.object({
  id: z.string(),
  name: z.string(),
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
  system_prompt: z.string(),
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

export function emptyBlueprint(): Blueprint {
  return Blueprint.parse({
    name: "New Agent",
    system_prompt: "",
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
