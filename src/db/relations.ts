import { defineRelations } from "drizzle-orm";
import * as schema from './schema.js'

const relations = defineRelations(schema, r => ({
    post: {
        user: r.one.user ({
            from: r.post.userId,
            to: r.user.id,
        }),
        categories: r.many.categories({
            from: r.post.id.through(r.postsToCategories.postId),
            to: r.categories.id.through(r.postsToCategories.categoryId)
        })
    },
    user: {
        post: r.many.post(),
    },
    categories: {
        post: r.many.post(),
    }
}))


export default relations;