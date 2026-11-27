import type { Metadata } from "next";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import { MotadataMark } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { OUTBOX_DIR, type MailMessage } from "@/server/mail/transport";

export const metadata: Metadata = { title: "Dev outbox", robots: { index: false } };
export const dynamic = "force-dynamic";

type Stored = MailMessage & { sentAt: string; file: string };

/** Development only: emails captured by the outbox transport instead of being sent. */
export default async function OutboxPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();

  const files = await readdir(OUTBOX_DIR).catch(() => [] as string[]);
  const messages: Stored[] = (
    await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, 50)
        .map(async (file) => ({ ...JSON.parse(await readFile(path.join(OUTBOX_DIR, file), "utf8")), file })),
    )
  ).filter(Boolean);

  const { m } = await searchParams;
  const selected = messages.find((msg) => msg.file === m) ?? messages[0];

  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <MotadataMark className="size-8" />
        <div>
          <h1 className="text-xl font-semibold">Dev outbox</h1>
          <p className="text-sm text-muted-foreground">
            Emails EventFlow would have sent. Development only; nothing leaves this machine.
          </p>
        </div>
        <Badge tone="warning" className="ml-auto">
          Development
        </Badge>
      </div>

      {messages.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">No emails yet.</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <Card className="max-h-[75vh] overflow-y-auto">
            <ul className="divide-y divide-border">
              {messages.map((msg) => (
                <li key={msg.file}>
                  <a
                    href={`/dev/outbox?m=${encodeURIComponent(msg.file)}`}
                    className={`block px-4 py-3 text-sm hover:bg-accent ${msg.file === selected?.file ? "bg-primary-soft" : ""}`}
                  >
                    <span className="block truncate font-medium">{msg.subject}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      To {[msg.to].flat().join(", ")}
                    </span>
                    <span className="block text-xs text-muted-foreground">{formatDateTime(msg.sentAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          {selected && (
            <Card className="overflow-hidden">
              <div className="border-b border-border px-4 py-3 text-sm">
                <p className="font-medium">{selected.subject}</p>
                <p className="text-xs text-muted-foreground">
                  To {[selected.to].flat().join(", ")}
                  {selected.cc?.length ? ` · CC ${selected.cc.join(", ")}` : ""}
                </p>
              </div>
              <iframe
                title="Email preview"
                srcDoc={selected.html}
                // Same origin lets images load under our CSP; scripts stay disabled (no allow-scripts).
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
                className="h-[65vh] w-full bg-white"
              />
            </Card>
          )}
        </div>
      )}
    </main>
  );
}
