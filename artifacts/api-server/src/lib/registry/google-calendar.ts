import { connectorFetch } from "../connectors";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const GOOGLE_CALENDAR_INTEGRATION: IntegrationDefinition = {
  id: "google_calendar",
  connector_name: "google-calendar",
  name: "Google Calendar",
  label: "your calendar",
  description:
    "List upcoming events and create new events on your Google Calendar.",
  brand_color: "#4285f4",
};

async function calendarRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await connectorFetch("google-calendar", path, {
    method: init.method,
    body: init.body,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Calendar ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface CalendarEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: CalendarEventTime;
  end?: CalendarEventTime;
  attendees?: Array<{ email: string; responseStatus?: string }>;
  organizer?: { email?: string };
}

function toRfc3339(value: string): string {
  // Accept ISO date or full datetime; rely on Date parsing.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date/time: ${value}`);
  }
  return d.toISOString();
}

export const GOOGLE_CALENDAR_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "calendar_list_events",
    integration_id: "google_calendar",
    label: "List upcoming events",
    description:
      "List events from a Google Calendar within an optional time window. Defaults to the next 7 days on the primary calendar.",
    input_schema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description: "Calendar ID; defaults to 'primary'.",
        },
        time_min: {
          type: "string",
          description: "ISO timestamp; defaults to now.",
        },
        time_max: {
          type: "string",
          description: "ISO timestamp; defaults to now + 7 days.",
        },
        max_results: { type: "number", default: 25 },
        query: {
          type: "string",
          description: "Free-text search filter.",
        },
      },
    },
    async handler(input, ctx) {
      const calId = String(input["calendar_id"] ?? "primary");
      const max = Math.min(Number(input["max_results"] ?? 25), 100);
      const now = new Date();
      const defaultMax = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
      const timeMin = input["time_min"]
        ? toRfc3339(String(input["time_min"]))
        : now.toISOString();
      const timeMax = input["time_max"]
        ? toRfc3339(String(input["time_max"]))
        : defaultMax.toISOString();
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        maxResults: String(max),
        singleEvents: "true",
        orderBy: "startTime",
      });
      if (input["query"]) params.set("q", String(input["query"]));
      const data = await calendarRequest<{ items?: CalendarEvent[] }>(
        `/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
      );
      const events = (data.items ?? []).map((e) => ({
        id: e.id,
        summary: e.summary ?? "(no title)",
        description: e.description ?? "",
        location: e.location ?? "",
        start: e.start?.dateTime ?? e.start?.date ?? null,
        end: e.end?.dateTime ?? e.end?.date ?? null,
        attendees: (e.attendees ?? []).map((a) => a.email),
        link: e.htmlLink ?? null,
      }));
      ctx.log(`Read ${events.length} events from your calendar.`);
      return {
        summary: `Found ${events.length} events between ${timeMin} and ${timeMax}.`,
        data: events,
      };
    },
  },
  {
    name: "calendar_create_event",
    integration_id: "google_calendar",
    label: "Create a calendar event",
    description:
      "Create an event on a Google Calendar. Provide start and end as ISO timestamps; optionally include attendees (comma-separated emails).",
    input_schema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description: "Calendar ID; defaults to 'primary'.",
        },
        summary: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        start: {
          type: "string",
          description: "ISO timestamp for the event start.",
        },
        end: {
          type: "string",
          description:
            "ISO timestamp for the event end. If omitted, defaults to 30 minutes after start.",
        },
        attendees: {
          type: "string",
          description: "Comma-separated email addresses to invite.",
        },
        time_zone: {
          type: "string",
          description: "IANA time zone (e.g. 'America/Los_Angeles').",
        },
        send_updates: {
          type: "string",
          description: "'all', 'externalOnly', or 'none'. Defaults to 'none'.",
        },
      },
      required: ["summary", "start"],
    },
    async handler(input, ctx) {
      const calId = String(input["calendar_id"] ?? "primary");
      const summary = String(input["summary"] ?? "").trim();
      if (!summary) throw new Error("summary required");
      const startIso = toRfc3339(String(input["start"]));
      const endIso = input["end"]
        ? toRfc3339(String(input["end"]))
        : new Date(new Date(startIso).getTime() + 30 * 60_000).toISOString();
      const tz = input["time_zone"] ? String(input["time_zone"]) : undefined;
      const attendeesRaw = input["attendees"]
        ? String(input["attendees"])
        : "";
      const attendees = attendeesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((email) => ({ email }));
      const sendUpdates = input["send_updates"]
        ? String(input["send_updates"])
        : "none";

      const body: Record<string, unknown> = {
        summary,
        start: tz ? { dateTime: startIso, timeZone: tz } : { dateTime: startIso },
        end: tz ? { dateTime: endIso, timeZone: tz } : { dateTime: endIso },
      };
      if (input["description"]) body["description"] = String(input["description"]);
      if (input["location"]) body["location"] = String(input["location"]);
      if (attendees.length > 0) body["attendees"] = attendees;

      const params = new URLSearchParams({ sendUpdates });
      const created = await calendarRequest<CalendarEvent>(
        `/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      ctx.log(`Created calendar event "${summary}" at ${startIso}.`);
      return {
        summary: `Created event "${summary}" at ${startIso}.`,
        data: {
          id: created.id,
          link: created.htmlLink ?? null,
          start: created.start?.dateTime ?? created.start?.date ?? startIso,
          end: created.end?.dateTime ?? created.end?.date ?? endIso,
        },
      };
    },
  },
];
