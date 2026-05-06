import { Hono } from "hono";
import db from "../db/index.js";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { createInsertSchema, createUpdateSchema } from "drizzle-orm/zod";
import { categories, post, postsToCategories } from "../db/schema.js";
import { and, count, DrizzleQueryError, eq, ilike } from "drizzle-orm";
import { DatabaseError } from "pg";
import { querySchema, withSchema } from "../lib/validations.js";
import relations from "../db/relations.js";
import z from "zod";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { type AuthContext, authMiddleware } from "../middleware/auth.middleware.js";

const postRoute = new Hono<AuthContext>().basePath('posts');

const listSchema = querySchema(z.object({
  userId: z.string().optional(),
  page: z.string().optional().transform(val => val ? +val : undefined),
  perPage: z.string().optional().transform(val => val ? +val : undefined),
  with: withSchema(relations, "post"),
  category: z.string().optional(),
  search: z.string().optional()
}).strict());

postRoute.get('/', zValidator("query", listSchema), async (c) => {
  try {
    const { userId, page, perPage, with: withQuery, category, search } = c.req.valid("query");

    const postsRes = await db.query.post.findMany({
      where: {
        userId,
        ...(category ? { categories: { slug: { eq: category } } } : {}),
        ...(search ? { title: { ilike: `%${search}%` } } : {})
      },
      limit: perPage || (page ? 10 : undefined),
      offset: page ? (page - 1) * (perPage || 10) : undefined,
      orderBy: {
        created_at: "desc"
      },
      with: withQuery,
    });

    const [{ count: countPost }] = await db
      .select({ count: count() })
      .from(post)
      .innerJoin(postsToCategories, eq(post.id, postsToCategories.postId))
      .innerJoin(categories, eq(postsToCategories.categoryId, categories.id))
      .where(
        and(
          userId ? eq(post.userId, userId) : undefined,
          category ? eq(categories.slug, category) : undefined,
          search ? ilike(post.title, `${search}%`) : undefined,
        )
      )
    const totalPages = Math.ceil(countPost / (perPage || 10))

    return c.json({
      items: postsRes,
      totalItems: countPost,
      page,
      perPage,
      totalPages,
      hasNextPage: page ? page < totalPages : false,
      hasPrevPage: page ? page > 1 : false,
    })
  } catch (error) {
    return c.json({ message: "Errore del server" }, 500)
  }
});

const findSchema = querySchema(z.object({
  with: withSchema(relations, "post"),
}).strict());

postRoute.get('/:id', zValidator("query", findSchema), async (c) => {
  try {
    const { id } = c.req.param();
    const { with: withQuery } = c.req.valid('query')

    const post = await db.query.post.findFirst({
      where: { id },
      with: withQuery,
    });
    if (!post) {
      throw new HTTPException(404, { message: "Post non trovato" })
    }
    return c.json(post);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }
    return c.json({ message: "Errore del server" }, 500)
  }
})

postRoute.post('/', authMiddleware(), zValidator("json", createInsertSchema(post).extend({
  categoryIds: z.string().array().optional(),
})),
  zValidator('query', findSchema),
  async (c) => {
    try {
      const { categoryIds, ...data } = c.req.valid("json");
      const { with: withQuery } = c.req.valid("query");
      const authUser = c.get("authUser");

      if (data.userId !== authUser.id && authUser.role !== "admin") {
        throw new HTTPException(403, { message: "Accesso non autorizzato" });
      }

      const newPost = await db.transaction(async tx => {
        const newPost = await tx.insert(post).values(data).returning();


        if (categoryIds?.length) {
          await tx.insert(postsToCategories).values(categoryIds.map(categoryId => ({
            categoryId,
            postId: newPost[0].id,
          })),

          )
        }
        return newPost[0]
      })

      const queryResult = await db.query.post.findFirst({
        where: { id: newPost.id },
        with: withQuery,
      })

      return c.json(queryResult);

    } catch (error) {
      if (error instanceof HTTPException) {
        return c.json({ message: error.message }, error.status);
      }
      if (error instanceof DrizzleQueryError) {
        if (error.cause instanceof DatabaseError) {
          return c.json({ message: error.cause?.detail }, 400)
        }
      }
      return c.json({ message: "Errore del server" }, 500)
    }
  })

