# @droneworks/dji-log-parser

Internally built DJI log parser for the Drone.Works isolated parser process.

This package is derived from `dji-log-parser-js@0.5.7` at the source commit recorded in `artifact-manifest.json`. It is not published to npm.

Drone.Works changes are intentionally narrow:

- replace the unmaintained `tsify-next` dependency with maintained `tsify`;
- remove WebAssembly key-service networking and the `fetchKeychains` export;
- retain local request construction and offline keychain decoding;
- ship the upstream license, target-specific CycloneDX SBOM, and third-party license bundle.

The package must still run inside the no-network, resource-limited parser boundary. Key retrieval belongs to the trusted broker.
