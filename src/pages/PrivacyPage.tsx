// /privacy: what Control Scout collects, why, where it lives and how to remove
// it, in plain language. Keep it in step with Settings › Account & privacy and
// with the code (cookies in server/auth, storage in src/lib).
import { BarChart3, HardDrive, ShieldCheck, UserRound } from "lucide-react";
import { useTitle } from "../lib/meta";
import { PageHeader } from "../components/page";
import { Ext, In, LegalSections, ShortVersion, type LegalSectionDef } from "../components/legal";

export const PRIVACY_UPDATED = "15 October 2026";

const COOKIES: { name: string; what: string; lasts: string }[] = [
  { name: "cs_session", what: "Keeps you signed in. Set only when you sign in; scripts on the page can't read it.", lasts: "30 days, or until you sign out" },
  { name: "cs_oauth_state", what: "Proves a Google sign-in came back to the browser that started it.", lasts: "10 minutes" },
  { name: "cs_cp_state, cs_cp_back", what: "The same check for signing in through Control Point, and the page to return you to afterwards.", lasts: "10 minutes" },
];

const DEVICE: { name: string; what: string }[] = [
  { name: "Preferences", what: "Theme, background, density, sidebar and alert settings." },
  { name: "Your teams and lists", what: "My team, the teams and events you track, your shortlist and its notes." },
  { name: "Scouting", what: "Your scouting entries and notes, plus match-video links you add." },
  { name: "Offline data", what: "Offline packs and saved seasons, so predictions and past data work with no signal." },
  { name: "Recordings", what: "Videos you record in the app (control-scout-media). They never leave your device." },
];

