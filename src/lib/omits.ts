import { omit } from "./utils.js";
import type { user } from "../db/schema.js";

type User = typeof user.$inferSelect;

export const userOmits = (data: Partial<User>) =>
  omit(data, "password", "emailVerificationCode", "passwordRecoveryCode");