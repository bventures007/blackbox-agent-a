import { z } from "zod";
import { ProviderError, providerRequest } from "./transport.js";
export const shopifyCredentials = z
  .object({
    shop: z.string().max(100),
    auth: z.enum(["access_token", "client_credentials"]),
    access_token: z.string().min(8).max(4096).optional(),
    client_id: z.string().min(8).max(256).optional(),
    client_secret: z.string().min(8).max(4096).optional(),
    expires_at: z.iso.datetime({ offset: true }).optional(),
    fixture: z.boolean().default(false),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      (c.auth === "access_token" && !c.access_token) ||
      (c.auth === "client_credentials" && (!c.client_id || !c.client_secret))
    )
      ctx.addIssue({ code: "custom", message: "credential_fields_required" });
  });
export type ShopifyCredentials = z.infer<typeof shopifyCredentials>;
export const revision = "2026-10";
function base(c: ShopifyCredentials) {
  if (c.fixture) {
    if (
      process.env.ALLOW_SYNTHETIC_FIXTURE !== "1" ||
      c.shop !== process.env.FIXTURE_HOST
    )
      throw new ProviderError("fixture_unavailable");
    return `http://${c.shop}`;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(c.shop))
    throw new ProviderError("invalid_shop");
  return `https://${c.shop}`;
}
export async function authorizeShopify(input: unknown, signal?: AbortSignal) {
  const credentials = shopifyCredentials.parse(input),
    endpoint = base(credentials);
  if (
    credentials.auth === "client_credentials" &&
    (!credentials.access_token ||
      !credentials.expires_at ||
      Date.parse(credentials.expires_at) < Date.now() + 60000)
  ) {
    const result = await providerRequest(
      endpoint + "/admin/oauth/access_token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: credentials.client_id!,
          client_secret: credentials.client_secret!,
        }),
      },
      signal,
    );
    const token = z
      .object({
        access_token: z.string().min(8).max(4096),
        expires_in: z.number().int().positive().max(604800),
      })
      .parse(result);
    credentials.access_token = token.access_token;
    credentials.expires_at = new Date(
      Date.now() + token.expires_in * 1000,
    ).toISOString();
  }
  return credentials;
}
export async function shopifyGraphql(
  c: ShopifyCredentials,
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
) {
  const result = await providerRequest(
    base(c) + `/admin/api/${revision}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": c.access_token!,
      },
      body: JSON.stringify({ query, variables }),
    },
    signal,
  );
  if (result.errors?.some((e: any) => e.extensions?.code === "THROTTLED")) {
    const cost = result.extensions?.cost;
    const available = Number(cost?.throttleStatus?.currentlyAvailable),
      rate = Number(cost?.throttleStatus?.restoreRate),
      requested = Number(cost?.requestedQueryCost);
    throw new ProviderError(
      "provider_rate_limited",
      Number.isFinite(rate) &&
        rate > 0 &&
        Number.isFinite(requested) &&
        Number.isFinite(available)
        ? Math.max(1000, Math.ceil(((requested - available) / rate) * 1000))
        : 60000,
    );
  }
  if (result.errors?.some((e: any) => e.extensions?.code === "ACCESS_DENIED"))
    throw new ProviderError("provider_scope_missing", 0, true);
  if (result.errors?.length || !result.data)
    throw new ProviderError("provider_query_incomplete");
  return result.data;
}
export const identityQuery =
  "query BlackboxIdentity { shop { id ianaTimezone } currentAppInstallation { accessScopes { handle } } }";
export function requireCapabilityScopes(scopes: string[], capability: string) {
  if (
    capability === "stock" &&
    !scopes.some((s) => ["read_inventory", "write_inventory"].includes(s))
  )
    throw new ProviderError("provider_read_inventory_required", 0, true);
}
export async function validateShopify(input: unknown, signal?: AbortSignal) {
  const credentials = await authorizeShopify(input, signal),
    data = await shopifyGraphql(credentials, identityQuery, {}, signal);
  const identity = z
    .object({
      shop: z.object({
        id: z.string().regex(/^gid:\/\/shopify\/Shop\/\d+$/),
        ianaTimezone: z.string(),
      }),
      currentAppInstallation: z.object({
        accessScopes: z
          .array(z.object({ handle: z.string().regex(/^[a-z_]+$/) }))
          .max(200),
      }),
    })
    .parse(data);
  const scopes = identity.currentAppInstallation.accessScopes.map(
    (s) => s.handle,
  );
  if (!scopes.includes("read_orders") && !scopes.includes("write_orders"))
    throw new ProviderError("provider_read_orders_required", 0, true);
  return {
    credentials,
    account_id: identity.shop.id,
    timezone: identity.shop.ianaTimezone,
    scopes,
  };
}
