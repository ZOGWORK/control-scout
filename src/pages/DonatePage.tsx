// /donate: a quiet page for anyone who wants to chip in. Control Scout stays free; a donation only helps
// pay the running costs, is not tax-deductible, and unlocks nothing. The button leaves the site for
// GitHub Sponsors (SPONSOR_URL), where GitHub and Stripe take the payment: nothing about it reaches Scout.
// Linked from the site footer and Home's footer, nowhere else. /support redirects here.
import { CreditCard, ExternalLink, Gift, Heart, Receipt, Server, Unlock } from "lucide-react";
import { useTitle } from "../lib/meta";
import { PageHeader } from "../components/page";
import { Button } from "../components/ui/button";
import { In, Prose, ShortVersion } from "../components/legal";
import { SPONSOR_URL } from "../shared/sponsor";

export default function DonatePage() {
  useTitle("Donate");
  return (
    <div>
      <PageHeader title="Support Control Scout" description="Control Scout is free and stays free. If it helps your team, you can chip in toward the running costs." />
      <ShortVersion items={[
        { icon: Gift, tone: "success", title: "Free, always", body: "Browsing, searching and predicting need no account and no payment. That doesn't change." },
        { icon: Server, tone: "info", title: "Running costs only", body: "Donations help pay for the domain, hosting and email, and a bigger plan if the site outgrows it." },
        { icon: Receipt, tone: "warning", title: "Not tax-deductible", body: "Control Scout is run by an individual developer. It is not a nonprofit or a charity." },
        { icon: Unlock, tone: "accent", title: "Nothing extra", body: "A donation unlocks no features, perks or priority help. Everyone gets the same site." },
      ]} />

      <section aria-labelledby="donate-how" className="grid grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl border border-line p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0 max-w-[72ch]">
          <h2 id="donate-how" className="mb-2 flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-foreground">
            <CreditCard className="size-[18px] text-text-muted" aria-hidden /> How paying works
          </h2>
          <Prose>
            <p>The button takes you off controlscout.org to <strong>GitHub Sponsors</strong>. GitHub and Stripe handle the payment there. Control Scout never sees, stores or touches your card details, and keeps no record of who gave or how much.</p>
            <p>Questions? <In to="/contact">Get in touch</In>.</p>
          </Prose>
        </div>
        <Button size="lg" asChild className="max-sm:w-full">
          <a href={SPONSOR_URL} target="_blank" rel="noreferrer noopener"><Heart /> Sponsor on GitHub <ExternalLink /></a>
        </Button>
      </section>
    </div>
  );
}
