import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import relations from './relations.js';

const db = drizzle(process.env.DATABASE_URL!, { relations });

export default db;
