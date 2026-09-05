import express from "express";
import dependencies from "../Dependencies/dependencies.js";
import authorize from "../../../shared/Middleware/authorize.js";
import { authenticate } from "../../../shared/Middleware/authenticate.js";
import validate from "../../../shared/Middleware/validate.js";
import requestLogger from "../../../shared/Middleware/requestLogger.js";
import {
  onboardSuperAdminSchema,
  loginSchema,
  registrationSchema,
} from "../validation/authSchema.js";
import { APPLICATION_ROLES } from "../../../shared/constants/roles.js";

const router = express.Router();
const { controllers } = dependencies;
const authController = controllers.authController;

router.post(
  "/onboard-super-admin",
  requestLogger,
  validate(onboardSuperAdminSchema),
  (req, res, next) => authController.onboardSuperAdmin(req, res, next),
);

router.post(
  "/register",
  requestLogger,
  authenticate,
  authorize([APPLICATION_ROLES.SUPER_ADMIN]),
  validate(registrationSchema),
  (req, res, next) => authController.register(req, res, next),
);

router.post("/login", requestLogger, validate(loginSchema), (req, res, next) =>
  authController.login(req, res, next),
);

router.get("/profile", requestLogger, authenticate, (req, res, next) =>
  authController.getProfile(req, res, next),
);

router.get("/logout", requestLogger, (req, res, next) =>
  authController.logout(req, res, next),
);

export default router;
