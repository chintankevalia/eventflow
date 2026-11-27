import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

export type MailMessage = {
  to: string | string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
};

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export const OUTBOX_DIR = path.resolve(".data/outbox");

/** Development: writes each email to .data/outbox as JSON, viewable at /dev/outbox. Nothing leaves the machine. */
class OutboxTransport implements MailTransport {
  async send(message: MailMessage) {
    await mkdir(OUTBOX_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = message.subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    const file = path.join(OUTBOX_DIR, `${stamp}-${slug}.json`);
    await writeFile(file, JSON.stringify({ ...message, sentAt: new Date().toISOString() }, null, 2));
    console.info(`[mail:outbox] "${message.subject}" → ${[message.to].flat().join(", ")}`);
  }
}

/** SMTP (Microsoft 365, Mailpit, any relay). Configured with SMTP_* variables. */
class SmtpTransport implements MailTransport {
  private transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    requireTLS: process.env.SMTP_SECURE !== "true" && process.env.SMTP_REQUIRE_TLS !== "false",
  });

  async send(message: MailMessage) {
    await this.transporter.sendMail({
      from: process.env.MAIL_FROM ?? "EventFlow <eventflow@motadata.com>",
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}

let transport: MailTransport | undefined;

export function getMailTransport(): MailTransport {
  if (!transport) {
    const kind = process.env.MAIL_TRANSPORT ?? (process.env.NODE_ENV === "production" ? "smtp" : "outbox");
    transport = kind === "smtp" ? new SmtpTransport() : new OutboxTransport();
  }
  return transport;
}

export async function sendMail(message: MailMessage) {
  await getMailTransport().send(message);
}
