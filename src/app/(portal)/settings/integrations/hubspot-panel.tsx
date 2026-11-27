"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import type { HubSpotConfigRow } from "@/server/hubspot/config";

type SyncSummary = {
  companiesUpserted: number;
  contactsUpserted: number;
  engagementsPushed: number;
  errors: string[];
};

export function HubSpotPanel({ initialConfig }: { initialConfig: HubSpotConfigRow }) {
  const [config, setConfig] = useState(initialConfig);
  const [token, setToken] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/hubspot/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Connection failed.");
      setToken("");
      const updated = await fetch("/api/hubspot/config").then((r) => r.json());
      setConfig(updated);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    // The confirmation is the `ConfirmDialog` around the button, not a
    // `window.confirm` — a browser alert can't say this in the app's own voice,
    // and it looks like a scam popup on top of a company portal.
    setDisconnecting(true);
    try {
      await fetch("/api/hubspot/disconnect", { method: "POST" });
      const updated = await fetch("/api/hubspot/config").then((r) => r.json());
      setConfig(updated);
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleToggle(field: "enabled" | "createOnInbound" | "pushEngagements", value: boolean) {
    const res = await fetch("/api/hubspot/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const updated = await res.json();
    setConfig(updated);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/hubspot/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed.");
      setSyncResult(data as SyncSummary);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="rounded-lg border">
      {/* Header */}
      <div className="flex items-center gap-4 border-b p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#FF7A59]/10">
          {/* HubSpot sprocket icon (simplified) */}
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#FF7A59]" xmlns="http://www.w3.org/2000/svg">
            <path d="M16.5 8.25V6.375A1.875 1.875 0 0 0 14.625 4.5h-.375v-.75a.75.75 0 0 0-1.5 0v.75H12a1.875 1.875 0 0 0-1.875 1.875V8.25A4.5 4.5 0 1 0 16.5 8.25ZM12 15.75a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-semibold">HubSpot</p>
          <p className="text-xs text-muted-foreground">Two-way sync: companies and contacts inbound; event engagements outbound.</p>
        </div>
        <StatusChip connected={config.hasToken} enabled={config.enabled} />
      </div>

      <div className="divide-y">
        {/* Connect / Disconnect */}
        <section className="p-5 space-y-3">
          <h3 className="text-sm font-medium">Connection</h3>
          {config.hasToken ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Connected to HubSpot portal <strong>{config.portalId}</strong>.
                {config.lastSyncAt && (
                  <> Last synced {new Date(config.lastSyncAt).toLocaleString()}.</>
                )}
              </p>
              {/*
                Disconnecting discards the stored token for the whole company,
                and getting it back means someone with HubSpot admin rights
                issuing a new Private App token. That is not an undo, so it
                asks first — the same `ConfirmDialog` the destructive actions
                on events use.
              */}
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10">
                    {disconnecting ? "Disconnecting…" : "Disconnect"}
                  </Button>
                }
                title="Disconnect HubSpot?"
                description="The stored token is deleted and syncing stops for everyone. Records already synced keep their HubSpot links. Reconnecting needs a new Private App token from HubSpot."
                confirmLabel="Disconnect"
                confirmVariant="destructive"
                onConfirm={handleDisconnect}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Enter a HubSpot Private App token with <code className="text-xs">crm.objects.companies.read/write</code> and <code className="text-xs">crm.objects.contacts.read/write</code> scopes.
              </p>
              <div className="flex gap-2">
                <Input
                  id="hubspot-token"
                  type="password"
                  aria-label="HubSpot Private App token"
                  placeholder="pat-na1-…"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="flex-1 font-mono"
                />
                <Button onClick={handleConnect} disabled={!token || connecting}>
                  {connecting ? "Verifying…" : "Connect"}
                </Button>
              </div>
              {connectError && <p className="text-sm text-destructive">{connectError}</p>}
            </div>
          )}
        </section>

        {/* Settings (only shown when connected) */}
        {config.hasToken && (
          <>
            <section className="p-5 space-y-3">
              <h3 className="text-sm font-medium">Sync settings</h3>
              <Toggle
                label="Integration enabled"
                description="Pausing disables all sync without removing credentials."
                checked={config.enabled}
                onChange={(v) => handleToggle("enabled", v)}
              />
              <Toggle
                label="Create missing records on inbound sync"
                description="When HubSpot has a company or contact that doesn't exist in EventFlow, create it."
                checked={config.createOnInbound}
                onChange={(v) => handleToggle("createOnInbound", v)}
              />
              <Toggle
                label="Push event engagements to HubSpot"
                description="When an event moves to Closed, create a HubSpot note on the linked company."
                checked={config.pushEngagements}
                onChange={(v) => handleToggle("pushEngagements", v)}
              />
            </section>

            <section className="p-5 space-y-3">
              <h3 className="text-sm font-medium">Field mapping</h3>
              <p className="text-xs text-muted-foreground">Default mappings shown. Full custom mapping is available in the next release.</p>
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                <p className="font-medium">Companies</p>
                {config.companyFieldMap.map((m) => (
                  <p key={m.efField} className="text-muted-foreground">
                    EventFlow <code>{m.efField}</code> ↔ HubSpot <code>{m.hubspotProperty}</code>
                  </p>
                ))}
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
                <p className="font-medium">Contacts</p>
                {config.contactFieldMap.map((m) => (
                  <p key={m.efField} className="text-muted-foreground">
                    EventFlow <code>{m.efField}</code> ↔ HubSpot <code>{m.hubspotProperty}</code>
                  </p>
                ))}
              </div>
            </section>

            <section className="p-5 space-y-3">
              <h3 className="text-sm font-medium">Manual sync</h3>
              <p className="text-xs text-muted-foreground">
                Triggers a full inbound sync of all HubSpot companies and contacts. Automatic syncing runs nightly.
              </p>
              <Button onClick={handleSync} disabled={syncing || !config.enabled}>
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              {syncError && <p className="text-sm text-destructive">{syncError}</p>}
              {syncResult && (
                <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
                  <p>✓ Companies upserted: <strong>{syncResult.companiesUpserted}</strong></p>
                  <p>✓ Contacts upserted: <strong>{syncResult.contactsUpserted}</strong></p>
                  {syncResult.engagementsPushed > 0 && (
                    <p>✓ Engagements pushed: <strong>{syncResult.engagementsPushed}</strong></p>
                  )}
                  {syncResult.errors.length > 0 && (
                    <div className="mt-2 text-destructive text-xs space-y-0.5">
                      <p className="font-medium">{syncResult.errors.length} error(s):</p>
                      {syncResult.errors.slice(0, 5).map((e, i) => <p key={i}>{e}</p>)}
                      {syncResult.errors.length > 5 && <p>…and {syncResult.errors.length - 5} more</p>}
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <div className="relative mt-0.5">
        <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <div className={`h-5 w-9 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`} />
        <div className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </div>
      <div>
        <p className="text-sm font-medium leading-none">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </label>
  );
}

function StatusChip({ connected, enabled }: { connected: boolean; enabled: boolean }) {
  if (!connected) return <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Not connected</span>;
  if (!enabled) return <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs text-warning">Paused</span>;
  return <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs text-success">Active</span>;
}
