import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import userRoute from './routes/user.route.js'
import postRoute from './routes/post.route.js';
import categoryRoute from './routes/category.route.js';
import authRoute from './routes/auth.routes.js';
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { HTTPException } from 'hono/http-exception';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('/api/*', cors({
  origin: '*',
}))

app.route('/api', userRoute);
app.route('/api', postRoute);
app.route('/api', categoryRoute);
app.route('/api', authRoute);

app.onError((error, c) => {
  console.log(error);
  if (error instanceof DrizzleQueryError && error.cause instanceof DatabaseError) {
    if (error.cause.code === "23505") {
      return c.json({ message: "RECORD_ALREADY_EXISTS" }, 400)
    }
  }

  if (error instanceof HTTPException) {
    return c.json({ message: error.message, cause: error.cause }, error.status)
  }

  return new Response("errore del server", { status: 500 })
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
