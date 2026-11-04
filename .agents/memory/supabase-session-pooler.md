---
name: Supabase Session Pooler
description: Network and TLS certificate constraints for Supabase PostgreSQL connections from this Replit.
---

Use the Supabase Session Pooler for this project's PostgreSQL connection. The direct database endpoint was unreachable from this Replit environment because it resolved to IPv6-only access. Keep the database password in a separate server-side secret; the anon key is not a database credential.

**Why:** The initial direct connection could not be reached, and Node did not trust the pooler's certificate chain without the project's root CA.

**How to apply:** Configure `SUPABASE_SESSION_POOLER_URL` and `SUPABASE_DB_PASSWORD`. Download the root certificate from Supabase Database Settings and set it as `SUPABASE_CA_CERT` to enable certificate verification. Without that CA, the connection remains TLS-encrypted but does not verify the server certificate.

Do not run startup DDL against Supabase-managed `storage.objects` from the app's Session Pooler connection. The app role may not own that table; keep bucket and Storage policy setup in the Supabase SQL Editor, using an owner-level session.

**Why:** The Session Pooler can connect successfully while still lacking ownership rights over Supabase-managed Storage tables, which can otherwise prevent the entire API from starting.

**How to apply:** Keep application migrations scoped to app-owned `public` tables. Configure or update `storage.objects` policies through `defesa-civil/supabase/schema.sql` in the Supabase SQL Editor.
