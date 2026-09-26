import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  baselines: defineTable({
    // Clerk subject (`identity.subject`), never an email or name.
    userId: v.string(),
    sha: v.string(),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),
});
