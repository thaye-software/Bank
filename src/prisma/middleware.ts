// Prisma 7 removed $use middleware. Slow-query logging is wired directly in
// src/prisma/client.ts via the $on('query') events API.
// Soft-delete filtering is handled explicitly in each repository (deletedAt: null).
// This file is retained as an extension point for future cross-cutting concerns.
export {};
