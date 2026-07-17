export const supportedDjiFormats = Object.freeze([
  Object.freeze({
    application: 'DJI Fly',
    formatFamily: 'dji_txt',
    formatVersion: 14,
  }),
] as const);

export type DjiFormatSupport =
  | Readonly<{ status: 'supported' }>
  | Readonly<{
      failureCode: 'unsupported_format' | 'unsupported_version';
      status: 'unsupported';
    }>;

export function classifyDjiFormat(
  input: Readonly<{
    formatFamily: string;
    formatVersion: number;
  }>,
): DjiFormatSupport {
  if (input.formatFamily !== 'dji_txt') {
    return { failureCode: 'unsupported_format', status: 'unsupported' };
  }
  if (
    !Number.isSafeInteger(input.formatVersion) ||
    !supportedDjiFormats.some(
      (format) => format.formatVersion === input.formatVersion,
    )
  ) {
    return { failureCode: 'unsupported_version', status: 'unsupported' };
  }
  return { status: 'supported' };
}
