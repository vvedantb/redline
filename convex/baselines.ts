import { mutationGeneric as mutation, queryGeneric as query } from 'convex/server';
import { v } from 'convex/values';

// Uses the generic builders so the repo does not need committed `convex/_generated` files.

async function requireUser(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('Not signed in');
  return identity.subject;
}

/** The signed-in user's pinned baseline, or null. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query('baselines')
      .withIndex('by_user', (q) => q.eq('userId', identity.subject))
      .unique();
  },
});

/** Pin a git SHA as the signed-in user's baseline. */
export const set = mutation({
  args: { sha: v.string(), notes: v.optional(v.string()) },
  handler: async (ctx, { sha, notes }) => {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error('Expected a git SHA');
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query('baselines')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();
    const doc = { userId, sha, notes, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert('baselines', doc);
  },
});

/** Remove the signed-in user's baseline. */
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query('baselines')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
