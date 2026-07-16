import { Pool, type QueryResult, type QueryResultRow } from 'pg';

import type { OrganizationPool } from './organization-transaction.js';

export interface ApplicationPoolConfiguration {
  readonly database: string;
  readonly host: string;
  readonly max?: number;
  readonly port: number;
  readonly user: 'droneworks_app';
}

export interface ApplicationPool extends OrganizationPool {
  end(): Promise<void>;
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export function createApplicationPool(
  configuration: ApplicationPoolConfiguration,
): ApplicationPool {
  return new Pool({
    database: configuration.database,
    host: configuration.host,
    max: configuration.max ?? 10,
    port: configuration.port,
    user: configuration.user,
  });
}
