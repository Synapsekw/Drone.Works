---
type: moc
status: active
tags: [moc/operations]
related: ["[[00-north-star]]"]
---

# Operations — Map of Content

Current repository and research procedures:

- [Repository instructions](../../AGENTS.md)
- [Contributing](../../CONTRIBUTING.md)
- [Security policy](../../SECURITY.md)
- [Fixture handling](../../docs/testing/FIXTURE-POLICY.md)
- [Fixture manifest workflow](../../fixtures/README.md)
- [Parser isolation spike](../../spikes/dji-parser/README.md)
- [Internal reproducible parser build](../../spikes/dji-parser/internal-build/README.md)
- [Environment and deployment policy](../../docs/operations/ENVIRONMENTS.md)
- [Recovery, backup, deletion replay, and rollback](../../docs/operations/RECOVERY.md)
- [Development, beta, and benchmark cost envelope](../../docs/operations/COST-MODEL.md)

## Project-memory commands

```sh
scripts/vault-context.sh
node scripts/vault/verify.mjs
```

The Phase 0 operating baseline is accepted. Live AWS object conformance and a generated-data restore/deletion-replay drill remain Phase 1A gates before hosted customer data.
