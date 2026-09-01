import config from "./index.js";
import logger from "./logger.js";
import pg from "pg";

const { Pool } = pg;

/**
 * PostgreSQL Connection Class
 * Yeh class PostgreSQL database ke saath connection establish karne aur queries execute karne me help karti hai.
 */
class postgresConnection {
  constructor() {
    // Initial state me pool null rahega
    this.pool = null;
  }

  /**
   * Connection Pool create ya return karta hai.
   * Pool use karne se hume har query ke liye naya connection nahi banana padta,
   * balki existing connections reuse ho jaate hain (jo performance ke liye bahut accha hai).
   */
  getPool() {
    if (!this.pool) {
      this.pool = new Pool({
        host: config.postgres.host,
        port: config.postgres.port,
        user: config.postgres.user,
        password: config.postgres.password,
        database: config.postgres.database,
        max: 20, // Pool me maximum 20 connections allow honge
        idleTimeoutMillis: 30000, // Agar koi client 30 seconds idle (free) rahega toh close ho jayega
        connectionTimeoutMillis: 2000, // Connection connect hone ke liye maximum 2 seconds wait karega
      });

      // Agar kisi client connection me unexpected error aaye toh use log karne ke liye
      this.pool.on("error", (err) => {
        logger.error("Unexpected Error on PG client", err);
      });

      logger.info("PG pool created");
    }
    // Hamesha pool return hona chahiye, chahe pehle se bana ho ya abhi create kiya ho
    return this.pool;
  }

  /**
   * Database connection test karne ke liye function.
   * Yeh temporary client connect karke current time check karta hai.
   */
  async testConnection() {
    try {
      const pool = this.getPool();
      const client = await pool.connect();
      const result = await client.query("SELECT NOW()");
      client.release(); // Connection check hone ke baad client ko wapas pool me release kar dete hain
      logger.info(`Postgres Client connected ${result.rows[0].now}`);
    } catch (error) {
      logger.error("Error in Postgres Client connection: ", error);
      throw error;
    }
  }

  /**
   * Database me SQL queries run karne ke liye helper function.
   * Yeh query execute karta hai aur usme kitna time laga (duration) woh log karta hai.
   * @param {string} text - SQL Query string (e.g., 'SELECT * FROM users')
   * @param {Array} params - Query ke variables (SQL Injection se bachne ke liye)
   */
  async query(text, params) {
    const pool = this.getPool();
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      logger.info("Query completed in", {
        duration,
        text,
        rows: result.rowCount,
      });
      return result;
    } catch (error) {
      logger.error("Error in Postgres query: ", error);
      throw error;
    }
  }

  /**
   * Application shutdown hote waqt database pool ke saare connections ko safely close karne ke liye.
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info("PG pool closed");
    }
  }
}

// Instance export kar rahe hain taaki poori app me ek hi connection pool share ho (Singleton Pattern)
export default new postgresConnection();
