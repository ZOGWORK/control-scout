// The app's side of match videos people add (docs/contributors.md, server/videos/routes.ts). Every read is for the
// account looking, so its path carries the account (`v=`): the app's answer cache never shows one account's videos to
// the next one signed in on the device.
import { useEffect } from "react";
import { apiFetch, useApi } from "./api";
import { usePersonal } from "./personal";
import type { ApplicationInput, ContributorVideo, EventContributorVideos, InviteRead, MyContributorStatus } from "../shared/contributors";

const who = (id: number | null | undefined) => `v=${id ?? 0}`;

export const eventVideosPath = (season: number, code: string, userId: number | null | undefined) => `/api/videos/event/${season}/${encodeURIComponent(code)}?${who(userId)}`;
export const matchVideosPath = (season: number, code: string, key: string, userId: number | null | undefined) => `/api/videos/match/${season}/${encodeURIComponent(code)}/${key}?${who(userId)}`;

/** An event's contributor videos and coverage, for whoever is looking. */
export function useEventVideos(season: number, code: string) {
  const { user } = usePersonal();
  return useApi<EventContributorVideos>(eventVideosPath(season, code, user?.id));
}

export interface MatchVideosAnswer { video: ContributorVideo | null; own?: (ContributorVideo & { shown: boolean })[]; me?: MyContributorStatus }
export function useMatchVideos(season: number, code: string, key: string) {
  const { user } = usePersonal();
  return useApi<MatchVideosAnswer>(matchVideosPath(season, code, key, user?.id));
}

/** The signed-in account's contributor status (null signed out). */
export function useMyContributorStatus() {
  const { user } = usePersonal();
  return useApi<MyContributorStatus>(user ? `/api/videos/me?${who(user.id)}` : null);
}

/** Fired after any change to a contributor video on this device (add, edit, remove, like): readers reload. */
export const VIDEOS_CHANGED = "cs-videos-changed";
export const announceVideosChanged = () => window.dispatchEvent(new Event(VIDEOS_CHANGED));
/** Ask again whenever a contributor video changes on this device. */
export function useReloadOnVideoChange(reload: () => unknown) {
  useEffect(() => { const f = () => { void reload(); }; window.addEventListener(VIDEOS_CHANGED, f); return () => window.removeEventListener(VIDEOS_CHANGED, f); }, [reload]);
}

export const likeVideo = (id: number, on: boolean) => apiFetch<{ likes: number; liked: boolean }>(`/api/videos/${id}/like`, { method: on ? "PUT" : "DELETE", json: {} });
export const reportVideo = (id: number, reason: string, note: string) => apiFetch<{ ok: true; already: boolean; message: string }>(`/api/videos/${id}/report`, { method: "POST", json: { reason, note } });
export const removeVideo = (id: number) => apiFetch<{ ok: true }>(`/api/videos/${id}`, { method: "DELETE", json: {} });
export interface AddVideoBody { url: string; team?: number | null; t?: number | null; confirmDuplicate?: boolean; confirmLong?: boolean }
export interface AddVideoAnswer { ok: true; video: ContributorVideo; shown: boolean; occupiedBy?: string; warnings: ("long" | "unchecked" | "region")[] }
export const addVideo = (season: number, code: string, key: string, body: AddVideoBody) => apiFetch<AddVideoAnswer>(`/api/videos/match/${season}/${encodeURIComponent(code)}/${key}`, { method: "POST", json: body });
export const editVideo = (id: number, body: AddVideoBody) => apiFetch<AddVideoAnswer>(`/api/videos/${id}`, { method: "PATCH", json: body });

export type ApplyAnswer = { ok: true; status: MyContributorStatus };
export const applyForVerification = (body: ApplicationInput) => apiFetch<ApplyAnswer>("/api/videos/apply", { method: "POST", json: body });
export const withdrawApplication = () => apiFetch<ApplyAnswer>("/api/videos/apply/withdraw", { method: "POST", json: {} });
export const readInviteLink = (token: string) => apiFetch<InviteRead>(`/api/videos/invite?token=${encodeURIComponent(token)}`);
export const claimInviteLink = (token: string) => apiFetch<ApplyAnswer>("/api/videos/invite/claim", { method: "POST", json: { token } });
export const requestFromInviteLink = (token: string) => apiFetch<ApplyAnswer & { already: boolean }>("/api/videos/invite/request", { method: "POST", json: { token } });
