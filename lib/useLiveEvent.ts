"use client";

import useSWR from "swr";
import type { RunPlan, PlanRisk } from "@/lib/run/types";

export interface RunAuditEntry {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  actor: string;
  created_at: string;
}

export interface RunSnapshot {
  eventId: string;
  version: number;
  plan: RunPlan;
  risks: PlanRisk[];
  audit: RunAuditEntry[];
  ownerLinks: { token: string; task_ids: string[]; expires_at: string }[];
  event: { event_type: string; event_date: string; current_plan_version: number };
}

async function fetcher([url, token]: [string, string]): Promise<RunSnapshot> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Unable to refresh the live plan (${response.status}).`);
  return response.json() as Promise<RunSnapshot>;
}

export function useLiveEvent(
  eventId: string | null | undefined,
  organizerToken: string | null | undefined,
  initialPlan: RunPlan,
) {
  const { data, error, isLoading, mutate } = useSWR<RunSnapshot>(
    eventId && organizerToken ? [`/api/run/${eventId}`, organizerToken] : null,
    fetcher,
    {
      fallbackData: eventId && organizerToken ? {
        eventId,
        version: 1,
        plan: initialPlan,
        risks: [],
        audit: [],
        ownerLinks: [],
        event: {
          event_type: initialPlan.eventType,
          event_date: initialPlan.eventDate,
          current_plan_version: 1,
        },
      } : undefined,
      refreshInterval: 3000,
      revalidateOnFocus: true,
      shouldRetryOnError: true,
    },
  );

  return { snapshot: data, isLoading, isError: Boolean(error), error, refresh: mutate };
}
