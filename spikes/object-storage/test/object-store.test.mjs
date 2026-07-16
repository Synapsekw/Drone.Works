import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import {
  ImmutableObjectConflictError,
  MAX_SIGNED_DOWNLOAD_TTL_MS,
  VersionedObjectStore,
} from "../src/object-store.mjs";

const fixedNow = new Date("2026-07-16T12:00:00Z");
let providerNow = new Date(fixedNow);
let provider;
let objectStore;
let closeProvider;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function startLoopbackVersionedProvider() {
  const authorization = `test-${randomBytes(24).toString("hex")}`;
  const signingKey = randomBytes(32);
  const objects = new Map();

  function versionsFor(key) {
    return objects.get(key) ?? [];
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://loopback.invalid");
    if (url.pathname === "/download" && request.method === "GET") {
      const key = url.searchParams.get("key") ?? "";
      const versionId = url.searchParams.get("version") ?? "";
      const expires = url.searchParams.get("expires") ?? "";
      const signature = url.searchParams.get("signature") ?? "";
      const payload = `${key}\n${versionId}\n${expires}`;
      const expected = createHmac("sha256", signingKey).update(payload).digest("hex");
      if (!safeEqual(signature, expected) || Number(expires) <= providerNow.valueOf()) {
        response.writeHead(403, { "cache-control": "no-store" });
        response.end();
        return;
      }
      const version = versionsFor(key).find((entry) => entry.versionId === versionId);
      if (version === undefined) {
        response.writeHead(404, { "cache-control": "no-store" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "cache-control": "private, no-store",
        "content-disposition": "attachment",
        "content-type": version.contentType,
        "x-content-type-options": "nosniff",
      });
      response.end(version.bytes);
      return;
    }

    if (request.headers.authorization !== `Bearer ${authorization}`) {
      response.writeHead(401, { "cache-control": "no-store" });
      response.end();
      return;
    }

    if (url.pathname === "/objects" && request.method === "PUT") {
      const key = url.searchParams.get("key");
      if (request.headers["if-none-match"] === "*" && versionsFor(key).length > 0) {
        response.writeHead(412);
        response.end();
        return;
      }
      const bytes = await readBody(request);
      const checksumSha256 = request.headers["x-checksum-sha256"];
      if (digest(bytes) !== checksumSha256) {
        response.writeHead(400);
        response.end();
        return;
      }
      const version = {
        versionId: randomUUID(),
        bytes,
        contentType: request.headers["content-type"],
        checksumSha256,
      };
      objects.set(key, [...versionsFor(key), version]);
      response.writeHead(201, { "x-version-id": version.versionId });
      response.end();
      return;
    }

    if (url.pathname === "/objects" && request.method === "HEAD") {
      const key = url.searchParams.get("key");
      const requestedVersion = url.searchParams.get("version");
      const versions = versionsFor(key);
      const version = requestedVersion === null
        ? versions.at(-1)
        : versions.find((entry) => entry.versionId === requestedVersion);
      if (version === undefined) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "x-checksum-sha256": version.checksumSha256,
        "x-version-id": version.versionId,
      });
      response.end();
      return;
    }

    if (url.pathname === "/versions" && request.method === "GET") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const versions = [...objects.entries()].flatMap(([key, entries]) => (
        key.startsWith(prefix)
          ? entries.map((entry) => ({ key, versionId: entry.versionId }))
          : []
      ));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(versions));
      return;
    }

    if (url.pathname === "/objects" && request.method === "DELETE") {
      const key = url.searchParams.get("key");
      const versionId = url.searchParams.get("version");
      const remaining = versionsFor(key).filter((entry) => entry.versionId !== versionId);
      if (remaining.length === 0) {
        objects.delete(key);
      } else {
        objects.set(key, remaining);
      }
      response.writeHead(204);
      response.end();
      return;
    }

    if (url.pathname === "/sign" && request.method === "POST") {
      const body = JSON.parse((await readBody(request)).toString("utf8"));
      const payload = `${body.key}\n${body.versionId}\n${body.expires}`;
      const signature = createHmac("sha256", signingKey).update(payload).digest("hex");
      const signed = new URL("/download", `http://${server.address().address}:${server.address().port}`);
      signed.searchParams.set("key", body.key);
      signed.searchParams.set("version", body.versionId);
      signed.searchParams.set("expires", body.expires);
      signed.searchParams.set("signature", signature);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ url: signed.toString() }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://${server.address().address}:${server.address().port}`;
  const call = async (path, options = {}) => fetch(`${origin}${path}`, {
    ...options,
    headers: { ...options.headers, authorization: `Bearer ${authorization}` },
  });

  return {
    provider: {
      async putObject(input) {
        const response = await call(`/objects?key=${encodeURIComponent(input.key)}`, {
          method: "PUT",
          headers: {
            "content-type": input.contentType,
            "if-none-match": input.ifNoneMatch,
            "x-checksum-sha256": input.checksumSha256,
          },
          body: input.bytes,
        });
        if (response.status === 412) {
          throw Object.assign(new Error("conditional put failed"), { code: "PreconditionFailed" });
        }
        assert.equal(response.status, 201);
        return { versionId: response.headers.get("x-version-id") };
      },
      async headObject({ key, versionId }) {
        const query = new URLSearchParams({ key });
        if (versionId !== undefined) query.set("version", versionId);
        const response = await call(`/objects?${query}`, { method: "HEAD" });
        if (response.status === 404) return null;
        assert.equal(response.status, 200);
        return {
          versionId: response.headers.get("x-version-id"),
          checksumSha256: response.headers.get("x-checksum-sha256"),
        };
      },
      async listObjectVersions({ prefix }) {
        const response = await call(`/versions?prefix=${encodeURIComponent(prefix)}`);
        assert.equal(response.status, 200);
        return response.json();
      },
      async deleteObjectVersion({ key, versionId }) {
        const query = new URLSearchParams({ key, version: versionId });
        const response = await call(`/objects?${query}`, { method: "DELETE" });
        assert.equal(response.status, 204);
      },
      async signGetObject({ key, versionId, expiresAt }) {
        const response = await call("/sign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, versionId, expires: expiresAt.valueOf() }),
        });
        assert.equal(response.status, 200);
        return response.json();
      },
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
      )));
    },
  };
}

