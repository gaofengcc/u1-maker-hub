/** Runs once when the server starts. Node-only setup lives in its own file so the Edge bundle never sees node: modules. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation.node");
}