function StorageTable({ caption, head, rows, mono }: { caption: string; head: [string, string, string?]; rows: { name: string; what: string; lasts?: string }[]; mono?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden bg-muted/50 text-xs uppercase tracking-wide text-text-muted sm:table-header-group">
          <tr>{head.filter(Boolean).map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            // Phones: each row stacks (name, then what it does, then how long).
            <tr key={r.name} className="flex flex-col gap-1 px-4 py-3 sm:table-row sm:p-0">
              <th scope="row" className={`${mono ? "font-mono text-[13px]" : ""} font-medium text-foreground sm:w-[30%] sm:px-4 sm:py-3 sm:align-top`}>{r.name}</th>
              <td className="text-text-muted sm:px-4 sm:py-3 sm:align-top">{r.what}</td>
              {head[2] && <td className="text-xs text-text-muted/80 sm:w-[22%] sm:px-4 sm:py-3 sm:align-top sm:text-sm"><span className="sm:hidden">Lasts: </span>{r.lasts}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SECTIONS: LegalSectionDef[] = [
  {
    id: "collect", title: "What we collect", body: (
      <>
        <p>Control Scout works without an account. Browsing teams, events, matches and predictions needs <strong>no sign-in and no personal information</strong>.</p>
        <ul>
          <li><strong>If you sign in:</strong> your email address, an optional display name, and what you choose to sync: my team, tracked teams and events, your shortlist and its notes, scouting entries and match-video links.</li>
          <li><strong>If you allow anonymous usage statistics:</strong> which pages are viewed. See <a href="#analytics">Usage statistics</a>.</li>
          <li><strong>If you contact us:</strong> the email address, optional name and message you send through the <In to="/contact">contact form</In>.</li>
          <li><strong>Server logs:</strong> like any website, our web server briefly records requests (the page asked for, IP address, browser type) to keep the site secure and working.</li>
        </ul>
        <p>Beyond that, we don't ask for your age, school, team role or location, and we never sell or rent data to anyone.</p>
      </>
    ),
  },
  {
    id: "why", title: "Why we use it", body: (
      <ul>
        <li><strong>Your email</strong> is used only to send sign-in codes and to recognise your account. No newsletters, no marketing.</li>
        <li><strong>Synced data</strong> is there so your lists and scouting follow you between devices.</li>
        <li><strong>Contact messages</strong> are used only to read and answer what you sent.</li>
        <li><strong>Usage statistics</strong> (only if you allow them) tell us which pages people use, so we know what to improve.</li>
        <li><strong>Server logs</strong> help us stop abuse (for example too many sign-in attempts) and fix errors.</li>
      </ul>
    ),
  },
  {
    id: "storage", title: "Cookies and storage on your device", body: (
      <>
        <p>Control Scout sets <strong>only essential cookies</strong>, all of them for signing in. There are no advertising or tracking cookies, and no third-party cookies.</p>
        <StorageTable caption="Cookies" head={["Cookie", "What it's for", "How long"]} rows={COOKIES} mono />
        <p className="pt-2">Everything else stays in your browser's own storage (local storage and IndexedDB) on this device. We can't see it unless you sign in and sync it, and recordings are never uploaded at all.</p>
        <StorageTable caption="Data stored on your device" head={["On your device", "What it holds"]} rows={DEVICE} />
        <p className="pt-2">Your answer to the usage-statistics question is kept on your device too. Match videos play from <strong>youtube-nocookie.com</strong>, YouTube's privacy-enhanced mode, only when you open one.</p>
      </>
    ),
  },
  {
    id: "analytics", title: "Usage statistics", body: (
      <>
        <p>We'd like to know which pages are useful, so Control Scout may ask whether you allow <strong>anonymous usage statistics</strong>. It's your choice, and the site works exactly the same either way.</p>
        <ul>
          <li><strong>If you allow them,</strong> each page view sends Control Scout's own server: the page's path (like <span className="font-mono text-[13px]">/events</span>), the domain of the site that linked you here, and a rough screen-size group (phone, tablet or desktop).</li>
          <li><strong>Nothing that identifies you:</strong> no cookies, no IP address stored, no ID that follows you between visits or sites. The statistics go to our server only, never to an analytics company or advertiser.</li>
          <li><strong>If you decline,</strong> nothing is sent.</li>
        </ul>
        <p>Your answer is remembered on your device. Clearing Control Scout's data (<In to="/settings?section=privacy">Settings › Account &amp; privacy</In> › Clear all local data) resets it, and you'll be asked again.</p>
      </>
    ),
  },
  {
    id: "accounts", title: "Sign-in and accounts", body: (
      <>
        <p>You can sign in with a <strong>code sent to your email</strong>, or with <strong>Google, Discord or GitHub through Control Point</strong>, our sister app for FTC team workspaces (<Ext href="https://tryctrlpoint.org">tryctrlpoint.org</Ext>).</p>
        <ul>
          <li>One account works on both apps. Your email address and display name are kept in a shared account record run by Control Point. Each app keeps its own sign-in: choose "Continue with Control Point" to sign in to Control Scout with your Control Point account.</li>
          <li>Sign-in codes are emailed by our email provider, Resend, from <span className="font-mono text-[13px]">verify@tryctrlpoint.org</span>. A code is stored only in scrambled (hashed) form and expires after 10 minutes.</li>
          <li>When you sign in with Google, Discord or GitHub, we receive your email address from that service, and nothing from your account there beyond what's needed to sign you in.</li>
        </ul>
      </>
    ),
  },
  {
    id: "sources", title: "Where the FTC data comes from", body: (
      <p>Teams, events, matches, rankings and awards are public FTC information from the official <Ext href="https://ftc-events.firstinspires.org">FIRST Events API</Ext>, with <Ext href="https://ftcscout.org">FTC Scout</Ext> as a fallback. It includes team numbers and names, team locations (city and region) and match results, never information about individual students. Control Scout is not affiliated with or endorsed by <i>FIRST</i>®.</p>
    ),
  },
  {
    id: "hosting", title: "Where data is kept", body: (
      <p>Control Scout runs on a server we manage at Oracle Cloud, with a backup copy on Render. Data travels over HTTPS. The services that help us run the site (hosting, and Resend for sign-in emails) handle data only to provide that service.</p>
    ),
  },
  {
    id: "retention", title: "How long we keep it", body: (
      <ul>
        <li><strong>Account and synced data:</strong> until you delete it or your account.</li>
        <li><strong>Sign-in sessions:</strong> 30 days, or until you sign out.</li>
        <li><strong>Sign-in codes:</strong> 10 minutes.</li>
        <li><strong>Server logs:</strong> about two weeks, then deleted automatically.</li>
        <li><strong>Contact messages:</strong> as long as we need them to follow up. Ask us and we'll delete yours.</li>
        <li><strong>Usage statistics:</strong> anonymous page counts, with nothing that could tie them back to you.</li>
        <li><strong>Data on your device:</strong> until you clear it. It's yours, and it's under your control.</li>
      </ul>
    ),
  },
  {
    id: "choices", title: "Your choices", body: (
      <ul>
        <li><strong>Use it without an account.</strong> Everything stays on your device.</li>
        <li><strong>Export your scouting</strong> as JSON or CSV in <In to="/settings?section=scouting">Settings › Scouting data</In>.</li>
        <li><strong>Clear this device</strong> in <In to="/settings?section=privacy">Settings › Account &amp; privacy</In>.</li>
        <li><strong>Delete your account</strong> in the same place. It removes your account and everything synced to it from Control Scout straight away. To also remove the shared account record held by Control Point, <In to="/contact">contact us</In>.</li>
        <li><strong>Ask us</strong> for a copy of your data, or to correct or delete it, through the <In to="/contact">contact page</In>.</li>
      </ul>
    ),
  },
  {
    id: "students", title: "Students and young people", body: (
      <>
        <p>Most FTC participants are students, many of them under 18. Control Scout is built so nobody has to share anything personal to use it: <strong>the only personal information we ever ask for is an email address</strong>, and only if you choose to sign in to sync your data.</p>
        <p>We don't knowingly collect personal information from children under 13. If you're under 13, please use Control Scout without signing in. If you believe a child has given us their email, <In to="/contact">tell us</In> and we'll delete it.</p>
      </>
    ),
  },
  {
    id: "contact", title: "Contact", body: (
      <p>Questions about privacy, or a request about your data? Reach us through the <In to="/contact">contact page</In>.</p>
    ),
  },
  {
    id: "updates", title: "Changes to this policy", body: (
      <p>If we change how we handle data, we'll update this page and the date at the top. If a change is significant (for example a new kind of data), we'll say so in the app before it takes effect.</p>
    ),
  },
];

export default function PrivacyPage() {
  useTitle("Privacy");
  return (
    <div>
      <PageHeader eyebrow={`Last updated ${PRIVACY_UPDATED}`} title="Privacy policy" description="What Control Scout collects, why, where it lives, and how to remove it. In plain language." />
      <ShortVersion items={[
        { icon: UserRound, tone: "accent", title: "No account needed", body: "Browse, search and predict without signing in. Sign in only to sync your own lists across devices." },
        { icon: HardDrive, tone: "info", title: "Your data stays on your device", body: "Lists, scouting and offline data live in your browser. Recordings never leave it." },
        { icon: ShieldCheck, tone: "success", title: "No ads, no third-party trackers", body: "Only essential sign-in cookies. We never sell data." },
        { icon: BarChart3, tone: "warning", title: "Anonymous stats, only if you allow them", body: "Page views counted on our own server, with nothing that identifies you. Decline and nothing is sent." },
      ]} />
      <LegalSections sections={SECTIONS} />
    </div>
  );
}
