// The email digest (docs/digest.md): what the Settings switch and the unsubscribe page share with
// the server. The email itself is built on the server only (server/digest/).

/** The one line under the Settings switch. */
export const DIGEST_DESCRIPTION = "A few emails a week with your followed teams' results, prediction check-in, and upcoming events. No email if there's nothing to report.";

/** GET /api/digest (signed in). */
export interface DigestStatus {
  /** Can this server send it (email set up and the owner's switch on)? */
  available: boolean;
  enabled: boolean;
  /** Where it goes: the account's email. */
  email: string | null;
  /** The last digest bounced for good, which turned the switch off; turning it back on clears this. */
  bounced: boolean;
  /** PUT only: a welcome email is on its way (the first time the account turned it on). */
  welcomeSent?: boolean;
  /** The teams it would cover (my team plus tracked teams). */
  followedTeams: number[];
}

/** GET /api/owner/digest: the owner console's Email digest card. */
export interface OwnerDigest {
  /** Scheduled sends go out: email set up (RESEND_API_KEY) and the owner's switch on. */
  available: boolean;
  /** Email is set up at all: test sends work even with scheduled sends switched off. */
  emailReady: boolean;
  /** Accounts with the digest on (and not bounced). */
  subscribers: number;
  /** The next scheduled send, ISO (owner only: members are never told a time). */
  nextSend: string;
  /** The owner's own account: is the digest on for it, and how many teams it follows. */
  mine: { enabled: boolean; followed: number };
  /** The latest send in the log: its key (New York time) and what happened, per status. */
  lastSend: { key: string; counts: Record<string, number> } | null;
}

/** POST /api/owner/digest/send: what happened to the owner's own test send. */
export interface OwnerDigestSendResult {
  kind: "digest" | "welcome";
  outcome: "sent" | "nothing" | "failed" | "skipped";
  /** A sentence for the console. */
  message: string;
}

/** Where the unsubscribe link lands: /digest/unsubscribed?status=… */
export type UnsubscribeStatus = "done" | "invalid";
