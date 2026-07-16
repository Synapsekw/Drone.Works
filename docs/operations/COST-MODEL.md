# Phase 0 cost envelope

Status: planning baseline, not a quote
Last updated: 2026-07-16
Currency: USD per month, excluding tax

## Assumptions

The envelope uses the Local, Beta, and Benchmark profiles in
`QUALITY-ATTRIBUTES.md`, the D-008 measurement of 2.872 GB for 100,000 telemetry
objects plus 32.1 MB PostgreSQL metadata, and a deliberately conservative 10 MB
average retained raw log. Raw-log size, egress, and log volume are sensitivities,
not customer forecasts.

AWS pricing varies by region, date, commitment, and usage. The ranges below use
July 2026 public on-demand categories and include contingency rather than
claiming false precision. Refresh them in the AWS Pricing Calculator before any
spend approval. Do not treat a free tier as the operating model. Relevant public
categories are [EC2](https://aws.amazon.com/ec2/pricing/on-demand/),
[RDS PostgreSQL](https://aws.amazon.com/rds/postgresql/pricing/),
[S3](https://aws.amazon.com/s3/pricing/),
[CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), and
[SES](https://aws.amazon.com/ses/pricing/).

## Monthly envelope

| Profile | Compute | PostgreSQL + backup | S3 objects/requests | Logs, secrets, DNS, email, egress | Contingency | Total envelope |
|---|---:|---:|---:|---:|---:|---:|
| Local | $0 cloud | $0 cloud | $0 cloud | $0 cloud | $0 | **$0** |
| Ephemeral staging | $10–30 | $15–45 | $1–5 | $5–20 | $10 | **$40–110** |
| Beta: 10 orgs / 25k flights | $25–60 | $45–110 | $5–20 | $20–55 | $35 | **$130–280** |
| Benchmark: 100 orgs / 100k flights | $60–160 | $90–220 | $20–70 | $50–130 | $70 | **$290–650** |

Beta assumes roughly 250 GB raw logs, 0.72 GB encoded telemetry, one modest
always-on application host, Single-AZ RDS, 5 GB application logs, low email, and
bounded export/replay egress. Benchmark assumes roughly 1 TB raw logs and
capacity scaling, not one database row per telemetry frame. It does not include
paid map tiles, enterprise support, tax, DJI commercial fees, or a legal review;
those require quotes before activation.

## Alerts and approval thresholds

| Scope | Warning | Critical / action |
|---|---:|---:|
| Non-production monthly forecast | $75 | $110: stop idle hosted resources |
| Private beta monthly forecast | $200 | $280: owner approval before scaling |
| Benchmark exercise forecast | $500 | $650: do not start or continue without approval |
| Any service week-over-week | +25% | investigate before the next deploy |

Budgets alert at 50%, 80%, and 100% of the applicable threshold. Cost anomaly
detection alerts separately. Environment, service, and owner tags are mandatory;
untagged spend is an operational defect.

## Largest sensitivities

1. Raw-log average size and retention: every additional 10 MB per 100,000
   flights adds about 1 TB before versions.
2. Internet egress and generated exports: repeated full telemetry/raw downloads
   can exceed storage cost quickly; product limits remain authorization-aware and
   transparent.
3. RDS availability/size and observability volume: Multi-AZ, larger instances,
   verbose logs, and high trace sampling can dominate the baseline.

Re-estimate when raw averages exceed 20 MB, monthly egress exceeds retained
storage, logs exceed 10 GB, RDS CPU or memory is sustained above 70%, Multi-AZ is
required, provider-inclusive telemetry exceeds D-008 thresholds, or the beta
budget is changed by the repository owner.

