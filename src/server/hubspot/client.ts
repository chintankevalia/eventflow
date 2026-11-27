import "server-only";

export type HubSpotCompany = {
  id: string;
  properties: {
    name?: string;
    website?: string;
    city?: string;
    hs_object_id?: string;
    [key: string]: string | undefined;
  };
};

export type HubSpotContact = {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    jobtitle?: string;
    associatedcompanyid?: string;
    [key: string]: string | undefined;
  };
};

export type HubSpotEngagement = {
  id?: string;
  engagement: {
    type: "NOTE" | "MEETING";
    timestamp: number;
  };
  metadata: {
    body?: string;
    title?: string;
    startTime?: number;
    endTime?: number;
  };
  associations: {
    companyIds?: string[];
    contactIds?: string[];
  };
};

const BASE = "https://api.hubapi.com";

async function hs<T>(token: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Companies ─────────────────────────────────────────────────────────────────

export async function listCompanies(token: string, after?: string): Promise<{
  results: HubSpotCompany[];
  paging?: { next?: { after: string } };
}> {
  const params = new URLSearchParams({
    limit: "100",
    properties: "name,website,city",
    ...(after ? { after } : {}),
  });
  return hs(token, `/crm/v3/objects/companies?${params}`);
}

export async function getCompany(token: string, id: string): Promise<HubSpotCompany> {
  return hs(token, `/crm/v3/objects/companies/${id}?properties=name,website,city`);
}

export async function createCompany(token: string, props: Record<string, string>): Promise<HubSpotCompany> {
  return hs(token, "/crm/v3/objects/companies", {
    method: "POST",
    body: JSON.stringify({ properties: props }),
  });
}

export async function updateCompany(token: string, id: string, props: Record<string, string>): Promise<HubSpotCompany> {
  return hs(token, `/crm/v3/objects/companies/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: props }),
  });
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export async function listContacts(token: string, after?: string): Promise<{
  results: HubSpotContact[];
  paging?: { next?: { after: string } };
}> {
  const params = new URLSearchParams({
    limit: "100",
    properties: "firstname,lastname,email,phone,jobtitle,associatedcompanyid",
    ...(after ? { after } : {}),
  });
  return hs(token, `/crm/v3/objects/contacts?${params}`);
}

export async function createContact(token: string, props: Record<string, string>): Promise<HubSpotContact> {
  return hs(token, "/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties: props }),
  });
}

export async function updateContact(token: string, id: string, props: Record<string, string>): Promise<HubSpotContact> {
  return hs(token, `/crm/v3/objects/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: props }),
  });
}

// ── Engagements ───────────────────────────────────────────────────────────────

export async function createEngagement(token: string, engagement: HubSpotEngagement): Promise<{ engagementId: number }> {
  return hs(token, "/engagements/v1/engagements", {
    method: "POST",
    body: JSON.stringify(engagement),
  });
}

// ── Token verification ────────────────────────────────────────────────────────

/**
 * Verify a private app token by calling the HubSpot account-info endpoint.
 * Returns the portal ID. Throws if the token is invalid.
 */
export async function getTokenInfo(token: string): Promise<{ hub_id: number }> {
  // Private app tokens don't support /oauth/v1/access-tokens.
  // Use /account-info/v3/details which requires a valid token.
  const info = await hs<{ portalId: number }>(token, "/account-info/v3/details");
  return { hub_id: info.portalId };
}
