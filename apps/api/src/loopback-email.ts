import type { AuthEmailDelivery } from './auth.js';

export class LoopbackEmailDelivery implements AuthEmailDelivery {
  readonly #baseUrl: URL;

  constructor(baseUrl: string) {
    this.#baseUrl = new URL(baseUrl);
  }

  async send(message: {
    readonly kind:
      'account-deletion' | 'invitation' | 'password-reset' | 'verification';
    readonly recipient: string;
    readonly url: string;
  }): Promise<void> {
    const response = await fetch(new URL('/messages', this.#baseUrl), {
      body: JSON.stringify(message),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Authentication email delivery is unavailable.');
    }
  }
}
