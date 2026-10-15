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
  get googleClientId() { return str("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return str("GOOGLE_CLIENT_SECRET"); },
  /** Shared accounts (docs/shared-accounts.md): Control Point's internal API (loopback on the VM), its public URL, and the shared key. */
  get controlPointInternalUrl() { return str("CONTROL_POINT_INTERNAL_URL"); },
  get controlPointPublicUrl() { return str("CONTROL_POINT_PUBLIC_URL"); },
  get controlPointInternalKey() { return str("CONTROL_POINT_INTERNAL_KEY"); },
  /** Owner-only GET /api/stats/summary (Authorization: Bearer <token>); unset = the endpoint 404s. */
  get statsToken() { return str("STATS_TOKEN"); },
  get dataDir() { return str("DATA_DIR") ?? join(process.cwd(), ".data"); },
  /** Where an FTC Scout raw cache can be imported from (seed). */
  get scoutCacheDir() { return str("SCOUT_CACHE_DIR"); },
};

export const hasFirst = () => !!(env.firstUser && env.firstToken);
