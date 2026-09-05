import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import SecurityUtils from "../utils/SecurityUtil.js";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      validate: {
        validator: function (userName) {
          return /^[a-zA-Z0-9_.-]+$/.test(userName);
        },
        message: "Please enter a valid username",
      },
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (email) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        },
        message: "Please enter a valid email",
      },
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      validate: {
        validator: function (password) {
          if (
            this.isModified("password") &&
            password &&
            !/^\$2[aby]\$/.test(password)
          ) {
            const validation = SecurityUtils.validatePassword(password);
            return validation.success;
          }
          return true;
        },
        message: function (props) {
          if (props.value && !/^\$2[aby]\$/.test(props.value)) {
            const validation = SecurityUtils.validatePassword(props.value);
            // ["Password is required", "Password must contain at least one uppercase letter"]
            // "Password is required. Password must contain at least one uppercase letter."
            return validation.errors.join(". ");
          }
          return "Password validation failed";
        },
      },
    },
    role: {
      type: String,
      enum: ["super_admin", "client_admin", "client_viewer"],
      default: "client_viewer",
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId, // 123
      ref: "Client",
      required: function () {
        return this.role !== "super_admin";
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    permissions: {
      canCreateApiKeys: {
        type: Boolean,
        default: false,
      },
      canManageUsers: {
        type: Boolean,
        default: false,
      },
      canViewAnalytics: {
        type: Boolean,
        default: true,
      },
      canExportData: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

// Hash password before saving. Async pre-hooks propagate errors by throwing;
// no `next` callback is used.
userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Indexes for efficient querying
userSchema.index({ clientId: 1, isActive: 1 });
userSchema.index({ role: 1 });

const User = mongoose.model("User", userSchema);
export default User;
