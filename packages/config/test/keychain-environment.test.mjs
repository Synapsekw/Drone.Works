import { describe, expect, it } from 'vitest';

import { readDjiKeychainEnvironment } from '../dist/index.js';

describe('A09 DJI provider configuration interlock', () => {
  it('is disabled unless the explicit provider flag is true', () => {
    expect(readDjiKeychainEnvironment({})).toEqual({ ENABLED: false });
    expect(
      readDjiKeychainEnvironment({
        DRONE_WORKS_DJI_KMS_KEY_REFERENCE: 'kms://ignored',
        DRONE_WORKS_DJI_SECRET_REFERENCE: 'secret://ignored',
      }),
    ).toEqual({ ENABLED: false });
  });

  it('rejects enabled startup without every approved reference and version', () => {
    expect(() =>
      readDjiKeychainEnvironment({
        DRONE_WORKS_DJI_PROVIDER_ENABLED: 'true',
      }),
    ).toThrow('Invalid DJI keychain provider configuration');
    expect(() =>
      readDjiKeychainEnvironment({
        DRONE_WORKS_DJI_KMS_KEY_REFERENCE: 'raw-key-value',
        DRONE_WORKS_DJI_KMS_KEY_VERSION: 'v1',
        DRONE_WORKS_DJI_NOTICE_VERSION: 'notice-v1',
        DRONE_WORKS_DJI_PROVIDER_ENABLED: 'true',
        DRONE_WORKS_DJI_SECRET_REFERENCE: 'raw-secret-value',
        DRONE_WORKS_DJI_TERMS_VERSION: 'terms-v1',
      }),
    ).toThrow('Invalid DJI keychain provider configuration');
  });

  it('accepts references but never accepts secret or key material directly', () => {
    expect(
      readDjiKeychainEnvironment({
        DRONE_WORKS_DJI_KMS_KEY_REFERENCE: 'kms://droneworks/dji-cache',
        DRONE_WORKS_DJI_KMS_KEY_VERSION: 'v1',
        DRONE_WORKS_DJI_NOTICE_VERSION: 'notice-v1',
        DRONE_WORKS_DJI_PROVIDER_ENABLED: 'true',
        DRONE_WORKS_DJI_SECRET_REFERENCE: 'secret://droneworks/dji-api',
        DRONE_WORKS_DJI_TERMS_VERSION: 'terms-2024-01-25',
      }),
    ).toEqual({
      ENABLED: true,
      KMS_KEY_REFERENCE: 'kms://droneworks/dji-cache',
      KMS_KEY_VERSION: 'v1',
      NOTICE_VERSION: 'notice-v1',
      SECRET_REFERENCE: 'secret://droneworks/dji-api',
      TERMS_VERSION: 'terms-2024-01-25',
    });
  });
});
