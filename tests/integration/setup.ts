import { beforeEach, vi } from "vitest";
import type { MailMessage } from "@/server/mail/transport";

/** Capture outgoing email for assertions instead of writing to the dev outbox. */
const g = globalThis as unknown as { __sentMail: MailMessage[] };
g.__sentMail = [];

vi.mock("@/server/mail/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/mail/transport")>();
  return {
    ...actual,
    sendMail: vi.fn(async (message: MailMessage) => {
      g.__sentMail.push(message);
    }),
  };
});

beforeEach(() => {
  g.__sentMail.length = 0;
});
