import { connectorFetch } from "../connectors";
import { wrapExternalContent } from "./external";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

function wrapMaybe(source: string, value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return value ?? null;
  return wrapExternalContent(source, value);
}

export const HUBSPOT_INTEGRATION: IntegrationDefinition = {
  id: "hubspot",
  connector_name: "hubspot",
  name: "HubSpot",
  label: "your customer list",
  description: "Manage contacts, companies, and deals in your CRM.",
  brand_color: "#ff7a59",
};

async function hubspotRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await connectorFetch("hubspot", path, {
    method: init.method,
    body: init.body,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface HubspotContact {
  id: string;
  properties: Record<string, string | null>;
}

export const HUBSPOT_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "hubspot_search_contacts",
    integration_id: "hubspot",
    label: "Search contacts",
    description:
      "Search HubSpot contacts. Optionally filter by stage and last activity date.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search." },
        lifecycle_stage: { type: "string" },
        last_activity_before: {
          type: "string",
          description:
            "ISO timestamp; returns contacts whose last activity was before this.",
        },
        limit: { type: "number", default: 25 },
      },
    },
    async handler(input, ctx) {
      const limit = Math.min(Number(input["limit"] ?? 25), 100);
      const query = input["query"] ? String(input["query"]) : undefined;
      const stage = input["lifecycle_stage"]
        ? String(input["lifecycle_stage"])
        : undefined;
      const lastBefore = input["last_activity_before"]
        ? String(input["last_activity_before"])
        : undefined;

      const filters: unknown[] = [];
      if (stage)
        filters.push({
          propertyName: "lifecyclestage",
          operator: "EQ",
          value: stage,
        });
      if (lastBefore)
        filters.push({
          propertyName: "notes_last_updated",
          operator: "LT",
          value: new Date(lastBefore).getTime().toString(),
        });

      const body: Record<string, unknown> = {
        limit,
        properties: [
          "email",
          "firstname",
          "lastname",
          "company",
          "lifecyclestage",
          "notes_last_updated",
          "hs_lead_status",
        ],
      };
      if (query) body["query"] = query;
      if (filters.length > 0) body["filterGroups"] = [{ filters }];

      const data = await hubspotRequest<{ results: HubspotContact[] }>(
        `/crm/v3/objects/contacts/search`,
        { method: "POST", body: JSON.stringify(body) },
      );
      const contacts = data.results.map((c) => ({
        id: c.id,
        email: wrapMaybe("hubspot contact email", c.properties["email"]),
        name: wrapMaybe(
          "hubspot contact name",
          [c.properties["firstname"], c.properties["lastname"]]
            .filter(Boolean)
            .join(" ") || null,
        ),
        company: wrapMaybe("hubspot contact company", c.properties["company"]),
        stage: c.properties["lifecyclestage"],
        lead_status: c.properties["hs_lead_status"],
        last_activity: c.properties["notes_last_updated"],
      }));
      ctx.log(`Searched your customer list — ${contacts.length} found.`);
      return {
        summary: `Found ${contacts.length} contacts in your customer list.`,
        data: contacts,
      };
    },
  },
  {
    name: "hubspot_upsert_contact",
    integration_id: "hubspot",
    label: "Add or update a contact",
    description:
      "Create or update a HubSpot contact identified by email. Provide any of: email, firstname, lastname, company, lifecyclestage, hs_lead_status.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string" },
        firstname: { type: "string" },
        lastname: { type: "string" },
        company: { type: "string" },
        lifecyclestage: { type: "string" },
        hs_lead_status: { type: "string" },
      },
      required: ["email"],
    },
    async handler(input, ctx) {
      const email = String(input["email"] ?? "").trim();
      if (!email) throw new Error("email required");
      const properties: Record<string, string> = { email };
      for (const k of [
        "firstname",
        "lastname",
        "company",
        "lifecyclestage",
        "hs_lead_status",
      ]) {
        if (input[k]) properties[k] = String(input[k]);
      }

      // Try search first.
      const search = await hubspotRequest<{ results: HubspotContact[] }>(
        `/crm/v3/objects/contacts/search`,
        {
          method: "POST",
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  { propertyName: "email", operator: "EQ", value: email },
                ],
              },
            ],
            limit: 1,
          }),
        },
      );
      const existing = search.results[0];
      let result: HubspotContact;
      let action: "created" | "updated";
      if (existing) {
        result = await hubspotRequest<HubspotContact>(
          `/crm/v3/objects/contacts/${existing.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ properties }),
          },
        );
        action = "updated";
      } else {
        result = await hubspotRequest<HubspotContact>(
          `/crm/v3/objects/contacts`,
          {
            method: "POST",
            body: JSON.stringify({ properties }),
          },
        );
        action = "created";
      }
      const display =
        properties["firstname"] || properties["company"] || email;
      ctx.log(
        `${action === "created" ? "Added" : "Updated"} ${display} in your customer list.`,
      );
      return {
        summary: `${action === "created" ? "Created" : "Updated"} contact ${display}.`,
        data: { id: result.id, action, email },
      };
    },
  },
  {
    name: "hubspot_log_note",
    integration_id: "hubspot",
    label: "Log a note on a contact",
    description:
      "Attach a note (an interaction record) to a HubSpot contact, identified by email or contact ID.",
    input_schema: {
      type: "object",
      properties: {
        contact_email: { type: "string" },
        contact_id: { type: "string" },
        body: { type: "string" },
      },
      required: ["body"],
    },
    async handler(input, ctx) {
      const body = String(input["body"] ?? "");
      let contactId = input["contact_id"]
        ? String(input["contact_id"])
        : undefined;
      const email = input["contact_email"]
        ? String(input["contact_email"])
        : undefined;
      if (!contactId && email) {
        const search = await hubspotRequest<{ results: HubspotContact[] }>(
          `/crm/v3/objects/contacts/search`,
          {
            method: "POST",
            body: JSON.stringify({
              filterGroups: [
                {
                  filters: [
                    { propertyName: "email", operator: "EQ", value: email },
                  ],
                },
              ],
              limit: 1,
            }),
          },
        );
        contactId = search.results[0]?.id;
      }
      if (!contactId)
        throw new Error("contact_id or contact_email (must exist) required");

      const note = await hubspotRequest<{ id: string }>(
        `/crm/v3/objects/notes`,
        {
          method: "POST",
          body: JSON.stringify({
            properties: {
              hs_note_body: body,
              hs_timestamp: Date.now().toString(),
            },
            associations: [
              {
                to: { id: contactId },
                types: [
                  {
                    associationCategory: "HUBSPOT_DEFINED",
                    associationTypeId: 202,
                  },
                ],
              },
            ],
          }),
        },
      );
      ctx.log(`Logged a note on contact ${email ?? contactId}.`);
      return {
        summary: `Logged interaction note on ${email ?? contactId}.`,
        data: { note_id: note.id, contact_id: contactId },
      };
    },
  },
  {
    name: "hubspot_list_deals",
    integration_id: "hubspot",
    label: "List deals",
    description: "List deals in the HubSpot pipeline. Optional stage filter.",
    input_schema: {
      type: "object",
      properties: {
        stage: { type: "string" },
        limit: { type: "number", default: 25 },
      },
    },
    async handler(input, ctx) {
      const limit = Math.min(Number(input["limit"] ?? 25), 100);
      const stage = input["stage"] ? String(input["stage"]) : undefined;
      let url = `/crm/v3/objects/deals?limit=${limit}&properties=dealname,amount,dealstage,closedate,pipeline,hs_lastmodifieddate`;
      let data: { results: Array<{ id: string; properties: Record<string, string | null> }> };
      if (stage) {
        data = await hubspotRequest(`/crm/v3/objects/deals/search`, {
          method: "POST",
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  { propertyName: "dealstage", operator: "EQ", value: stage },
                ],
              },
            ],
            properties: [
              "dealname",
              "amount",
              "dealstage",
              "closedate",
              "pipeline",
              "hs_lastmodifieddate",
            ],
            limit,
          }),
        });
      } else {
        data = await hubspotRequest(url);
      }
      const deals = data.results.map((d) => ({
        id: d.id,
        name: wrapMaybe("hubspot deal name", d.properties["dealname"]),
        amount: d.properties["amount"],
        stage: d.properties["dealstage"],
        close_date: d.properties["closedate"],
        last_modified: d.properties["hs_lastmodifieddate"],
      }));
      ctx.log(`Pulled ${deals.length} deals from your pipeline.`);
      return {
        summary: `Pulled ${deals.length} deals from your pipeline.`,
        data: deals,
      };
    },
  },
];
