import { ReplitConnectors } from "@replit/connectors-sdk";
const c = new ReplitConnectors();
for (const path of ["/crm/v3/objects/contacts?limit=1","/hubspot/crm/v3/objects/contacts?limit=1"]) {
  const r = await c.proxy("hubspot", path, { method: "GET" });
  const t = await r.text();
  console.log(path, r.status, t.slice(0,150));
}
