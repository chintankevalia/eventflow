import type { Tone } from "@/lib/lifecycle";

export const USER_STATUS_META = {
  ACTIVE: { label: "Active", tone: "success" },
  INVITED: { label: "Invited", tone: "info" },
  DEACTIVATED: { label: "Deactivated", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export type UserStatus = keyof typeof USER_STATUS_META;
