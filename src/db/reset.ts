import { reset } from "drizzle-seed";
import db from "./index.js";
import * as schema from "./schema.js"

async function init() {
    await reset(db,schema); 
}
init()