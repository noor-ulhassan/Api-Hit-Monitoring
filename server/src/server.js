import express from "express";
import errorHandler from "./shared/Middleware/errorHandler.js";
import helmet from "helmet";
import logger from "./shared/config/logger.js";
import mongodb from "./shared/config/mongodb.js";
import postgres from "./shared/config/postgres.js";
import rabbitmq from "./shared/config/rabbitmq.js";
import ResponseFormatter from "./shared/utils/ResponseFormatter.js";
import cors from "cors";
import config from "./shared/config/index.js";
import cookieParser from "cookie-parser";

// Routers
import authRouter from "./services/auth/routes/authRouter.js";

const app = express();

// Middlewares
app.use(cookieParser());
app.use(helmet());
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
  next();
});
app.get("/health", (req, res) => {
  res.status(200).json(
    ResponseFormatter.success(
      {
        status: "healthy",
        Timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
      "Service is Healthy",
    ),
  );
});

/**
 * Root endpoint
 * Provides basic information about the API service and available endpoints.
 */
app.get("/", (req, res) => {
  res.status(200).json(
    ResponseFormatter.success(
      {
        service: "API Hit Monitoring System",
        version: "1.0.0",
        endpoints: {
          health: "/health",
          auth: "/api/auth",
          ingest: "/api/hit",
          analytics: "/api/analytics",
        },
      },
      "API Hit Monitoring Service",
    ),
  );
});

// /api/auth/onboard-super-admin
app.use("/api/auth", authRouter);
/**
 * 404 Handler
 */
app.use((req, res) => {
  res.status(404).json(ResponseFormatter.error("Endpoint not found", 404));
});

app.use(errorHandler);
// Connection Establish

async function initializeConnection() {
  try {
    logger.info("Initializing Databse Connections");

    await mongodb.connect();
    await postgres.testConnection();
    await rabbitmq.connect();

    logger.info("All Connected Successfully");
  } catch (error) {
    logger.error("Failed to Initialize Connections", error);
    throw error;
  }
}

async function startServer() {
  try {
    await initializeConnection();
    const server = app.listen(config.port, () => {
      logger.info(`Server is running on port ${config.port}`);
      logger.info(`Environment: ${config.node_env}`);
      logger.info(`API available at: http://localhost:${config.port}`);
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      server.close(async () => {
        logger.info("HTTP Server closed");
        try {
          await mongodb.disconnect();
          await postgres.close();
          await rabbitmq.close();
          logger.info("All connections closed");
          process.exit(0);
        } catch (error) {
          logger.error("Error closing connections", error);
          process.exit(1);
        }
      });
    };
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      gracefulShutdown("unhandledRejection");
    });
  } catch (error) {
    logger.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();
