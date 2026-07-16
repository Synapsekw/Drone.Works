import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OrganizationContextError extends Error {
  constructor() {
    super('A valid organization ID is required before acquiring a connection.');
    this.name = 'OrganizationContextError';
  }
}

export interface OrganizationTransaction {
  readonly organizationId: string;
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface OrganizationPool {
  connect(): Promise<PoolClient>;
}

class ScopedOrganizationTransaction implements OrganizationTransaction {
  readonly organizationId: string;
  #active = true;
  readonly #client: PoolClient;

  constructor(client: PoolClient, organizationId: string) {
    this.#client = client;
    this.organizationId = organizationId;
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    if (!this.#active) {
      throw new Error('Organization transaction is no longer active.');
    }
    return this.#client.query<Row>(text, [...values]);
  }

  close(): void {
    this.#active = false;
  }
}

export function requireOrganizationId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new OrganizationContextError();
  }
  return value.toLowerCase();
}

export async function withOrganizationTransaction<Result>(
  pool: OrganizationPool,
  organizationId: unknown,
  operation: (transaction: OrganizationTransaction) => Promise<Result>,
): Promise<Result> {
  const requiredOrganizationId = requireOrganizationId(organizationId);
  const client = await pool.connect();
  const transaction = new ScopedOrganizationTransaction(
    client,
    requiredOrganizationId,
  );

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      requiredOrganizationId,
    ]);
    const result = await operation(transaction);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    transaction.close();
    client.release();
  }
}
