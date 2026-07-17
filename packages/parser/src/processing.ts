import type { PrivateParserIntermediate } from './intermediate.js';
import {
  KeychainBroker,
  type KeychainContext,
  type KeychainFailureCode,
  type PrivateKeychainResolution,
} from './keychain.js';
import type {
  ExactParserSource,
  ParserFailure,
  ParserSupervisor,
} from './supervisor.js';

export interface DjiParserOperations {
  buildKeychainRequest(
    source: ExactParserSource,
  ): ReturnType<ParserSupervisor['buildKeychainRequest']>;
  run(
    source: ExactParserSource,
    privateInput: Buffer,
  ): ReturnType<ParserSupervisor['run']>;
}

export interface DjiKeychainProcessingFailure {
  readonly failureCode: KeychainFailureCode;
  readonly schemaVersion: 1;
  readonly status: 'keychain_failed';
}

export type DjiV14ProcessingResult =
  DjiKeychainProcessingFailure | ParserFailure | PrivateParserIntermediate;

function keychainFailed(
  failureCode: KeychainFailureCode,
): DjiKeychainProcessingFailure {
  return Object.freeze({
    failureCode,
    schemaVersion: 1,
    status: 'keychain_failed',
  });
}

export class DjiV14ProcessingService {
  readonly #broker: KeychainBroker;
  readonly #parser: DjiParserOperations;

  constructor(
    input: Readonly<{
      broker: KeychainBroker;
      parser: DjiParserOperations;
    }>,
  ) {
    this.#broker = input.broker;
    this.#parser = input.parser;
  }

  async process(
    context: KeychainContext,
    source: ExactParserSource,
  ): Promise<DjiV14ProcessingResult> {
    let requestFailure: ParserFailure | null = null;
    let resolved: PrivateKeychainResolution;
    try {
      resolved = await this.#broker.resolve(context, async () => {
        const result = await this.#parser.buildKeychainRequest(source);
        if ('failureCode' in result) {
          requestFailure = result;
          throw new Error('The parser could not construct a keychain request.');
        }
        return result.consume();
      });
    } catch {
      if (requestFailure) return requestFailure;
      return keychainFailed('key_service_unavailable');
    }

    const privateInput = resolved.consumeForParser();
    if (!privateInput) {
      resolved.destroy();
      return keychainFailed(
        resolved.summary.failureCode ?? 'key_service_unavailable',
      );
    }
    try {
      return await this.#parser.run(source, privateInput);
    } finally {
      privateInput.fill(0);
      resolved.destroy();
    }
  }
}
