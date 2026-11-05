import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema/auth";

export class OperatorRefusal extends Error {}
/** Called only after verified identity and terminal confirmation, inside the lock. */
export async function mutatePersonalBinding(tx: NodePgDatabase<typeof schema>, identity: { subject: string; email: string; name: string }, recovery: boolean, ownerId: string | undefined, now: Date): Promise<string> {
      const users = await tx.select().from(schema.user).limit(2);
      if (!recovery) {
        if (users.length > 1) throw new OperatorRefusal("Ambiguous users. Explicit data repair is required.");
        if (users.length === 1) {
          const bindings = await tx.select().from(schema.account).where(eq(schema.account.userId, users[0].id));
          if (bindings.length !== 1 || bindings[0].providerId !== "google" || bindings[0].accountId !== identity.subject) throw new OperatorRefusal("Another identity is provisioned. Use recovery after reviewing the existing user.");
          return users[0].id;
        }
        const id = randomUUID();
        await tx.insert(schema.user).values({ id, email: identity.email, name: identity.name, emailVerified: true, image: null, createdAt: now, updatedAt: now });
        await tx.insert(schema.account).values({ id: randomUUID(), userId: id, providerId: "google", accountId: identity.subject, createdAt: now, updatedAt: now });
        return id;
      }
      if (users.length !== 1 || users[0].id !== ownerId) throw new OperatorRefusal("Configured personal user is missing or ambiguous. Explicit data repair is required.");
      const bindings = await tx.select().from(schema.account).where(eq(schema.account.userId, ownerId!));
      if (bindings.length !== 1 || bindings[0].providerId !== "google") throw new OperatorRefusal("Account binding is ambiguous. Explicit data repair is required.");
      await tx.update(schema.account).set({ accountId: identity.subject, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, scope: null, password: null, updatedAt: now }).where(eq(schema.account.id, bindings[0].id));
      await tx.update(schema.user).set({ email: identity.email, name: identity.name, emailVerified: true, image: null, updatedAt: now }).where(eq(schema.user.id, ownerId!));
      await tx.delete(schema.session).where(eq(schema.session.userId, ownerId!));
      await tx.delete(schema.verification);
      return ownerId!;
}
