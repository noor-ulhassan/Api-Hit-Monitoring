import ResponseFormatter from "../utils/ResponseFormatter.js";
import jwt from "jsonwebtoken";
import config from "../config/index.js";
import logger from "../config/logger.js";

export const authenticate = async (req, res, next) => {
  try {
    let token = null;
    if (req.cookies && req.cookies.authToken) {
      token = req.cookies.authToken;
    }
    if (!token) {
      return res
        .status(401)
        .json(ResponseFormatter.error("Auth Token is Required"));
    }
    const decoded = jwt.verify(token, config.jwt.secret);
    const { userId, email, username, role, clientId } = decoded;
    req.user = {
      userId,
      email,
      username,
      role,
      clientId,
    };
    next();
  } catch (error) {
    logger.error("Error in authentication", error);
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json(
          ResponseFormatter.error(
            "Authentication Failed",
            401,
            "Token Expired",
          ),
        );
    }
    if (error.name === "JsonWebTokenError") {
      return res
        .status(401)
        .json(
          ResponseFormatter.error(
            "Authentication Failed",
            401,
            "Invalid Token",
          ),
        );
    }
    return res
      .status(401)
      .json(
        ResponseFormatter.error("Authentication Failed", 401, error.message),
      );
  }
};
