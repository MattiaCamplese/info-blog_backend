import { Hono } from "hono";
import db from "../db/index.js";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { createInsertSchema, createUpdateSchema } from "drizzle-orm/zod";
import { categories } from "../db/schema.js";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { DatabaseError } from "pg";
import z from "zod";
import { querySchema, withSchema } from "../lib/validations.js";
import relations from "../db/relations.js";
import { authMiddleware, type AuthContext } from "../middleware/auth.middleware.js";
import { roleMiddleware } from "../middleware/role.middleware.js";

const categoryRoute = new Hono<AuthContext>().basePath('categories');

const listSchema = querySchema(
  z.object({
    page: z.string().optional().transform(val => val ? +val : undefined),
    perPage: z.string().optional().transform(val => val ? +val : undefined),
    with: withSchema(relations, "categories")
  })
);

categoryRoute.get('/', zValidator("query", listSchema), async (c) => {
  try {
    const { page, perPage, with: withQuery } = c.req.valid("query")
    const queryResult = await db.query.categories.findMany({
      limit: perPage || (page ? 10 : undefined),
      offset: page ? (page - 1) * (perPage || 10) : undefined,
      orderBy: { created_at: "asc" },
      with: withQuery,
      
    });
    return c.json(queryResult)
  } catch (error) {
    return c.json({ message: "Errore del server" }, 500)
  }
});

const findSchema = querySchema(
  z.object({
    with: withSchema(relations, "categories")
  }).strict()
)
categoryRoute.get('/:id', zValidator("query", findSchema), async (c) => {
  try {
    const { id } = c.req.param();
    const { with: withQuery } = c.req.valid("query");
    const queryResult = await db.query.categories.findFirst({ where: { id }, with: withQuery });
    if (!queryResult) {
      throw new HTTPException(404, { message: "Categoria non trovato" })
    }
    return c.json(queryResult);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: "error.message" }, error.status)
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

//Escludiamo le GET PRIMA, QUINDI DA QUA PARTONO LE AUTH
categoryRoute.use(authMiddleware())
categoryRoute.use(roleMiddleware("admin"))

categoryRoute.post('/', zValidator("json", createInsertSchema(categories).array()), async (c) => {
  try {
    const data = c.req.valid("json");
    const queryResult = await db.insert(categories).values(data).returning();
    return c.json(queryResult[0]);
  } catch (error) {
    if (error instanceof DrizzleQueryError) {
      if (error.cause instanceof DatabaseError) {
        return c.json({ message: error.cause?.detail }, 400)
      }
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

categoryRoute.patch('/:id', zValidator('json', createUpdateSchema(categories)), async (c) => {
  try {
    const { id } = c.req.param();
    const data = c.req.valid('json');

    const queryResult = await db.update(categories).set(data).where(eq(categories.id, id)).returning();
    if (!queryResult.length) {
      throw new HTTPException(404, { message: "Categoria non trovata" })
    }

    return c.json(queryResult[0]);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

categoryRoute.delete("/:id", async (c) => {
  try {
    const { id } = c.req.param();

    const queryResult = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id });

    if (!queryResult.length) {
      throw new HTTPException(404, { message: "Categoria non trovata" });
    }
    return c.json(queryResult[0]);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    return c.json({ message: "Errore del server" }, 500);
  }
});

export default categoryRoute;