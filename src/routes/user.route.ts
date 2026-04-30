import { Hono } from "hono";
import db from "../db/index.js";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { createInsertSchema, createUpdateSchema } from "drizzle-orm/zod";
import { user } from "../db/schema.js";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { DatabaseError } from "pg";
import z from "zod";
import { querySchema, withSchema } from "../lib/validations.js";
import relations from "../db/relations.js";
import { authMiddleware, type AuthContext } from "../middleware/auth.middleware.js";
import { roleMiddleware } from "../middleware/role.middleware.js";

const userRoute = new Hono<AuthContext>().basePath('users');
userRoute.use(authMiddleware());

const listSchema = querySchema(
  z.object({
    page: z.string().optional().transform(val => val ? +val : undefined),
    perPage: z.string().optional().transform(val => val ? +val : undefined),
    with: withSchema(relations, "user")
  })
);

userRoute.get('/', roleMiddleware("admin"), zValidator("query", listSchema), async (c) => {
  try {
    const { page, perPage, with: withQuery } = c.req.valid("query")

    const users = await db.query.user.findMany({
      limit: perPage || (page ? 10 : undefined),
      offset: page ? (page - 1) * (perPage || 10) : undefined,
      with: withQuery
    });
    return c.json(users)
  } catch (error) {
    return c.json({ message: "Errore del server" }, 500)
  }
});

const findSchema = querySchema(
  z.object({
    with: withSchema(relations, "user")
  }).strict()
)
userRoute.get('/:id', zValidator("query", findSchema), async (c) => {
  try {
    const { id } = c.req.param();
    const authUser = c.get("authUser")
    if (authUser.id !== id && authUser.role !== "admin") {
      throw new HTTPException(401, { message: "Utenete non trovato" })
    }

    const { with: withQuery } = c.req.valid("query");
    const user = await db.query.user.findFirst({ where: { id }, with: withQuery });
    if (!user) {
      throw new HTTPException(404, { message: "Utente non trovato" })
    }
    return c.json(user);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: "error.message" }, error.status)
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

userRoute.post('/', roleMiddleware("admin"), zValidator("json", createInsertSchema(user).array()), async (c) => {
  try {
    const data = c.req.valid("json");
    const newUser = await db.insert(user).values(data).returning();
    return c.json(newUser[0]);
  } catch (error) {
    if (error instanceof DrizzleQueryError) {
      if (error.cause instanceof DatabaseError) {
        return c.json({ message: error.cause?.detail }, 400)
      }
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

userRoute.patch('/:id', zValidator('json', createUpdateSchema(user)), async (c) => {
  try {
    const { id } = c.req.param();
    const data = c.req.valid('json');
    const authUser = c.get("authUser")
    if (authUser.id !== id && authUser.role !== "admin") {
      throw new HTTPException(401, { message: "Utenete non trovato" })
    }

    const updateUser = await db.update(user).set(data).where(eq(user.id, id)).returning();
    if (!updateUser.length) {
      throw new HTTPException(404, { message: "Utente non trovato" })
    }

    return c.json(updateUser[0]);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

userRoute.delete("/:id", async (c) => {
  try {
    const { id } = c.req.param();
    const authUser = c.get("authUser")
    if (authUser.id !== id && authUser.role !== "admin") {
      throw new HTTPException(401, { message: "Utenete non trovato" })
    }

    const deletedUsers = await db.delete(user).where(eq(user.id, id)).returning({ id: user.id });

    if (!deletedUsers.length) {
      throw new HTTPException(404, { message: "Utente non trovato" });
    }
    return c.json(deletedUsers[0]);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    return c.json({ message: "Errore del server" }, 500);
  }
});

export default userRoute;