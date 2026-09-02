// Global Level Configuration is written here:

import dotenv from "dotenv";
dotenv.config();

const config = {
  // server
  node_env: process.env.NODE_ENV || "Development ",
  port: parseInt(process.env.PORT || 8080),

  // mongo

  mongo: {
    url: process.env.MONGO_URI || "mongodb://localhost:27017/api-monitoring",
    dbName: process.env.MONGO_DB_NAME || "api_monitoring",
  },

  // Postgres
  postgres: {
    host: process.env.PG_HOST || "localhost",
    port: parseInt(process.env.PG_PORT || "5432", 10),
    database: process.env.PG_DATABASE || "api_monitoring",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "password",
  },

  // Rabbit MQ

  rabbitmq: {
    url: process.env.RABBITMQ_URL || "amqp://localhost:5672",
    queue: process.env.RABBITMQ_QUEUE || "api_hits",
    publisherConfirms:
      process.env.RABBITMQ_PUBLISHER_CONFIRMS === "true" || false,
    retryAttempts: parseInt(process.env.RABBITMQ_RETRY_ATTEMPTS || "3", 10),
    retryDelay: parseInt(process.env.RABBITMQ_RETRY_DELAY || "1000", 10),
  },

  // jwt

  jwt: {
    sercet: process.env.JWT_SECRET || "noorulhassan1",
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
  },

  // rateLimit

  ratelimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "1000", 10), // limit each IP to 1000 / 15 min / IP
  },

  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: "strict",
  },
};

export default config;
