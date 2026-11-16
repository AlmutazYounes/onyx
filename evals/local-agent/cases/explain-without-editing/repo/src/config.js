const DEFAULTS = { port: 8080, retries: 3, logLevel: "info" };

/** Merges environment overrides onto the defaults; unknown keys are ignored. */
export function loadConfig(env = process.env) {
  const config = { ...DEFAULTS };
  if (env.APP_PORT) config.port = Number(env.APP_PORT);
  if (env.APP_RETRIES) config.retries = Math.max(0, Number(env.APP_RETRIES));
  if (env.APP_LOG_LEVEL) config.logLevel = env.APP_LOG_LEVEL.toLowerCase();
  return Object.freeze(config);
}
