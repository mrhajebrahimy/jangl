/** Structured JSON logs. Callers must never pass credentials, tokens, bodies or state. */
export function log(level, msg, fields = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n');
}
