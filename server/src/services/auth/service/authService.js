import AppError from "../../../shared/utils/AppError.js";
import jwt from "jsonwebtoken";
import config from "../../../shared/config/index.js";
import logger from "../../../shared/config/logger.js";
export class AuthService {
  constructor(userRepository) {
    if (!userRepository) {
      throw new Error("User Repository is required");
    }
    this.userRepository = userRepository;
  }

  generateToken(user) {
    const { _id, email, username, role, clientId } = user;
    const payload = {
      userId: _id,
      email,
      username,
      role,
      clientId,
    };
    return jwt.sign(payload, config.jwt.sercet, {
      expiresIn: config.jwt.expiresIn,
    });
  }

  formatUserForResponse(user) {
    const userObj = user.toObject ? user.toObject() : { ...user };
    delete userObj.password;
    return userObj;
  }
  async onboardSuperAdmin(superAdminData) {
    try {
      const existingUser = await this.userRepository.findAll();
      if (existingUser && existingUser.length > 0) {
        throw new AppError("Super Admin already exists", 403);
      }

      const user = await this.userRepository.create(superAdminData);
      const token = this.generateToken();
      logger.info("Super Admin created successfully", {
        username: user.username,
      });
      return {
        token,
        user: this.formatUserForResponse(user),
      };
    } catch (error) {
      logger.error("Failed to create Super Admin", error);
      throw error;
    }
  }
}
