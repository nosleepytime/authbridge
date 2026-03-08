export async function first(env, sql, ...params) {
  return env.AUTHBRIDGE_DB.prepare(sql).bind(...params).first();
}

export async function all(env, sql, ...params) {
  const result = await env.AUTHBRIDGE_DB.prepare(sql).bind(...params).all();
  return result.results || [];
}

export async function run(env, sql, ...params) {
  return env.AUTHBRIDGE_DB.prepare(sql).bind(...params).run();
}
