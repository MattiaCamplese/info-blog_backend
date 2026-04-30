import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { createInsertSchema } from "drizzle-orm/zod";
import { eq, and } from "drizzle-orm";
import z from "zod";
import db from "../db/index.js";
import { postsToCategories } from "../db/schema.js";

const postsToCategoryRoute = new Hono().basePath("posts-to-categories");

/* ===========================
   GET - Lista relazioni
=========================== */

const listSchema = z.object({
    postId: z.string().optional(),
    categoryId: z.string().optional(),
}).strict();

postsToCategoryRoute.get(
    "/",
    zValidator("query", listSchema),
    async (c) => {
        try {
            const { postId, categoryId } = c.req.valid("query");

            const relations = await db.query.postsToCategories.findMany({
                where: {
                    ...(postId && { postId }),
                    ...(categoryId && { categoryId }),
                },
            })

            return c.json(relations);
        } catch (error) {
            return c.json({ message: "Errore del server" }, 500);
        }
    }
);

/* ===========================
   POST - Crea relazione
=========================== */

const insertSchema = createInsertSchema(postsToCategories);

postsToCategoryRoute.post(
    "/",
    zValidator("json", insertSchema),
    async (c) => {
        try {
            const data = c.req.valid("json");

            const inserted = await db
                .insert(postsToCategories)
                .values(data)
                .returning();

            return c.json(inserted[0]);
        } catch (error: any) {
            // chiave primaria composta già esistente
            if (error?.code === "23505") {
                return c.json({ message: "Relazione già esistente" }, 400);
            }

            return c.json({ message: "Errore del server" }, 500);
        }
    }
);

/* ===========================
   DELETE - Rimuovi relazione
=========================== */

postsToCategoryRoute.delete(
    "/",
    zValidator(
        "query",
        z.object({
            postId: z.string(),
            categoryId: z.string(),
        }).strict()
    ),
    async (c) => {
        try {
            const { postId, categoryId } = c.req.valid("query");

            const deleted = await db
                .delete(postsToCategories)
                .where(
                    and(
                        eq(postsToCategories.postId, postId),
                        eq(postsToCategories.categoryId, categoryId)
                    )
                )
                .returning();

            if (!deleted.length) {
                throw new HTTPException(404, {
                    message: "Relazione non trovata",
                });
            }

            return c.json(deleted[0]);
        } catch (error) {
            if (error instanceof HTTPException) {
                return c.json({ message: error.message }, error.status);
            }

            return c.json({ message: "Errore del server" }, 500);
        }
    }
);

export default postsToCategoryRoute;