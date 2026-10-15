// /terms: the terms of use, in plain language. Facts here follow the code:
// per-IP rate limits (server/app.ts limiter, server/auth/routes.ts ipLimit),
// full-season downloads (/download), the GPL-3.0 LICENSE at the repo root.
import { Gift, ShieldAlert, Sparkles, UserRound } from "lucide-react";
import { useTitle } from "../lib/meta";
import { PageHeader } from "../components/page";
import { Ext, In, LegalSections, ShortVersion, type LegalSectionDef } from "../components/legal";

export const TERMS_UPDATED = "15 October 2026";

const SECTIONS: LegalSectionDef[] = [
  {
    id: "agreement", title: "Using Control Scout", body: (
      <>
        <p>These terms apply when you use Control Scout (controlscout.org). By using it, you agree to them. If you don't agree, please don't use the site.</p>
        <p>If you're under the age where you can agree to terms like these where you live, a parent, guardian or team mentor should read them with you.</p>
      </>
    ),
  },
  {
    id: "free", title: "A free service", body: (
      <p>Control Scout is <strong>free</strong>. There are no paid plans and no ads. We run it for the FTC community and try to keep it fast and available, but we can change, pause or stop any part of it at any time, and we can't promise it will always be up, especially during a busy event weekend.</p>
    ),
  },
  {
    id: "predictions", title: "Predictions are estimates", body: (
      <>
        <p>Match predictions, win chances, predicted scores and advancement odds come from a statistical model. They are <strong>estimates, not guarantees</strong>. Every prediction shows how confident it is, and even a strong favourite loses sometimes.</p>
        <p>Use them to plan and to start conversations, not as the only basis for alliance selection or any other decision. <In to="/methodology">How it works</In> explains the model and shows its public track record.</p>
      </>
    ),
  },
  {
    id: "data", title: "FTC data may be wrong", body: (
      <>
        <p>Teams, events, matches, rankings and awards come from the <Ext href="https://ftc-events.firstinspires.org">FIRST Events API</Ext>, with <Ext href="https://ftcscout.org">FTC Scout</Ext> as a fallback. Those sources can be late, incomplete or occasionally wrong, and so can our copy of them. Official results are always the ones published by <i>FIRST</i>.</p>
        <p>Match data is © <i>FIRST</i>. Control Scout is not affiliated with or endorsed by <i>FIRST</i>®. <i>FIRST</i>® Tech Challenge is a registered trademark of <i>FIRST</i>.</p>
        <p>Spotted a mistake? <In to="/contact">Tell us</In> and we'll check it.</p>
      </>
    ),
  },
  {
    id: "acceptable", title: "Acceptable use", body: (
      <>
        <p>Use Control Scout the way it's meant to be used. Please don't:</p>
        <ul>
          <li><strong>Scrape it aggressively</strong> or hammer the API with automated requests. Requests are <strong>rate-limited per IP address</strong>, and clients that go over the limit get slowed or blocked. Need a whole season? The <In to="/download">Download page</In> has full seasons as files.</li>
          <li>Try to break, overload or get around the site's security, rate limits or sign-in.</li>
          <li>Use someone else's account, or sign in with an email address that isn't yours.</li>
          <li>Use the site to harass anyone, or to post or send anything unlawful or harmful.</li>
        </ul>
        <p>We may limit or block access for anyone who does.</p>
      </>
    ),
  },
  {
    id: "accounts", title: "Accounts", body: (
      <>
        <p>You don't need an account to browse, search or predict. An account only syncs your own data (my team, tracked teams, shortlist, scouting) between devices.</p>
        <p>Accounts are shared with Control Point (<Ext href="https://tryctrlpoint.org">tryctrlpoint.org</Ext>), so one sign-in works on both. Keep access to your email and sign-in methods secure, since anyone who can sign in as you can see your synced data. You can delete your account at any time in <In to="/settings?section=privacy">Settings › Account &amp; privacy</In>.</p>
      </>
    ),
  },
  {
    id: "content", title: "Your scouting notes are yours", body: (
      <p>Scouting entries, notes, shortlists and recordings you make <strong>belong to you</strong>. We store synced data only to sync it back to you; we don't publish, share or sell it. You can export your scouting at any time (<In to="/settings?section=scouting">Settings › Scouting data</In>). Recordings never leave your device. You're responsible for what you write, so keep notes about other teams respectful.</p>
    ),
  },
  {
    id: "license", title: "Software license", body: (
      <p>Control Scout's source code is licensed under the <Ext href="https://www.gnu.org/licenses/gpl-3.0.html">GNU General Public License v3.0</Ext> (GPL-3.0). The license covers the code, not the FTC data shown on the site, which belongs to its sources (see <a href="#data">FTC data may be wrong</a>).</p>
    ),
  },
  {
    id: "warranty", title: "No warranty", body: (
      <>
        <p>Control Scout is provided <strong>"as is"</strong>, without warranties of any kind, including that it is accurate, complete, available or fit for a particular purpose.</p>
        <p>To the extent the law allows, the people who run Control Scout aren't liable for losses that come from using it or relying on its data or predictions. Nothing here limits rights you have under the law that can't be limited.</p>
      </>
    ),
  },
  {
    id: "privacy", title: "Privacy", body: (
      <p>How we handle data is explained in the <In to="/privacy">privacy policy</In>.</p>
    ),
  },
  {
    id: "changes", title: "Changes to these terms", body: (
      <p>We may update these terms as Control Scout changes. When we do, we'll update this page and the date at the top. If a change is significant, we'll say so in the app. Continuing to use Control Scout after a change means you accept the new terms.</p>
    ),
  },
  {
    id: "contact", title: "Contact", body: (
      <p>Questions about these terms? Reach us through the <In to="/contact">contact page</In>.</p>
    ),
  },
];

export default function TermsPage() {
  useTitle("Terms");
  return (
    <div>
      <PageHeader eyebrow={`Last updated ${TERMS_UPDATED}`} title="Terms of use" description="The rules for using Control Scout, in plain language." />
      <ShortVersion items={[
        { icon: Gift, tone: "accent", title: "Free for everyone", body: "No paid plans, no ads. Browse, search and predict without an account." },
        { icon: Sparkles, tone: "info", title: "Predictions are estimates", body: "A model's best guess with its confidence shown, never a guarantee." },
        { icon: UserRound, tone: "success", title: "Your notes are yours", body: "Scouting you write belongs to you. Export it or delete it any time." },
        { icon: ShieldAlert, tone: "warning", title: "Be kind to the servers", body: "Requests are rate-limited. Need everything? Download full seasons instead of scraping." },
      ]} />
      <LegalSections sections={SECTIONS} />
    </div>
  );
}
