import type { Metadata } from "next";
import { DashboardPage } from "./dashboard-page";

export const metadata: Metadata = { title: "Dashboard" };

/** The default dashboard: the built-in Overview, or whichever one comes first for this viewer. */
export default function Page() {
  return <DashboardPage />;
}
