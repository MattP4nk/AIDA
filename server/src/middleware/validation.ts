import { Request, Response, NextFunction } from "express";
import { body, param, query, ValidationChain, validationResult } from "express-validator";

/**
 * Validation Middleware
 * Comprehensive input validation and sanitization for all endpoints
 */

// ==================== VALIDATION HELPERS ====================

/**
 * Handle validation errors
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: "Validation failed",
      details: errors.array().map((err) => ({
        field: err.type === "field" ? err.path : undefined,
        message: err.msg,
      })),
      timestamp: new Date().toISOString(),
    });
    return;
  }
  next();
};

// ==================== COMMON VALIDATORS ====================

/**
 * Username validation rules
 */
export const validateUsername = (): ValidationChain =>
  body("username")
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage("Username must be 3-20 characters")
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Username can only contain letters, numbers, underscores, and hyphens")
    .escape(); // Sanitize to prevent XSS

/**
 * Email validation rules
 */
export const validateEmail = (): ValidationChain =>
  body("email")
    .trim()
    .isEmail()
    .withMessage("Invalid email address")
    .normalizeEmail()
    .isLength({ max: 255 })
    .withMessage("Email too long");

/**
 * Password validation rules
 */
export const validatePassword = (): ValidationChain =>
  body("password")
    .isLength({ min: 8, max: 128 })
    .withMessage("Password must be 8-128 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain uppercase, lowercase, and number");

/**
 * Command validation rules
 */
