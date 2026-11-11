// Settings › Account: the username (src/shared/username.ts). Set here or in the sign-in prompt; it can change at most
// once in 30 days, and a change frees the old one at once. Only the account and the site owner see it.
import { useState } from "react";
import { Row } from "./rows";
import { Button } from "../ui/button";
import { FieldError, Input } from "../ui/basic";
import { toast } from "../ui/sonner";
import { apiFetch } from "../../lib/api";
import { usePersonal, type AccountUser } from "../../lib/personal";
import { USERNAME_CHANGE_DAYS, USERNAME_MAX, USERNAME_PROBLEM_TEXT, usernameProblem } from "../../shared/username";

export function UsernameRow({ user }: { user: AccountUser }) {
  const { refreshUser } = usePersonal();
  const [value, setValue] = useState(user.username ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const next = user.usernameNextChange ? new Date(user.usernameNextChange) : null;
  const locked = !!next && next.getTime() > Date.now();
  const dirty = value.trim() !== (user.username ?? "");
  const save = async () => {
    const u = value.trim();
    const p = usernameProblem(u);
    if (p) { setErr(USERNAME_PROBLEM_TEXT[p]); return; }
    setBusy(true); setErr(null); setSuggest([]);
    try {
      await apiFetch("/api/me/username", { method: "PUT", json: { username: u } });
      await refreshUser();
      toast.success("Username saved");
    } catch (e: any) {
      const b = e?.body as { error?: string; suggestions?: string[] } | undefined;
      setErr(b?.error ?? e?.message ?? "Not saved.");
      setSuggest(b?.suggestions ?? []);
    } finally { setBusy(false); }
  };
  return (
    <Row label="Username" htmlFor="username" stack
      description={<>Your handle for adding match videos, liking and reporting. Never shown on your videos (your actual name is). Change it once every {USERNAME_CHANGE_DAYS} days.</>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate className="max-w-md">
        <div className="flex gap-2">
          <Input id="username" value={value} maxLength={USERNAME_MAX} autoCapitalize="none" spellCheck={false} placeholder="letters, numbers, _" className="h-10" disabled={locked && !!user.username}
            onChange={(e) => { setValue(e.target.value.replace(/\s/g, "")); setErr(null); }} aria-invalid={err ? true : undefined} aria-describedby={err ? "username-error" : undefined} />
          <Button type="submit" disabled={!dirty || busy || (locked && !!user.username)}>{user.username ? "Change" : "Add a username"}</Button>
        </div>
        <FieldError id="username-error">{err}</FieldError>
        {suggest.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">Free: {suggest.map((s) => <button key={s} type="button" className="rounded-md border border-border px-2 py-0.5 font-mono text-foreground" onClick={() => { setValue(s); setErr(null); }}>{s}</button>)}</p>}
        {locked && user.username && <p className="mt-1.5 text-xs text-muted-foreground">You can change it again on {next!.toLocaleDateString(undefined, { month: "long", day: "numeric" })}.</p>}
      </form>
    </Row>
  );
}
