import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  NODE_ENV: z.string().default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), "data")),
  PUBLIC_DIR: z.string().optional()
});

const parsed = configSchema.parse(process.env);
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

export const config = {
  ...parsed,
  PUBLIC_DIR: parsed.PUBLIC_DIR ?? path.resolve(currentDir, "public")
};