export const validateCommand = (): ValidationChain =>
  body("command")
    .trim()
    .notEmpty()
    .withMessage("Command cannot be empty")
    .isLength({ max: 1000 })
    .withMessage("Command too long (max 1000 characters)")
    .matches(/^[a-zA-Z0-9\s\-_./,@:=+*#]*$/)
    .withMessage("Command contains invalid characters");

/**
 * Server ID validation rules
 */
export const validateServerId = (location: "body" | "param" | "query" = "body"): ValidationChain => {
  const validator = location === "body" ? body("serverId") :
                    location === "param" ? param("serverId") :
                    query("serverId");

  return validator
    .optional()
    .isString()
    .withMessage("Server ID must be a string")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Server ID invalid length")
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Server ID contains invalid characters");
};

/**
 * IP address validation rules
 */
export const validateIpAddress = (): ValidationChain =>
  body("ipAddress")
    .optional()
    .trim()
    .matches(/^(\d{1,3}\.){3}\d{1,3}$/)
    .withMessage("Invalid IP address format")
    .custom((value) => {
      const parts = value.split(".");
      return parts.every((part: string) => {
        const num = parseInt(part, 10);
        return num >= 0 && num <= 255;
      });
    })
    .withMessage("IP address octets must be 0-255");

/**
 * Message content validation
 */
export const validateMessageContent = (): ValidationChain =>
  body("content")
    .trim()
    .notEmpty()
    .withMessage("Message content cannot be empty")
    .isLength({ max: 5000 })
    .withMessage("Message too long (max 5000 characters)")
    .escape(); // Sanitize to prevent XSS

/**
 * File path validation
 */
export const validateFilePath = (): ValidationChain =>
  body("path")
    .trim()
    .notEmpty()
    .withMessage("File path cannot be empty")
    .isLength({ max: 500 })
    .withMessage("File path too long")
    .matches(/^[a-zA-Z0-9\/._-]+$/)
    .withMessage("File path contains invalid characters")
    .custom((value) => {
      // Prevent directory traversal
      return !value.includes("..") && !value.includes("//");
    })
    .withMessage("File path contains directory traversal");

/**
 * Numeric ID validation
 */
export const validateId = (fieldName: string = "id"): ValidationChain =>
  param(fieldName)
    .trim()
    .notEmpty()
    .withMessage(`${fieldName} is required`)
    .isLength({ min: 1, max: 100 })
    .withMessage(`${fieldName} invalid length`)
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage(`${fieldName} contains invalid characters`);

/**
 * Pagination validation
 */
export const validatePagination = (): ValidationChain[] => [
  query("page")
    .optional()
    .isInt({ min: 1, max: 10000 })
    .withMessage("Page must be between 1 and 10000")
    .toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100")
    .toInt(),
];

/**
 * Sanitize search query
 */
export const validateSearchQuery = (): ValidationChain =>
  query("q")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Search query too long")
    .escape();

// ==================== SPECIFIC ROUTE VALIDATORS ====================

/**
 * Registration validation
 */
export const validateRegistration = (): ValidationChain[] => [
  validateUsername(),
  validateEmail(),
  validatePassword(),
];

/**
 * Login validation
 */
export const validateLogin = (): ValidationChain[] => [
  body("username")
    .trim()
    .notEmpty()
    .withMessage("Username is required")
    .escape(),
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
];

/**
 * Command execution validation
 */
export const validateCommandExecution = (): ValidationChain[] => [
  validateCommand(),
  validateServerId("body"),
];

/**
 * Hack command validation
 */
export const validateHackCommand = (): ValidationChain[] => [
  body("targetIp")
    .trim()
    .notEmpty()
    .withMessage("Target IP is required")
    .matches(/^(\d{1,3}\.){3}\d{1,3}$/)
    .withMessage("Invalid target IP format"),
  body("method")
    .optional()
    .isIn(["bruteforce", "exploit", "social", "backdoor", "sql", "phishing", "rootkit"])
    .withMessage("Invalid hack method"),
  body("tools")
    .optional()
    .isArray()
    .withMessage("Tools must be an array"),
  body("tools.*")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage("Tool name too long"),
];

/**
 * File upload validation
 */
export const validateFileUpload = (): ValidationChain[] => [
  body("filename")
    .trim()
    .notEmpty()
    .withMessage("Filename is required")
    .isLength({ max: 255 })
    .withMessage("Filename too long")
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage("Filename contains invalid characters"),
  body("content")
    .notEmpty()
    .withMessage("File content is required")
    .isLength({ max: 1048576 }) // 1MB
    .withMessage("File content too large (max 1MB)"),
];

// ==================== SANITIZATION MIDDLEWARE ====================

/**
 * General input sanitization middleware
 * Applies to all requests to prevent common injection attacks
 */
export const sanitizeInputs = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  // Sanitize query parameters
  if (req.query) {
    Object.keys(req.query).forEach((key) => {
      if (typeof req.query[key] === "string") {
        // Remove null bytes
        req.query[key] = (req.query[key] as string).replace(/\0/g, "");
        // Trim whitespace
        req.query[key] = (req.query[key] as string).trim();
      }
    });
  }

  // Sanitize body parameters (already handled by express-validator in routes)
  // Additional sanitization for nested objects
  if (req.body && typeof req.body === "object") {
    sanitizeObject(req.body);
  }

  next();
};

/**
 * Recursively sanitize object properties
 */
function sanitizeObject(obj: any, depth: number = 0): void {
  // Prevent deep recursion (max 5 levels)
  if (depth > 5) return;

  Object.keys(obj).forEach((key) => {
    if (typeof obj[key] === "string") {
      // Remove null bytes
      obj[key] = obj[key].replace(/\0/g, "");
      // Trim whitespace
      obj[key] = obj[key].trim();
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      sanitizeObject(obj[key], depth + 1);
    }
  });
}

// ==================== SQL INJECTION PREVENTION ====================

/**
 * Detect potential SQL injection patterns
 * Note: Prisma ORM provides built-in protection, but this adds an extra layer
 */
export const detectSqlInjection = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|DECLARE)\b)/i,
    /(--|#|\/\*|\*\/)/,
    /(\bOR\b.*=.*)/i,
    /(\bAND\b.*=.*)/i,
    /(;.*--)/,
  ];

  const checkValue = (value: any): boolean => {
    if (typeof value === "string") {
      return suspiciousPatterns.some((pattern) => pattern.test(value));
    }
    if (typeof value === "object" && value !== null) {
      return Object.values(value).some((v) => checkValue(v));
    }
    return false;
  };

  // Check body, query, and params
  const suspicious =
    checkValue(req.body) || checkValue(req.query) || checkValue(req.params);

  if (suspicious) {
    res.status(400).json({
      success: false,
      error: "Invalid input detected",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
};

// ==================== XSS PREVENTION ====================

/**
 * Detect potential XSS patterns
 */
export const detectXss = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const xssPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi, // Event handlers like onclick=
    /<img[^>]*\s+src\s*=\s*["']?javascript:/gi,
  ];

  const checkValue = (value: any): boolean => {
    if (typeof value === "string") {
      return xssPatterns.some((pattern) => pattern.test(value));
    }
    if (typeof value === "object" && value !== null) {
      return Object.values(value).some((v) => checkValue(v));
    }
    return false;
  };

  const hasXss =
    checkValue(req.body) || checkValue(req.query) || checkValue(req.params);

  if (hasXss) {
    res.status(400).json({
      success: false,
      error: "Invalid input detected",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
};

// ==================== PATH TRAVERSAL PREVENTION ====================

/**
 * Detect path traversal attempts
 */
export const detectPathTraversal = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const pathTraversalPatterns = [
    /\.\./,
    /\.\.\//,
    /\.\.\\/,
    /%2e%2e/i,
    /%252e/i,
  ];

  const checkValue = (value: any): boolean => {
    if (typeof value === "string") {
      return pathTraversalPatterns.some((pattern) => pattern.test(value));
    }
    if (typeof value === "object" && value !== null) {
      return Object.values(value).some((v) => checkValue(v));
    }
    return false;
  };

  const hasTraversal =
    checkValue(req.body) || checkValue(req.query) || checkValue(req.params);

  if (hasTraversal) {
    res.status(400).json({
      success: false,
      error: "Invalid path detected",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
};

// ==================== COMBINED SECURITY MIDDLEWARE ====================

/**
 * Apply all security checks
 * Use this middleware on routes that need comprehensive protection
 */
export const securityMiddleware = [
  sanitizeInputs,
  detectSqlInjection,
  detectXss,
  detectPathTraversal,
];
