"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Every chart, loaded on demand.
 *
 * recharts is the largest dependency in the app, and none of it is needed to
 * read a page: the figures are already in the server-rendered data table inside
 * `ChartFrame`. So each chart is its own `dynamic()` chunk with `ssr: false`,
 * which means the page paints from the server first and the chart fills its
 * reserved box when the script lands — never the other way round.
 *
 * `ssr: false` is also what makes `ResponsiveContainer` behave. It measures its
 * parent, and a server render has no layout to measure, so an SSR'd chart
 * renders at zero width and then jumps.
 *
 * This module is the one client boundary. The chart implementations beside it
 * are only ever reached through these wrappers, which is why they are default
 * exports.
 */
const loading = () => <Skeleton className="size-full" />;

export const SpendTrendChart = dynamic(() => import("./spend-trend-chart"), { ssr: false, loading });
export const DepartmentSpendChart = dynamic(() => import("./department-spend-chart"), { ssr: false, loading });
export const ContributionChart = dynamic(() => import("./contribution-chart"), { ssr: false, loading });
export const TurnaroundChart = dynamic(() => import("./turnaround-chart"), { ssr: false, loading });

export type { DepartmentBar } from "./department-spend-chart";
export type { ContributionBar } from "./contribution-chart";
