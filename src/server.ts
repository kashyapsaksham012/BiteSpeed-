import app from "./app";
import config from "./config/env";
import { ensureSchema, getConnection } from "./db/mysql";

const startServer = async () => {
  try {
    const connection = await getConnection();
    await connection.ping();
    connection.release();
    await ensureSchema();
    console.log("Database connection OK");
  } catch (error) {
    console.error("Database connection failed", error);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
};

void startServer();
