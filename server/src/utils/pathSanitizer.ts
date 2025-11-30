/**
 * Path Sanitization Utilities
 * 
 * Provides security functions to prevent directory traversal attacks
 * and validate file system paths in the virtual file system.
 */

/**
 * Sanitize a path by removing unsafe components
 * @param path - The path to sanitize
 * @returns Sanitized path
 */
export function sanitizePath(path: string): string {
  if (!path) {
    return '/';
  }

  // Remove null bytes
  let sanitized = path.replace(/\0/g, '');

  // Remove any Windows-style paths (absolute paths with drive letters)
  sanitized = sanitized.replace(/^[a-zA-Z]:/, '');

  // Normalize multiple slashes
  sanitized = sanitized.replace(/\/+/g, '/');

  // Split into components
  const parts = sanitized.split('/').filter(p => p.length > 0);
  const cleaned: string[] = [];

  for (const part of parts) {
    // Skip current directory references
    if (part === '.') {
      continue;
    }

    // Handle parent directory references
    if (part === '..') {
      // Only pop if we have something to pop
      if (cleaned.length > 0) {
        cleaned.pop();
      }
      continue;
    }

    // Add normal path component
    cleaned.push(part);
  }

  // Return absolute path
  return '/' + cleaned.join('/');
}

/**
 * Check if a path is safe (doesn't contain traversal attempts)
 * @param path - The path to validate
 * @returns True if path is safe
 */
export function isPathSafe(path: string): boolean {
  if (!path || typeof path !== 'string') {
    return false;
  }

  // Check for null bytes
  if (path.includes('\0')) {
    return false;
  }

  // Check for absolute paths (should be handled within virtual FS)
  if (path.startsWith('//') || /^[a-zA-Z]:/.test(path)) {
    return false;
  }

  // Check for suspicious patterns
  const dangerous = [
    /\.\.[\/\\]/,  // Parent directory traversal
    /[\/\\]\.\./,  // Parent directory traversal
    /^\.\.$/,      // Just ".."
    /\0/,          // Null bytes
  ];

  for (const pattern of dangerous) {
    if (pattern.test(path)) {
      return false;
    }
  }

  return true;
}

/**
 * Normalize a path to canonical form
 * This is similar to sanitizePath but preserves the original intent
 * @param path - The path to normalize
 * @returns Normalized path
 */
export function normalizePath(path: string): string {
  if (!path) {
    return '/';
  }

  // First sanitize
  const sanitized = sanitizePath(path);

  // Ensure it starts with /
  if (!sanitized.startsWith('/')) {
    return '/' + sanitized;
  }

  return sanitized;
}

/**
 * Validate filename (no path components)
 * @param filename - The filename to validate
 * @returns True if filename is valid
 */
export function isValidFilename(filename: string): boolean {
  if (!filename || typeof filename !== 'string') {
    return false;
  }

  // Check length
  if (filename.length === 0 || filename.length > 255) {
    return false;
  }

  // Check for path separators
  if (filename.includes('/') || filename.includes('\\')) {
    return false;
  }

  // Check for null bytes
  if (filename.includes('\0')) {
    return false;
  }

  // Check for reserved names (Unix)
  if (filename === '.' || filename === '..') {
    return false;
  }

  // Check for control characters
  if (/[\x00-\x1f\x7f]/.test(filename)) {
    return false;
  }

  return true;
}

/**
 * Join path components safely
 * @param base - Base path
 * @param parts - Path components to join
 * @returns Joined and sanitized path
 */
export function joinPath(base: string, ...parts: string[]): string {
  const allParts = [base, ...parts].filter(p => p && p.length > 0);
  const joined = allParts.join('/');
  return sanitizePath(joined);
}

/**
 * Get the parent directory of a path
 * @param path - The path
 * @returns Parent directory path
 */
export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  
  if (normalized === '/') {
    return '/';
  }

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === 0) {
    return '/';
  }

  return normalized.substring(0, lastSlash);
}

/**
 * Extract filename from path
 * @param path - The path
 * @returns Filename
 */
export function getFilename(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  
  if (lastSlash === -1) {
    return normalized;
  }

  return normalized.substring(lastSlash + 1);
}
