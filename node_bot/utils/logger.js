/**
 * Logging utilities with colors and timestamps
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function log(message, data = null) {
  const timestamp = getTimestamp();
  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ${colors.cyan}ℹ${colors.reset} ${message}`
  );
  if (data) {
    console.log(colors.dim, data, colors.reset);
  }
}

export function logSuccess(message, data = null) {
  const timestamp = getTimestamp();
  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ${colors.green}✓${colors.reset} ${colors.bright}${message}${colors.reset}`
  );
  if (data) {
    console.log(colors.dim, data, colors.reset);
  }
}

export function logError(message, error = null) {
  const timestamp = getTimestamp();
  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ${colors.red}✗${colors.reset} ${colors.red}${message}${colors.reset}`
  );
  if (error) {
    console.error(colors.red, error, colors.reset);
  }
}

export function logWarning(message, data = null) {
  const timestamp = getTimestamp();
  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ${colors.yellow}⚠${colors.reset} ${colors.yellow}${message}${colors.reset}`
  );
  if (data) {
    console.log(colors.dim, data, colors.reset);
  }
}

export function logDebug(message, data = null) {
  if (process.env.DEBUG !== 'true') return;
  
  const timestamp = getTimestamp();
  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ${colors.magenta}⚙${colors.reset} ${colors.dim}${message}${colors.reset}`
  );
  if (data) {
    console.log(colors.dim, JSON.stringify(data, null, 2), colors.reset);
  }
}