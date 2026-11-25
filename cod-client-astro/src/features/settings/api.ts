import { apiFetch } from "@/lib/api";
import type { StoreConfig, UpdateStoreData } from "./types";
import type { StoreSummary } from "./store-summary";

interface DataEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

function json(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  };
}

export async function getMyStore() {
  return (await apiFetch<DataEnvelope<StoreConfig>>("/api/stores/me")).data;
}

/** The store's name, domain and logo, which every signed-in member may read. */
export async function getStoreSummary() {
  return (await apiFetch<DataEnvelope<StoreSummary>>("/api/stores/me/summary")).data;
}

export async function updateMyStore(data: UpdateStoreData) {
  return (await apiFetch<DataEnvelope<StoreConfig>>("/api/stores/me", json({ method: "PATCH", body: JSON.stringify(data) }))).data;
}
