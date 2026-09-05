import AppError from "../../../shared/utils/AppError.js";
import jwt from "jsonwebtoken";
import config from "../../../shared/config/index.js";
import logger from "../../../shared/config/logger.js";
import { APPLICATION_ROLES } from "../../../shared/constants/roles.js";
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
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });
  }

  formatUserForResponse(user) {
    const userObj = user.toObject ? user.toObject() : { ...user };
    delete userObj.password;
    return userObj;
  }

  /**
   * Compares the user-entered password with the hashed password.
   * @param {string} userEnteredPassword - The password entered by the user.
   * @param {string} hashedPassword - The hashed password stored in the database.
   * @returns {Promise<boolean>} - Returns true if the passwords match, otherwise false.
   */
  async comparePassword(userEnteredPassword, hashedPassword) {
    return await bcrypt.compare(userEnteredPassword, hashedPassword);
  }
  async onboardSuperAdmin(superAdminData) {
    try {
      const superAdminCount = await this.userRepository.count({
        role: APPLICATION_ROLES.SUPER_ADMIN,
      });
      if (superAdminCount > 0) {
        throw new AppError("Super Admin already exists", 403);
      }

      const user = await this.userRepository.create(superAdminData);
      const token = this.generateToken(user);
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

  /**
   * Registers a new user.
   * @param {Object} userData - The data of the user to be registered.
   * @returns {Promise<Object>} - Returns an object containing the user and token.
   */
  async register(userData) {
    try {
      const existingUser = await this.userRepository.findByUsername(
        userData.username,
      );
      if (existingUser) {
        throw new AppError("Username already exists", 409);
      }

      const existingEmail = await this.userRepository.findByEmail(
        userData.email,
      );
      if (existingEmail) {
        throw new AppError("Email already exists", 409);
      }

      const user = await this.userRepository.create(userData);
      const token = this.generateToken(user);

      logger.info("User registered successfully", {
        username: user.username,
      });

      return {
        user: this.formatUserForResponse(user),
        token,
      };
    } catch (error) {
      logger.error("Error in Register service", error);
      throw error;
    }
  }

  /**
   * Logs in a user.
   * @param {string} username - The username of the user.
   * @param {string} password - The password of the user.
   * @returns {Promise<Object>} - Returns an object containing the user and token.
   */
  async login(username, password) {
    try {
      const user = await this.userRepository.findByUsername(username);

      if (!user) {
        throw new AppError("Invliad Credentials", 401);
      }

      if (!user.isActive) {
        throw new AppError("Account is deactivated", 403);
      }

      const isPasswordValid = await this.comparePassword(
        password,
        user.password,
      );
      if (!isPasswordValid) {
        throw new AppError("Invliad Credentials", 401);
      }
      const token = this.generateToken(user);

      logger.info("User loggedIn successfully", { username: user.username });

      return {
        user: this.formatUserForResponse(user),
        token,
      };
    } catch (error) {
      logger.error("Error in Login service", error);
      throw error;
    }
  }

  /**
   * Fetches the profile of a user by their ID.
   * @param {string} userId - The ID of the user.
   * @returns {Promise<Object>} - Returns the user's profile data.
   */
  async getProfile(userId) {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }
      return this.formatUserForResponse(user);
    } catch (error) {
      logger.error("Error getting user profile:", error);
      throw error;
    }
  }

  async checkSuperAdminPermissions(userId) {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new AppError("User not found", 404);
      }

      return user.role === APPLICATION_ROLES.SUPER_ADMIN;
    } catch (error) {}
  }
}
