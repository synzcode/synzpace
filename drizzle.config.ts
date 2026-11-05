import { defineConfig } from "drizzle-kit";

// Generation needs no runtime secrets. Migration is a separate command.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/*.ts",
  out: "./drizzle",
});
