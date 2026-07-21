export function readServerConfig(env = process.env) {
  const port = Number(env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT 必须是 1 到 65535 之间的整数");
  }

  return {
    host: String(env.HOST || "127.0.0.1"),
    port
  };
}
