import logger from "../config/logger.js";
import ResponseFormatter from "../utils/ResponseFormatter.js";

const errorHandler = (err, req, res, next) => {
  // A prior middleware already sent a response - let Express close it out.
  if (res.headersSent) {
    return next(err);
  }

  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let errors = err.errors || null;

  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Validation Error";
    errors = Object.values(err.errors).map((e) => e.message);
  } else if (err.name === "MongoServerError" && err.code === 11000) {
    statusCode = 409;
    message = "Duplicate key error";
  } else if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  } else if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
  }

  const logMeta = {
    message: err.message,
    statusCode,
    stack: err.stack,
    path: req.path,
    method: req.method,
  };
  if (statusCode >= 500) {
    logger.error("Error occurred:", logMeta);
  } else {
    logger.warn("Request error:", logMeta);
  }

  // Never leak internal failure details for non-operational (unexpected) errors.
  if (statusCode >= 500 && err.isOperational !== true) {
    message = "Internal server error";
    errors = null;
  }

  res
    .status(statusCode)
    .json(ResponseFormatter.error(message, statusCode, errors));
};

export default errorHandler;
