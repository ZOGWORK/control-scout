// The weekly email digest (docs/digest.md): what the Settings switch and the unsubscribe page share with
// the server. The email itself is built on the server only (server/digest/).

/** The one line under the Settings switch. */
export const DIGEST_DESCRIPTION = "One email on Mondays with your followed teams' results, prediction check-in, and upcoming events. No email if there's nothing to report.";

/** GET /api/digest (signed in). */
export interface DigestStatus {
  /** Can this server send it (email set up and the owner's switch on)? */
  available: boolean;
  enabled: boolean;
  /** Where it goes: the account's email. */
  email: string | null;
  /** The last digest bounced for good, which turned the switch off; turning it back on clears this. */
  bounced: boolean;
  /** The teams it would cover (my team plus tracked teams). */
  followedTeams: number[];
}

/** Where the unsubscribe link lands: /digest/unsubscribed?status=… */
export type UnsubscribeStatus = "done" | "invalid";
