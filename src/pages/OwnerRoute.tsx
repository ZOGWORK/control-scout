// /owner: the owner portal for owners, the ordinary not-found page for everyone else. The server
// answers /owner with its 404 page for every visitor (it can't tell who's asking from a page load),
// and every /api/owner/* call is checked there, so this only decides what to draw.
import { lazy, Suspense, type ReactNode } from "react";
import { usePersonal } from "../lib/personal";
import { LoadingBlock } from "../components/states";

const OwnerPage = lazy(() => import("./OwnerPage"));

export function OwnerRoute({ notFound }: { notFound: ReactNode }) {
  const { user, providers } = usePersonal();
  // Who's signed in isn't known until /api/auth/me answers: wait rather than flash "not found".
  if (!providers) return <LoadingBlock label="Loading" />;
  if (!user?.isOwner) return <>{notFound}</>;
  return <Suspense fallback={<LoadingBlock label="Loading the owner portal" />}><OwnerPage /></Suspense>;
}
