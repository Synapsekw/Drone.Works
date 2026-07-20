'use client';

import { useState } from 'react';

import { StatePill, Workspace, type WorkspaceIdentity } from './workspace';

const generatedOrganizations = {
  alpha_owner: '00000000-0000-4000-8000-0000000000a1',
  beta_owner: '00000000-0000-4000-8000-0000000000b1',
} as const;

type PersonaName = keyof typeof generatedOrganizations;

interface PersonaSelection {
  readonly persona: PersonaName;
  readonly token: string;
}

export function LocalWorkspace() {
  const [persona, setPersona] = useState<PersonaSelection | null>(null);
  const [state, setState] = useState<'empty' | 'loading' | 'success' | 'error'>(
    'empty',
  );
  const [message, setMessage] = useState('No persona selected.');

  const choosePersona = async (nextPersona: PersonaName) => {
    setPersona(null);
    setState('loading');
    setMessage('Generating a local development identity…');
    try {
      const response = await fetch('/_local/generated-personas/select', {
        body: JSON.stringify({ persona: nextPersona }),
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'POST',
      });
      if (!response.ok) throw new Error('Local identity control unavailable.');
      const selection = (await response.json()) as PersonaSelection;
      setPersona(selection);
      setState('success');
      setMessage(`Active persona: ${selection.persona.replace('_', ' ')}`);
    } catch {
      setState('error');
      setMessage('The local identity control could not be reached.');
    }
  };

  const identity: WorkspaceIdentity | null = persona
    ? {
        label: persona.persona.replace('_', ' '),
        token: persona.token,
      }
    : null;

  return (
    <Workspace
      key={persona?.token ?? 'no-persona'}
      environmentBadge={
        <>
          <strong>Local development identity</strong>
          <span>Generated personas are not authentication.</span>
          <span>This control is excluded from hosted builds.</span>
        </>
      }
      identity={identity}
      identityPanel={
        <>
          <div className="section-heading">
            <div>
              <p className="section-kicker">Development access</p>
              <h2 id="identity-heading">Choose a generated persona</h2>
            </div>
            <StatePill state={state} />
          </div>
          <p className="supporting-copy">
            The API resolves only its server allowlist. Membership and forced
            PostgreSQL RLS still authorize every organization operation.
          </p>
          <div
            className="button-row"
            role="group"
            aria-label="Generated persona"
          >
            <button
              type="button"
              onClick={() => void choosePersona('alpha_owner')}
            >
              Generated Alpha owner
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void choosePersona('beta_owner')}
            >
              Generated Beta owner
            </button>
          </div>
          <p className="state-line" aria-live="polite">
            {message}
          </p>
        </>
      }
      initialOrganizationId={
        generatedOrganizations[persona?.persona ?? 'alpha_owner']
      }
    />
  );
}
