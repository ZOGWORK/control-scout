// Environment: loads .env (if present) once, then exposes typed settings.
// Secrets are read here and nowhere else; nothing in this module logs them.
import { existsSync } from "node:fs";
import { join } from "node:path";

const envFile = join(process.cwd(), ".env");
if (existsSync(envFile) && !process.env.CS_SKIP_DOTENV) {
  try { process.loadEnvFile(envFile); } catch { /* malformed .env: fall back to the real environment */ }
}

const str = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};

export const env = {
  get port() { return Number(str("PORT") ?? 3000); },
  get production() { return process.env.NODE_ENV === "production"; },
  get appUrl() { return str("APP_URL") ?? "http://localhost:5173"; },
  /** The one public origin search engines should index (canonical, OG, sitemap URLs). In production it's
   *  controlscout.org even on a backup host whose APP_URL is its own address (Render). */
  get canonicalUrl() { return str("CANONICAL_URL") ?? (this.production ? "https://controlscout.org" : this.appUrl); },
  get databaseUrl() { return str("DATABASE_URL") ?? `file:${join(process.cwd(), ".data", "scout.db").replace(/\\/g, "/")}`; },
  get databaseToken() { return str("DATABASE_AUTH_TOKEN"); },
  get firstUser() { return str("FTC_EVENTS_USERNAME"); },
  get firstToken() { return str("FTC_EVENTS_TOKEN"); },
  get resendKey() { return str("RESEND_API_KEY"); },
  get emailFrom() { return str("EMAIL_FROM") ?? "Control Scout <verify@tryctrlpoint.org>"; },
  /** Where contact-form messages are emailed (never sent to the browser). Unset: messages are only stored. */
  get contactTo() { return str("CONTACT_TO"); },
  get googleClientId() { return str("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return str("GOOGLE_CLIENT_SECRET"); },
  /** Shared accounts (docs/shared-accounts.md): Control Point's internal API (loopback on the VM), its public URL, and the shared key. */
  get controlPointInternalUrl() { return str("CONTROL_POINT_INTERNAL_URL"); },
  get controlPointPublicUrl() { return str("CONTROL_POINT_PUBLIC_URL"); },
  get controlPointInternalKey() { return str("CONTROL_POINT_INTERNAL_KEY"); },
  /** Owner-only GET /api/stats/summary (Authorization: Bearer <token>); unset = the endpoint 404s. */
  get statsToken() { return str("STATS_TOKEN"); },
  /** In-app error reports → GitHub issues (docs/error-reporting.md): a fine-grained PAT, Issues read/write on
   *  Control-Point-FTC/control-scout only. Unset: reports are only stored. Never sent to the browser or logged. */
  get githubReportToken() { return str("GITHUB_REPORT_TOKEN"); },
  /** Owner allowlist (comma-separated emails): who may read owner-only data such as GET /api/reports/errors. */
  get ownerEmails() { return (str("OWNER_EMAILS") ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean); },
  /** Entry photos in Cloudflare R2 (docs/r2-photos.md). All unset: photos are off and their UI hidden. Never logged. */
  get r2AccountId() { return str("R2_ACCOUNT_ID"); },
  get r2AccessKeyId() { return str("R2_ACCESS_KEY_ID"); },
  get r2SecretAccessKey() { return str("R2_SECRET_ACCESS_KEY"); },
  get r2Bucket() { return str("R2_BUCKET"); },
  /** The S3 API endpoint, https://<account id>.r2.cloudflarestorage.com (derived from R2_ACCOUNT_ID when unset). */
  get r2Endpoint() { return str("R2_ENDPOINT"); },
  /** Read for completeness only: the bucket is private, so photos are always served through short-lived signed URLs. */
  get r2PublicUrl() { return str("R2_PUBLIC_URL"); },
  /** New uploads stop at this many GB (10^9 bytes) stored, under R2's 10 GB free tier. Default 9.5. */
  get r2SoftCapGb() {
    const n = Number(str("R2_SOFT_CAP_GB"));
    return Number.isFinite(n) && n > 0 && n <= 10 ? n : 9.5;
  },
  /** Development and tests only: an in-process stand-in for R2 (server/scout/fakeR2.ts). Ignored in production. */
  get r2Fake() { return !this.production && str("R2_FAKE") === "1"; },
  /** Where the stand-in keeps objects (unset: in memory). */
  get r2FakeDir() { return str("R2_FAKE_DIR"); },
  /** Web push (docs/push.md): the VAPID key pair from `npx web-push generate-vapid-keys`, and a contact
   *  (mailto: or https:) push services can reach. All three set: push is available; otherwise it stays
   *  dormant. The private key is never sent to the browser or logged. */
  get vapidPublicKey() { return str("VAPID_PUBLIC_KEY"); },
  get vapidPrivateKey() { return str("VAPID_PRIVATE_KEY"); },
  get vapidSubject() { return str("VAPID_SUBJECT"); },
  get dataDir() { return str("DATA_DIR") ?? join(process.cwd(), ".data"); },
  /** Where an FTC Scout raw cache can be imported from (seed). */
  get scoutCacheDir() { return str("SCOUT_CACHE_DIR"); },
};

export const hasFirst = () => !!(env.firstUser && env.firstToken);
