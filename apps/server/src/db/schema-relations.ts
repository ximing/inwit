import { relations } from 'drizzle-orm';
import { accessTokenLogs, accessTokens, llmConfigs, ocrConfigs, users } from './schema-auth.js';
import { mapNodes, topics } from './schema-topic.js';
import { annotations, documents } from './schema-document.js';
import { cardFeedback, cardLinks, cardQuestions, cards, reviewLogs, reviewStates } from './schema-card.js';
import { memories, memoryCollections, memoryEntries, memoryRevisions } from './schema-memory.js';
import { agentExecutions, jobs, llmUsageLogs, ocrPages } from './schema-job.js';

export const usersRelations = relations(users, ({ many }) => ({
  llmConfigs: many(llmConfigs),
  ocrConfigs: many(ocrConfigs),
  accessTokens: many(accessTokens),
  accessTokenLogs: many(accessTokenLogs),
  topics: many(topics),
  documents: many(documents),
  annotations: many(annotations),
  cards: many(cards),
  cardLinks: many(cardLinks),
  reviewStates: many(reviewStates),
  reviewLogs: many(reviewLogs),
  memories: many(memories),
  cardFeedback: many(cardFeedback),
  memoryCollections: many(memoryCollections),
  memoryEntries: many(memoryEntries),
  memoryRevisions: many(memoryRevisions),
  jobs: many(jobs),
  agentExecutions: many(agentExecutions),
  llmUsageLogs: many(llmUsageLogs),
}));

export const accessTokensRelations = relations(accessTokens, ({ one, many }) => ({
  user: one(users, { fields: [accessTokens.userId], references: [users.id] }),
  logs: many(accessTokenLogs),
}));

export const accessTokenLogsRelations = relations(accessTokenLogs, ({ one }) => ({
  user: one(users, { fields: [accessTokenLogs.userId], references: [users.id] }),
  accessToken: one(accessTokens, {
    fields: [accessTokenLogs.accessTokenId],
    references: [accessTokens.id],
  }),
}));

export const llmConfigsRelations = relations(llmConfigs, ({ one }) => ({
  user: one(users, { fields: [llmConfigs.userId], references: [users.id] }),
}));

export const ocrConfigsRelations = relations(ocrConfigs, ({ one }) => ({
  user: one(users, { fields: [ocrConfigs.userId], references: [users.id] }),
}));

export const topicsRelations = relations(topics, ({ one, many }) => ({
  user: one(users, { fields: [topics.userId], references: [users.id] }),
  documents: many(documents),
  cards: many(cards),
  mapNodes: many(mapNodes),
}));

export const mapNodesRelations = relations(mapNodes, ({ one, many }) => ({
  topic: one(topics, { fields: [mapNodes.topicId], references: [topics.id] }),
  parent: one(mapNodes, {
    fields: [mapNodes.parentId],
    references: [mapNodes.id],
    relationName: 'mapNodeParent',
  }),
  children: many(mapNodes, { relationName: 'mapNodeParent' }),
  documents: many(documents),
  cards: many(cards),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  user: one(users, { fields: [documents.userId], references: [users.id] }),
  topic: one(topics, { fields: [documents.topicId], references: [topics.id] }),
  mapNode: one(mapNodes, { fields: [documents.mapNodeId], references: [mapNodes.id] }),
  cards: many(cards),
  annotations: many(annotations),
  cardFeedback: many(cardFeedback),
  ocrPages: many(ocrPages),
}));

export const annotationsRelations = relations(annotations, ({ one }) => ({
  user: one(users, { fields: [annotations.userId], references: [users.id] }),
  document: one(documents, { fields: [annotations.documentId], references: [documents.id] }),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  user: one(users, { fields: [cards.userId], references: [users.id] }),
  document: one(documents, { fields: [cards.documentId], references: [documents.id] }),
  topic: one(topics, { fields: [cards.topicId], references: [topics.id] }),
  mapNode: one(mapNodes, { fields: [cards.mapNodeId], references: [mapNodes.id] }),
  questions: many(cardQuestions),
  reviewStates: many(reviewStates),
  reviewLogs: many(reviewLogs),
  outgoingLinks: many(cardLinks, { relationName: 'fromCard' }),
  incomingLinks: many(cardLinks, { relationName: 'toCard' }),
  feedback: many(cardFeedback),
}));