postRoute.patch('/:id', authMiddleware(), zValidator('json', createUpdateSchema(post).omit({ featuredImage: true }).extend({
  categoryIds: z.string().array().optional(),
})),
  zValidator('query', findSchema),
  async (c) => {
    try {
      const { id } = c.req.param();
      const { categoryIds, ...data } = c.req.valid('json');
      const { with: withQuery } = c.req.valid("query");
      const authUser = c.get("authUser")
      const existing = await db.query.post.findFirst({ where: { id } });

      if (!existing) throw new HTTPException(404, { message: "Post non trovato" });

      if (existing.userId !== authUser.id && authUser.role !== "admin") {
        throw new HTTPException(403, { message: "Utente non autorizzato" });
      }

      await db.transaction(async tx => {
        if (Object.keys(data).length) {
          const queryResult = await tx.update(post).set(data).where(eq(post.id, id)).returning();
          if (!queryResult.length) {
            throw new HTTPException(404, { message: "Post non trovato" })
          }
        }

        if (categoryIds) {
          //cancelliamo tutte le categorie del post selezionato
          await tx.delete(postsToCategories).where(eq(postsToCategories.postId, id))
          //  e poi ricreo solo quelle passate
          if (categoryIds.length) {
            await tx.insert(postsToCategories).values(categoryIds?.map(categoryId => ({
              categoryId, postId: id
            })))
          }
        }
      })

      const queryresult = await db.query.post.findFirst({
        where: { id },
        with: withQuery
      });

      return c.json(queryresult);
    } catch (error) {
      if (error instanceof HTTPException) {
        return c.json({ message: error.message }, error.status);
      }
      return c.json({ message: "Errore del server" }, 500)
    }
  })

postRoute.delete("/:id", authMiddleware(), async (c) => {
  try {
    const { id } = c.req.param();
    const authUser = c.get("authUser")
    const existing = await db.query.post.findFirst({ where: { id } });

    if (!existing) {
      throw new HTTPException(404, { message: "Post non trovato" })
    }

    if (existing.userId !== authUser.id && authUser.role !== "admin") {
      throw new HTTPException(403, { message: "Accesso non autorizzato" });
    }
    const deletedPosts = await db.delete(post).where(eq(post.id, id)).returning({ id: post.id });

    if (!deletedPosts.length) {
      throw new HTTPException(404, { message: "Post non trovato" });
    }
    return c.json(deletedPosts[0]);
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    return c.json({ message: "Errore del server" }, 500);
  }
});

const uploadImageSchema = z.object({
  file: z.file().mime(['image/jpeg', 'image/png']).max(10 * 1024 * 1024),
})

postRoute.post('/:id/featured-image', authMiddleware(), zValidator('form', uploadImageSchema), async (c) => {
  try {

    const { file } = c.req.valid('form');
    const { id } = c.req.param();
    const authUser = c.get("authUser");

    const queryResult = await db.query.post.findFirst({
      where: { id }
    });

    if (!queryResult) {
      throw new HTTPException(404, { message: "Articolo non trovato" });
    }
    if (queryResult.featuredImage && existsSync(queryResult.featuredImage)) {
      await rm(queryResult.featuredImage);
    }
    if (queryResult.userId !== authUser.id && authUser.role !== "admin") {
      throw new HTTPException(403, { message: "Accesso non autorizzato" });
    }

    const UPLOAD_DIR = join(process.cwd(), 'uploads');
    if (!existsSync(UPLOAD_DIR)) {
      mkdirSync(UPLOAD_DIR, { recursive: true })
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `${Date.now()}_${file.name}`;
    const filepath = join(UPLOAD_DIR, filename)

    await writeFile(filepath, buffer);

    await db.update(post).set({ featuredImage: filepath }).where(eq(post.id, id))

    return c.json({ message: 'file ricevuto' });

  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status);
    }
    return c.json({ message: 'Errore del server' }, 500);
  }
});

postRoute.get('/:id/featured-image', async c => {
  try {
    const { id } = c.req.param();
    const queryResult = await db.query.post.findFirst({
      where: { id }
    });
    if (!queryResult) {
      throw new HTTPException(404, { message: "articolo non trovato" })
    }

    if (!queryResult.featuredImage || !existsSync(queryResult.featuredImage)) {
      throw new HTTPException(404, { message: "immagine articolo non trovata" })
    }

    const buffer = await readFile(queryResult.featuredImage);
    const detect = await fileTypeFromBuffer(buffer)

    return new Response(buffer, {
      headers: {
        "Content-type": detect?.mime || "aplication/octet-stream",
      }
    })
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }
    return c.json({ message: "errore del server" }, 500)
  }
});

postRoute.delete("/:id/featured-image", authMiddleware(), async c => {
  try {
    const { id } = c.req.param();
    const authUser = c.get("authUser");

    const queryResult = await db.query.post.findFirst({
      where: { id }
    });
    if (!queryResult) {
      throw new HTTPException(404, { message: "immagine articolo non trovata" })
    }
    if (queryResult.userId !== authUser.id && authUser.role !== "admin") {
      throw new HTTPException(403, { message: "Accesso non autorizzato" });
    }

    await db.update(post).set({ featuredImage: null }).where(eq(post.id, id));

    if (queryResult.featuredImage && existsSync(queryResult.featuredImage)) {
      await rm(queryResult.featuredImage)
    }
    return c.json({ message: "immagine eliminata" })
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json({ message: error.message }, error.status)
    }
    return c.json({ message: "errore del server" }, 500)
  }
});
export default postRoute;