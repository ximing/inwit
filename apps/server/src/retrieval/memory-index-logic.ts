export function collectionEmbeddingText(title: string, description: string): string {
  return `${title.trim()}\n${description.trim()}`;
}

export function entryEmbeddingText(collectionTitle: string, body: string): string {
  return `${collectionTitle.trim()}\n${body.trim()}`;
}

export function memoryCollectionsStoreName(): string {
  return process.env.NODE_ENV === 'production'
    ? 'inwit_memory_collections_prod'
    : 'inwit_memory_collections_dev';
}

export function memoryEntriesStoreName(): string {
  return process.env.NODE_ENV === 'production'
    ? 'inwit_memory_entries_prod'
    : 'inwit_memory_entries_dev';
}