export const cardLinksRelations = relations(cardLinks, ({ one }) => ({
  user: one(users, { fields: [cardLinks.userId], references: [users.id] }),
  fromCard: one(cards, {
    fields: [cardLinks.fromCardId],
    references: [cards.id],
    relationName: 'fromCard',
  }),
  toCard: one(cards, {
    fields: [cardLinks.toCardId],
    references: [cards.id],
    relationName: 'toCard',
  }),
}));

export const cardQuestionsRelations = relations(cardQuestions, ({ one }) => ({
  card: one(cards, { fields: [cardQuestions.cardId], references: [cards.id] }),
}));

export const reviewStatesRelations = relations(reviewStates, ({ one }) => ({
  user: one(users, { fields: [reviewStates.userId], references: [users.id] }),
  card: one(cards, { fields: [reviewStates.cardId], references: [cards.id] }),
}));

export const reviewLogsRelations = relations(reviewLogs, ({ one }) => ({
  user: one(users, { fields: [reviewLogs.userId], references: [users.id] }),
  card: one(cards, { fields: [reviewLogs.cardId], references: [cards.id] }),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  user: one(users, { fields: [memories.userId], references: [users.id] }),
}));

export const cardFeedbackRelations = relations(cardFeedback, ({ one }) => ({
  user: one(users, { fields: [cardFeedback.userId], references: [users.id] }),
  card: one(cards, { fields: [cardFeedback.cardId], references: [cards.id] }),
  document: one(documents, { fields: [cardFeedback.documentId], references: [documents.id] }),
  organizeJob: one(jobs, { fields: [cardFeedback.organizeJobId], references: [jobs.id] }),
}));

export const memoryCollectionsRelations = relations(memoryCollections, ({ one, many }) => ({
  user: one(users, { fields: [memoryCollections.userId], references: [users.id] }),
  entries: many(memoryEntries),
}));

export const memoryEntriesRelations = relations(memoryEntries, ({ one }) => ({
  user: one(users, { fields: [memoryEntries.userId], references: [users.id] }),
  collection: one(memoryCollections, {
    fields: [memoryEntries.collectionId],
    references: [memoryCollections.id],
  }),
}));

export const memoryRevisionsRelations = relations(memoryRevisions, ({ one }) => ({
  user: one(users, { fields: [memoryRevisions.userId], references: [users.id] }),
  job: one(jobs, { fields: [memoryRevisions.jobId], references: [jobs.id] }),
  execution: one(agentExecutions, {
    fields: [memoryRevisions.executionId],
    references: [agentExecutions.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  user: one(users, { fields: [jobs.userId], references: [users.id] }),
  executions: many(agentExecutions),
  ocrPages: many(ocrPages),
  cardFeedback: many(cardFeedback),
  memoryRevisions: many(memoryRevisions),
}));

export const ocrPagesRelations = relations(ocrPages, ({ one }) => ({
  job: one(jobs, { fields: [ocrPages.jobId], references: [jobs.id] }),
  document: one(documents, { fields: [ocrPages.documentId], references: [documents.id] }),
}));

export const agentExecutionsRelations = relations(agentExecutions, ({ one, many }) => ({
  user: one(users, { fields: [agentExecutions.userId], references: [users.id] }),
  job: one(jobs, { fields: [agentExecutions.jobId], references: [jobs.id] }),
  usageLogs: many(llmUsageLogs),
  memoryRevisions: many(memoryRevisions),
}));

export const llmUsageLogsRelations = relations(llmUsageLogs, ({ one }) => ({
  user: one(users, { fields: [llmUsageLogs.userId], references: [users.id] }),
  execution: one(agentExecutions, {
    fields: [llmUsageLogs.executionId],
    references: [agentExecutions.id],
  }),
}));