before(async () => {
  const loopback = await startLoopbackVersionedProvider();
  provider = loopback.provider;
  closeProvider = loopback.close;
  objectStore = new VersionedObjectStore(provider, { now: () => new Date(fixedNow) });
});

after(async () => closeProvider());

test("conditional upload is immutable and checksum-confirmed", async () => {
  const objectKey = "organizations/org-alpha/raw-sources/raw-1/revisions/source.bin";
  const bytes = Buffer.from("synthetic-object-alpha");
  const first = await objectStore.putIfAbsent({
    objectKey,
    bytes,
    contentType: "application/octet-stream",
    sha256: digest(bytes),
  });
  assert.equal(first.stored, true);
  const retry = await objectStore.putIfAbsent({
    objectKey,
    bytes,
    contentType: "application/octet-stream",
    sha256: digest(bytes),
  });
  assert.deepEqual(retry, { ...first, stored: false });

  const different = Buffer.from("different-synthetic-object");
  await assert.rejects(
    objectStore.putIfAbsent({
      objectKey,
      bytes: different,
      contentType: "application/octet-stream",
      sha256: digest(different),
    }),
    ImmutableObjectConflictError,
  );
});

test("signed retrieval is exact-version, bounded, private, and expires", async () => {
  const objectKey = "organizations/org-alpha/exports/export-1/artifact.json";
  const bytes = Buffer.from('{"synthetic":true}');
  const stored = await objectStore.putIfAbsent({
    objectKey,
    bytes,
    contentType: "application/json",
    sha256: digest(bytes),
  });
  const signed = await objectStore.issueDownload({
    objectKey,
    versionId: stored.versionId,
    ttlMs: 5_000,
  });
  const live = await fetch(signed.url);
  assert.equal(live.status, 200);
  assert.equal(live.headers.get("cache-control"), "private, no-store");
  assert.equal(live.headers.get("content-disposition"), "attachment");
  assert.equal(live.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await live.arrayBuffer()), bytes);

  const tamperedUrl = new URL(signed.url);
  tamperedUrl.searchParams.set("expires", String(fixedNow.valueOf() + 10_000));
  const tampered = await fetch(tamperedUrl);
  assert.equal(tampered.status, 403);

  providerNow = new Date(fixedNow.valueOf() + 5_001);
  const expired = await fetch(signed.url);
  assert.equal(expired.status, 403);
  providerNow = new Date(fixedNow);

  await assert.rejects(
    objectStore.issueDownload({
      objectKey,
      versionId: stored.versionId,
      ttlMs: MAX_SIGNED_DOWNLOAD_TTL_MS + 1,
    }),
    RangeError,
  );
});

test("organization purge deletes every version, verifies absence, and preserves peers", async () => {
  const alphaObjects = [
    "organizations/org-delete/raw-sources/raw-2/revisions/source.bin",
    "organizations/org-delete/telemetry/flight-1/v1.bin",
  ];
  const betaKey = "organizations/org-retain/telemetry/flight-2/v1.bin";
  for (const key of [...alphaObjects, betaKey]) {
    const bytes = Buffer.from(`synthetic:${key}`);
    await objectStore.putIfAbsent({
      objectKey: key,
      bytes,
      contentType: "application/octet-stream",
      sha256: digest(bytes),
    });
  }

  const receipt = await objectStore.purgePrefix("organizations/org-delete/");
  assert.equal(receipt.deletedVersions, 2);
  assert.equal(receipt.verifiedAt, fixedNow.toISOString());
  assert.match(receipt.prefixSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    await provider.listObjectVersions({ prefix: "organizations/org-delete/" }),
    [],
  );
  assert.equal(
    (await provider.listObjectVersions({ prefix: "organizations/org-retain/" })).length,
    1,
  );

  const retry = await objectStore.purgePrefix("organizations/org-delete/");
  assert.equal(retry.deletedVersions, 0);
});
