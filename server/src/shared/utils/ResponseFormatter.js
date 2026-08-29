class ResponseFormatter {
  static success(data = null, message = "success", statusCode = 200) {
    return {
      success: true,
      data,
      message,
      statusCode,
      timestamp: new Date().toISOString(),
    };
  }

  static error(message = "error", statusCode = 500, error = null) {
    return {
      success: false,
      error,
      message,
      statusCode,
      timestamp: new Date().toISOString(),
    };
  }

  static validationError(error = null) {
    return {
      success: false,
      error,
      message: "Validation Failed",
      timestamp: new Date().toISOString(),
    };
  }
  static paginated(data = null, page, limit, total) {
    return {
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      timestamp: new Date().toISOString(),
    };
  }
}

export default ResponseFormatter;
