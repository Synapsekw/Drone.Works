# Versioned object lifecycle proof

This Docker-free Phase 0 proof exercises the application-owned contract selected
for private Amazon S3 storage. A loopback HTTP service behaves as a versioned
provider so the test crosses a real serialization, authorization, signing, and
HTTP boundary without cloud credentials.

```sh
npm test
```

The proof covers checksum-bound conditional upload, immutable retry/collision,
exact-version signed download, 15-minute maximum expiry, signature tampering,
private response headers, permanent version enumeration/deletion,
cross-organization prefix preservation, absence verification, and idempotent
retry.

It does not claim live AWS IAM, KMS, bucket-policy, CloudTrail, latency, or S3
conformance. Phase 1A must run the same contract against a temporary private AWS
bucket and destroy it before hosted customer data is authorized.

