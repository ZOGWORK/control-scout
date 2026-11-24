# Cloudflare caching for controlscout.org

What the origin sends, and the dashboard settings that make Cloudflare use it. The origin headers are in the code;
the dashboard settings are the owner's to set (nothing in this repo can change them).

## What the origin sends

| Path | Cache-Control | Notes |
| --- | --- | --- |
| `/assets/*` (hashed build files) | `public, max-age=31536000, immutable` | `server/app.ts` (express.static). A file's name changes with its content. |
| `/api/search/follow`, `/api/search/related` | `public, max-age=60, stale-while-revalidate=300`, and the same in `Cloudflare-CDN-Cache-Control` | The same for everyone asking the same address: no account, no cookie (the preferred teams are in `?prefer=`). |
| `/api/flags` | `public, max-age=15` (`private` when some workspace has its own setting) | The page's HTML also carries the flags (`cs-flags`). |
| HTML pages | `public, max-age=0, must-revalidate`, `Vary: Cookie` | Never kept at the edge. |

Cloudflare only stores responses it treats as cacheable: by default files with a static extension (`.js`, `.css`,
…). `/api/…` answers are "DYNAMIC" (never stored) whatever their headers say, until a Cache Rule makes them eligible.

## Dashboard steps (owner)

Cloudflare dashboard → controlscout.org.

1. **Tiered Cache** (Caching → Tiered Cache): turn on **Smart Tiered Caching Topology**. A miss at one data centre
   then asks Cloudflare's upper tier before the VM, so a new build's CSS and JS reach a phone from a nearby copy
   instead of the VM (the audit saw one CSS miss cost 1.65 s of app start).
2. **Cache Rule for the built files** (Caching → Cache Rules → Create rule), named "Built assets":
   - When: *URI Path* *starts with* `/assets/`
   - Then: **Eligible for cache**; Edge TTL: **Use cache-control header if present** (one year, immutable);
     Browser TTL: **Respect origin**.
   - Cache key: leave *Query string* as is. Cloudflare keeps one copy per encoding it serves (br, gzip, none) by
     itself; nothing to add for "regardless of encoding".
3. **Cache Rule for search follow-ups**, named "Search follow-ups", placed after the first:
   - When: *URI Path* *equals* `/api/search/follow` **or** *URI Path* *equals* `/api/search/related`
   - And: *Cookie* *does not contain* `cs_session` (signed-in visitors go to the VM, as today)
   - Then: **Eligible for cache**; Edge TTL: **Use cache-control header if present**; Browser TTL: **Respect origin**.
   - Cache key: **Query string: include all** (each `q`, `prefer` and `season` is its own answer).

## Checking it

```sh
curl -sD- -o /dev/null "https://controlscout.org/api/search/follow?q=4215" | grep -i 'cf-cache-status\|cache-control'
```

The first request says `cf-cache-status: MISS`, the next within a minute `HIT`. `DYNAMIC` means the rule isn't
matching. For a built file, `HIT` with an `Age:` header.
