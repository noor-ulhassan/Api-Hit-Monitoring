import mongoose from "mongoose";
import logger from "./logger.js";
import config from "./index.js";

class MongoConnection {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      if (this.connection) {
        logger.info("MongoDb Already Connected");
        return this.connection;
      }

      await mongoose.connect(config.mongo.url, {
        dbName: config.mongo.dbName,
      });
      this.connection = mongoose.connection;
      logger.info(`MongoDb Connected ${config.mongo.url}`);

      //handle error
      this.connection.on("error", (err) => {
        logger.error("MongoDB connection Error", err);
      });
      //handle disconnect
      this.connection.on("disconnected", () => {
        logger.error("MongoDB Disconnected");
      });
      //handle process exit
      this.connection.on("close", () => {
        logger.error("MongoDB connection closed");
      });
      return this.connection;
    } catch (error) {
      logger.error("Error in MongoDB Connection: ", error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.disconnect();
        this.connection = null;
        logger.info("MongoDb disconnected");
      }
    } catch (error) {
      logger.error("Error in MongoDB Disconnection: ", error);
      throw error;
    }
  }

  getConnection() {
    return this.connection;
  }
}

export default new MongoConnection();
