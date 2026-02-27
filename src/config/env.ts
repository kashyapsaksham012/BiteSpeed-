import dotenv from "dotenv";

dotenv.config();

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const config = {
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  db: {
    host: requireEnv("DB_HOST"),
    port: Number.parseInt(process.env.DB_PORT ?? "3306", 10),
    user: requireEnv("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    name: requireEnv("DB_NAME")
  }
};

export default config;
