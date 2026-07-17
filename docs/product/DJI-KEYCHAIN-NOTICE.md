# DJI encrypted-log processing notice

Notice version: `dji-keychain-notice-v1`
Terms-review reference: `dji-flight-record-api-review-2026-07-17`
Status: approved for the Phase 1A supported variant

## User-facing notice

This DJI flight log is encrypted. To process it, Drone.Works will send a bounded
key request derived from this file to DJI's Flight Record API. The request may
contain encrypted DJI metadata and DJI feature identifiers. Drone.Works does not
send the complete flight log in this request.

DJI processes the request under its applicable developer and privacy terms.
Drone.Works stores the returned decoding keychain encrypted and scoped to this
organization, source, parser, and log version. It is removed when decoding use is
revoked, the source is permanently deleted, or the organization is deleted.

The user may choose **Approve and process** or **Cancel**. Cancel sends nothing to
DJI. Approval records the notice and terms-review versions, actor, source, and
time without recording the request, response, key values, feature-point values,
flight coordinates, or other payload data.

Permission to use a cached keychain and permission to contact DJI are separate.
Disabling future DJI processing does not prevent an already-authorized encrypted
cache entry from being used. Revoking keychain use deletes that source's cached
entry and prevents decoding.
