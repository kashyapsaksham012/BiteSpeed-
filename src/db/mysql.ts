import mysql, { RowDataPacket } from "mysql2/promise";
import config from "../config/env";

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export const getConnection = () => pool.getConnection();

export const ensureSchema = async () => {
  const connection = await getConnection();
  try {
    await connection.execute(
      `CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phoneNumber VARCHAR(20) NULL,
        email VARCHAR(255) NULL,
        linkedId INT NULL,
        linkPrecedence ENUM('primary', 'secondary') NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deletedAt TIMESTAMP NULL,
        FOREIGN KEY (linkedId) REFERENCES contacts(id)
      )`
    );

    const [indexRows] = await connection.execute<
      Array<RowDataPacket & { indexName: string }>
    >(
      `SELECT INDEX_NAME AS indexName
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'contacts'`
    );

    const existing = new Set(indexRows.map((row) => row.indexName));

    if (!existing.has("idx_email")) {
      await connection.execute("CREATE INDEX idx_email ON contacts(email)");
    }
    if (!existing.has("idx_phone")) {
      await connection.execute(
        "CREATE INDEX idx_phone ON contacts(phoneNumber)"
      );
    }
    if (!existing.has("idx_linkedId")) {
      await connection.execute("CREATE INDEX idx_linkedId ON contacts(linkedId)");
    }
  } finally {
    connection.release();
  }
};
