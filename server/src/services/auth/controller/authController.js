import { APPLICATION_ROLES } from "../../../shared/constants/roles.js";
import config from "../../../shared/config/index.js";
import ResponseFormatter from "../../../shared/utils/ResponseFormatter.js";

export class AuthController {
  constructor(authService) {
    if (!authService) {
      throw new Error("auth Service is Required");
    }

    this.authService = authService;
  }

  async onboardSuperAdmin(req, res, next) {
    try {
      const { username, email, password } = req.body;
      const superAdminData = {
        username,
        email,
        password,
        role: APPLICATION_ROLES.SUPER_ADMIN,
      };
      const { token, user } =
        await this.authService.onboardSuperAdmin(superAdminData);
      res.cookie("authToken", token, {
        httpOnly: config.cookie.httpOnly,
        secure: config.cookie.secure,
        sameSite: config.cookie.sameSite,
        maxAge: config.cookie.maxAge,
      });
      res
        .status(201)
        .json(
          ResponseFormatter.success(
            user,
            "Super Admin Onboarded Successfully",
            201,
          ),
        );
    } catch (error) {
      next(error);
    }
  }
}
