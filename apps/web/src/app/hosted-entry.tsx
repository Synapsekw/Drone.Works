'use client';

import { type FormEvent, useEffect, useState } from 'react';

import { Workspace } from './workspace';

interface VerifiedSession {
  readonly user: {
    readonly email: string;
    readonly emailVerified: boolean;
    readonly id: string;
    readonly name: string;
  };
}

type AuthState = 'loading' | 'reset-password' | 'signed-out' | 'signed-in';

async function authRequest(path: string, body?: Record<string, unknown>) {
  return fetch(path, {
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    method: body ? 'POST' : 'GET',
  });
}

export function WebEntry() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [session, setSession] = useState<VerifiedSession | null>(null);
  const [message, setMessage] = useState('Checking the current session…');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<
    { organizationId: string; token: string } | undefined
  >();

  const loadSession = async () => {
    setAuthState('loading');
    const response = await authRequest('/api/auth/get-session');
    const current = response.ok
      ? ((await response.json()) as VerifiedSession | null)
      : null;
    if (current?.user.emailVerified) {
      setSession(current);
      setAuthState('signed-in');
      setMessage('Verified session active.');
      return;
    }
    setSession(null);
    setAuthState('signed-out');
    setMessage('Sign in with a verified email to continue.');
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const passwordToken = query.get('token');
    if (passwordToken && query.get('auth_action') === 'reset') {
      setResetToken(passwordToken);
      setAuthState('reset-password');
      setMessage('Choose a new password to finish recovery.');
      return;
    }
    const organizationId = query.get('organization_id');
    const token = query.get('invitation_token');
    if (organizationId && token) setInvitation({ organizationId, token });
    void loadSession();
  }, []);

  const submit = async (
    event: FormEvent<HTMLFormElement>,
    operation: 'register' | 'request-reset' | 'reset-password' | 'sign-in',
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    setMessage('Working…');
    const response =
      operation === 'register'
        ? await authRequest('/api/auth/sign-up/email', {
            email,
            name: String(data.get('name') ?? '').trim(),
            password: String(data.get('password') ?? ''),
          })
        : operation === 'request-reset'
          ? await authRequest('/api/auth/request-password-reset', {
              email,
              redirectTo: `${window.location.origin}/?auth_action=reset`,
            })
          : operation === 'reset-password'
            ? await authRequest('/api/auth/reset-password', {
                newPassword: String(data.get('password') ?? ''),
                token: resetToken,
              })
            : await authRequest('/api/auth/sign-in/email', {
                email,
                password: String(data.get('password') ?? ''),
              });
    if (!response.ok) {
      setMessage(
        response.status === 403
          ? 'Email verification is required, or this request is not allowed.'
          : response.status === 429
            ? 'Too many attempts. Wait before trying again.'
            : 'The authentication request could not be completed.',
      );
      return;
    }
    if (operation === 'sign-in') {
      await loadSession();
      return;
    }
    if (operation === 'reset-password') {
      window.history.replaceState({}, '', '/');
      setResetToken(null);
      setAuthState('signed-out');
      setMessage('Password reset complete. Sign in with the new password.');
      return;
    }
    setMessage(
      operation === 'register'
        ? 'Registration received. Open the verification link from local email capture, then sign in.'
        : 'If the address is registered, a time-limited recovery link is now available.',
    );
  };

  const signOut = async () => {
    await authRequest('/api/auth/sign-out', {});
    setSession(null);
    setAuthState('signed-out');
    setMessage('Signed out. Organization-bound browser state was cleared.');
  };

  if (authState === 'signed-in' && session) {
    return (
      <Workspace
        environmentBadge={
          <>
            <strong>Verified web session</strong>
            <span>
              Identity comes from the pinned self-hosted session provider.
            </span>
            <span>Organization roles remain app-owned and RLS-enforced.</span>
          </>
        }
        identity={{ label: session.user.name, token: '' }}
        identityPanel={
          <>
            <div className="section-heading">
              <div>
                <p className="section-kicker">Verified access</p>
                <h2 id="identity-heading">Current verified user</h2>
              </div>
              <span className="state-pill success">Ready</span>
            </div>
            <p className="supporting-copy">
              {session.user.name} · {session.user.email}. The provider supplies
              only the current session and user IDs; membership and forced
              PostgreSQL RLS authorize each operation.
            </p>
            <button
              className="secondary-button"
              onClick={() => void signOut()}
              type="button"
            >
              Sign out and clear workspace
            </button>
          </>
        }
        {...(invitation ? { invitation } : {})}
        verifiedIdentity={{
          displayName: session.user.name,
          email: session.user.email,
        }}
      />
    );
  }

  if (authState === 'reset-password' && resetToken) {
    return (
      <main className="hosted-shell auth-shell">
        <p className="eyebrow">Drone.Works</p>
        <h1>Reset password</h1>
        <div className="auth-status" role="status" aria-live="polite">
          {message}
        </div>
        <section className="auth-card" aria-labelledby="reset-heading">
          <h2 id="reset-heading">Choose a new password</h2>
          <form
            className="auth-form"
            onSubmit={(event) => void submit(event, 'reset-password')}
          >
            <label>
              New password
              <input
                autoComplete="new-password"
                maxLength={128}
                minLength={12}
                name="password"
                required
                type="password"
              />
            </label>
            <button type="submit">Reset password</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="hosted-shell auth-shell">
      <p className="eyebrow">Drone.Works</p>
      <h1>Verified access</h1>
      <p className="lede">
        Identity comes from the pinned self-hosted session provider.
        Organizations, invitations, memberships, and roles remain Drone.Works
        records protected by forced PostgreSQL RLS.
      </p>
      <div className="auth-status" role="status" aria-live="polite">
        {message}
      </div>
      <section className="auth-card" aria-labelledby="sign-in-heading">
        <h2 id="sign-in-heading">Sign in</h2>
        <form
          className="auth-form"
          onSubmit={(event) => void submit(event, 'sign-in')}
        >
          <label>
            Verified email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              minLength={12}
              name="password"
              required
              type="password"
            />
          </label>
          <button disabled={authState === 'loading'} type="submit">
            Sign in
          </button>
        </form>
      </section>
      <details className="auth-card">
        <summary>Register a verified user</summary>
        <form
          className="auth-form"
          onSubmit={(event) => void submit(event, 'register')}
        >
          <label>
            Display name
            <input autoComplete="name" maxLength={200} name="name" required />
          </label>
          <label>
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Password
            <input
              autoComplete="new-password"
              minLength={12}
              name="password"
              required
              type="password"
            />
          </label>
          <button type="submit">Register and send verification</button>
        </form>
      </details>
      <details className="auth-card">
        <summary>Recover access</summary>
        <form
          className="auth-form"
          onSubmit={(event) => void submit(event, 'request-reset')}
        >
          <label>
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <button type="submit">Send recovery link</button>
        </form>
      </details>
    </main>
  );
}
