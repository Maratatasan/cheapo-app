# Hosting decision for the Cheapo beta

**19 November 2026.** The project owner chose AWS for Cheapo’s household and
invite-only friends beta. The proposed target is Aurora PostgreSQL Serverless
v2 with a 15-minute idle pause and private Amazon S3 photo storage in Stockholm.
Keep PostgreSQL migrations portable and store object keys and content hashes
independently of temporary access URLs.

This is a provider decision. The current AWS Free plan allows Aurora only
through Express configuration, which requires an internet PostgreSQL gateway.
The proposed private VPC database requires a Paid-plan decision and explicit
provisioning approval. The [deployment proposal](README.md) tracks that gate.
[AWS Free Tier restrictions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-free-tier.html) ·
[Aurora Express restrictions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_GettingStartedAurora.AuroraPostgreSQL.ExpressConfig.html)

## When to revisit the decision

The Cheapo project owner, with the infrastructure maintainer, reviews the
first full representative month of beta usage. Review again when forecast or
actual recurring AWS cost exceeds a current equivalent Neon or Supabase
option, or when usage materially changes. Use ongoing prices before credits
and compare matching regions, workloads, privacy and recovery requirements.

Record active database capacity and pause frequency, database size and I/O,
backup retention and restore results, photo bytes and downloads, API requests
and runtime, active users, and maintenance time. Compare database compute,
storage, I/O, backups and credentials alongside photos and transfer, API
execution, authentication, and operator effort. Check the competing plans at
the review and include the one-time data, auth, and application switching work.
Equivalent Neon and Supabase totals are pending measurement and pricing.
A review can retain AWS, tune the setup, or propose a separately approved
migration. No monitoring or automatic switch is configured by this decision.

Tracked in [#176](https://github.com/Maratatasan/cheapo-app/issues/176) and
[PR #177](https://github.com/Maratatasan/cheapo-app/pull/177), with the
[Cheapo decision log](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit)
as the project record.
