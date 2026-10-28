// /digest/unsubscribed: where the weekly digest's unsubscribe link lands (docs/digest.md). The server already
// switched the digest off in the click's own request (GET /api/digest/unsubscribe), so this page only says so:
// no sign-in, no second click. ?status=invalid: the link was replaced (the digest was turned back on since) or
// mistyped, and nothing changed.
import { Link, useSearchParams } from "react-router-dom";
import { MailCheck, MailQuestion } from "lucide-react";
import { useTitle } from "../lib/meta";
import { Reveal } from "../components/motion";
import { Button } from "../components/ui/button";

export default function DigestUnsubscribedPage() {
  const [params] = useSearchParams();
  const done = params.get("status") !== "invalid";
  useTitle(done ? "Unsubscribed" : "Link not active");
  const Icon = done ? MailCheck : MailQuestion;
  return (
    <Reveal className="mx-auto flex w-full max-w-md flex-col items-center px-1 pt-8 text-center sm:pt-16">
      <span className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-accent-text" aria-hidden><Icon className="size-7" /></span>
      <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {done ? "You're unsubscribed" : "This link isn't active"}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground sm:text-base">
        {done
          ? "You've unsubscribed from the weekly digest. You can turn it back on in Settings."
          : "Nothing was changed. The weekly digest was turned back on since that email, which replaces its unsubscribe link. To stop it, use the link in the latest digest or turn it off in Settings."}
      </p>
      <div className="mt-7 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
        <Button asChild variant="outline"><Link to="/settings?section=notifications">Open Settings</Link></Button>
        <Button asChild><Link to="/">Go to Control Scout</Link></Button>
      </div>
    </Reveal>
  );
}
