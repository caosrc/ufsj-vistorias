---
name: Supabase Session Pooler
description: Network and TLS certificate constraints for Supabase PostgreSQL connections from this Replit.
---

Use the Supabase Session Pooler for this project's PostgreSQL connection. The direct database endpoint was unreachable from this Replit environment because it resolved to IPv6-only access. Keep the database password in a separate server-side secret; the anon key is not a database credential.

**Why:** The initial direct connection could not be reached, and Node did not trust the pooler's certificate chain without the project's root CA.

**How to apply:** Configure `SUPABASE_SESSION_POOLER_URL` and `SUPABASE_DB_PASSWORD`. Download the root certificate from Supabase Database Settings and set it as `SUPABASE_CA_CERT` to enable certificate verification. Without that CA, the connection remains TLS-encrypted but does not verify the server certificate.
