export function collectionEmbeddingText(title: string, description: string): string {
  return `${title.trim()}\n${description.trim()}`;
}

export function entryEmbeddingText(collectionTitle: string, body: string): string {
  return `${collectionTitle.trim()}\n${body.trim()}`;
}

function memoryStoreSuffix(nodeEnv: string | undefined): 'prod' | 'dev' {
  return nodeEnv === 'production' ? 'prod' : 'dev';
}

export function memoryCollectionsStoreName(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  return `inwit_memory_collections_${memoryStoreSuffix(nodeEnv)}`;
}

export function memoryEntriesStoreName(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  return `inwit_memory_entries_${memoryStoreSuffix(nodeEnv)}`;
}
