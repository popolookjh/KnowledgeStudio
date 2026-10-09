/** Security boundary helpers for untrusted Markdown, links, logs and APIs. */

export type ExternalLinkKind = 'safe-external' | 'unsafe-scheme' | 'local-relative' | 'mailto';

/** Classifies a link without fetching it. Never follows network URLs. */
export function classifyLink(href: string): ExternalLinkKind {
  const trimmed = href.trim();
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  )
    return 'local-relative';
  const scheme = trimmed.slice(0, trimmed.indexOf(':')).toLowerCase();
  if (scheme === 'http' || scheme === 'https') return 'safe-external';
  if (scheme === 'mailto') return 'mailto';
  return 'unsafe-scheme';
}

export function isSafeExternalLink(href: string): boolean {
  return classifyLink(href) === 'safe-external';
}

/** Redacts common secret patterns from local structured logs. */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replace(
      /(api[_-]?key|token|secret|password|authorization)(\s*[=:]\s*)[^\s,}]+/gi,
      '$1$2[REDACTED]',
    );
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) =>
        /key|token|secret|password|authorization/i.test(key)
          ? [key, '[REDACTED]']
          : [key, redactSecrets(item)],
      ),
    );
  }
  return value;
}

export interface LogRecord {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly event: string;
  readonly timestamp: string;
  readonly details?: unknown;
}

export function createLogRecord(
  level: LogRecord['level'],
  event: string,
  details?: unknown,
  now = new Date(),
): LogRecord {
  return {
    level,
    event,
    timestamp: now.toISOString(),
    ...(details === undefined ? {} : { details: redactSecrets(details) }),
  };
}

/** Default-deny MCP policy: read-only tools only. */
export function isMcpToolAllowed(tool: string): boolean {
  return new Set([
    'search_notes',
    'read_note',
    'list_notes',
    'get_metadata',
    'get_backlinks',
    'get_outgoing_links',
    'search_tags',
  ]).has(tool);
}

/** Defense-in-depth file-size guard for attachments/imported content. */
export function isAcceptableFileSize(bytes: number, maxBytes = 100 * 1024 * 1024): boolean {
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= maxBytes;
}
