function safeUrlMeta(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      protocol: u.protocol,
      host: u.host,
      pathname: u.pathname,
      hasSslMode: u.searchParams.has("sslmode"),
      sslMode: u.searchParams.get("sslmode"),
      pgbouncer: u.searchParams.get("pgbouncer"),
      connectionLimit: u.searchParams.get("connection_limit"),
    };
  } catch {
    return { raw: "[unparseable]" };
  }
}

function normalizePostgresUrl(raw, opts = {}) {
  if (!raw || typeof raw !== "string") return raw;

  let u;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }

  const p = u.searchParams;

  if (opts.defaultSslMode && !p.has("sslmode")) {
    p.set("sslmode", String(opts.defaultSslMode));
  }

  if (opts.forcePgbouncerTrue) {
    p.set("pgbouncer", "true");
  }

  if (Number.isInteger(opts.setConnectionLimit) && opts.setConnectionLimit > 0) {
    p.set("connection_limit", String(opts.setConnectionLimit));
  }

  return u.toString();
}

function isSupabasePoolerUrl(raw) {
  try {
    const u = new URL(raw);
    return (
      u.hostname.endsWith(".pooler.supabase.com") ||
      u.hostname.includes(".pooler.supabase.com") ||
      u.hostname.includes("pooler.supabase.com")
    );
  } catch {
    return false;
  }
}

function isSupabaseUrl(raw) {
  try {
    const u = new URL(raw);
    return (
      u.hostname.endsWith(".supabase.co") ||
      u.hostname.includes(".supabase.co") ||
      u.hostname.endsWith(".supabase.com") ||
      u.hostname.includes(".supabase.com")
    );
  } catch {
    return false;
  }
}

function bootstrapEnv() {
  // Make DB URLs more robust for Supabase + Windows:
  // - default sslmode=require (Supabase typically requires SSL)
  // - if using the pooler in dev, keep Prisma connection_limit low
  const isProd = process.env.NODE_ENV === "production";

  const dbUrl = process.env.DATABASE_URL;
  const directUrl = process.env.DIRECT_URL;

  if (dbUrl) {
    const usePooler = isSupabasePoolerUrl(dbUrl);
    const supabase = isSupabaseUrl(dbUrl);
    const poolerSslMode =
      process.env.DB_POOLER_SSLMODE ||
      (usePooler && !isProd && process.platform === "win32" ? "disable" : null);
    process.env.DATABASE_URL = normalizePostgresUrl(dbUrl, {
      // In Windows dev we default the pooler to sslmode=disable because some
      // machines fail opening TLS connections via SChannel (Prisma native-tls).
      // Override with DB_POOLER_SSLMODE=require to force TLS.
      defaultSslMode: supabase ? poolerSslMode || "require" : null,
      // Prisma should use its own pool; keep the number of DB connections per process low.
      setConnectionLimit: !isProd && usePooler ? 1 : undefined,
      // If the pooler is used, always flag pgbouncer=true for Prisma.
      forcePgbouncerTrue: usePooler ? true : false,
    });
  }

  if (directUrl) {
    const supabase = isSupabaseUrl(directUrl);
    process.env.DIRECT_URL = normalizePostgresUrl(directUrl, {
      defaultSslMode: supabase ? "require" : null,
      // directUrl should never be marked as pgbouncer.
      forcePgbouncerTrue: false,
    });
  }

  // DEV NOTE:
  // - In many networks, outbound port 5432 is blocked, so direct Postgres can be unreachable.
  // - The Supabase pooler (pgBouncer, usually port 6543) is often the most reliable for dev.
  //
  // Therefore we keep DATABASE_URL as-is by default.
  // If you explicitly want to use DIRECT_URL for runtime in dev, set DB_PREFER_DIRECT=1.
  const preferDirect = process.env.DB_PREFER_DIRECT === "1";
  const normalizedDbUrl = process.env.DATABASE_URL;
  const normalizedDirectUrl = process.env.DIRECT_URL;

  if (!isProd && isSupabasePoolerUrl(normalizedDbUrl)) {
    process.env.DATABASE_POOLER_URL = normalizedDbUrl;

    if (preferDirect && normalizedDirectUrl) {
      process.env.DATABASE_URL = normalizePostgresUrl(normalizedDirectUrl, {
        ensureSslModeRequire: isSupabaseUrl(normalizedDirectUrl),
        forcePgbouncerTrue: false,
        setConnectionLimit: 1,
      });
    }
  }

  if (process.env.DEBUG_DB === "1") {
    console.log("[env.db]", {
      DATABASE_URL: safeUrlMeta(process.env.DATABASE_URL),
      DIRECT_URL: safeUrlMeta(process.env.DIRECT_URL),
      DATABASE_POOLER_URL: safeUrlMeta(process.env.DATABASE_POOLER_URL),
    });
  }
}

module.exports = { bootstrapEnv };
