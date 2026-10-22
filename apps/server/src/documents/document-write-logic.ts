import type { DocumentSource, DocumentStatus } from '@inwit/dto';

export type DocumentWriteReason = 'create_user' | 'create_agent' | 'save_user' | 'save_agent';

export interface InsertWritePlan {
  source: DocumentSource;
  status: DocumentStatus;
  enqueueDigest: boolean;
  digestDelayMs: number;
  /** Embed after the insert. A delayed digest indexes when it finishes. */
  indexAfterInsert: boolean;
  /** Non-blank user creates resolve a model before the insert transaction. */
  resolveModel: boolean;
}

/**
 * Insert policy. Conversation creates stay digested and are not queued.
 * User editor creates stay pending and digest only after the idle delay.
 */
export function planDocumentInsert(args: {
  reason: Extract<DocumentWriteReason, 'create_user' | 'create_agent'>;
  blank: boolean;
  source: DocumentSource;
  idleDelayMs: number;
}): InsertWritePlan {
  if (args.reason === 'create_agent') {
    return {
      source: 'editor',
      status: 'digested',
      enqueueDigest: false,
      digestDelayMs: 0,
      indexAfterInsert: true,
      resolveModel: false,
    };
  }

  // Editor documents are still being written; digest once the user pauses.
  const digestDelayMs = !args.blank && args.source === 'editor' ? args.idleDelayMs : 0;
  return {
    source: args.source,
    status: args.blank ? 'digested' : 'pending',
    enqueueDigest: !args.blank,
    digestDelayMs,
    // A delayed digest indexes the document when it finishes; don't embed drafts.
    indexAfterInsert: !args.blank && digestDelayMs === 0,
    resolveModel: !args.blank,
  };
}

export interface SaveWritePlan {
  /** User saves keep planDigestOnSave. Agent replaces do not enqueue. */
  digest: 'plan_on_save' | 'none';
  /** Only a user digest enqueue may set status to pending. */
  maySetPending: boolean;
  /** Agent replaces always reindex. User saves skip while a digest is planned. */
  index: 'always' | 'unless_digest_planned';
}

export function planDocumentSave(
  reason: Extract<DocumentWriteReason, 'save_user' | 'save_agent'>,
): SaveWritePlan {
  if (reason === 'save_agent') {
    return { digest: 'none', maySetPending: false, index: 'always' };
  }
  return { digest: 'plan_on_save', maySetPending: true, index: 'unless_digest_planned' };
}
