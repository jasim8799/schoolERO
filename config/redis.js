const { Redis: UpstashRedis } = require('@upstash/redis');

const LOG_THROTTLE_MS = 30000;
const _lastLogAt = new Map();

function throttledLog(tag, key, message) {
  const now = Date.now();
  const last = _lastLogAt.get(key) || 0;
  if (now - last >= LOG_THROTTLE_MS) {
    _lastLogAt.set(key, now);
    console.log(`[${tag}] ${message}`);
  }
}

function createMemoryFallback() {
  const store = new Map();
  const lists = new Map();
  const hashes = new Map();
  const sets = new Map();
  const zsets = new Map();
  const expires = new Map();

  function checkExpiry(key) {
    const exp = expires.get(key);
    if (exp && Date.now() > exp) {
      store.delete(key);
      lists.delete(key);
      hashes.delete(key);
      sets.delete(key);
      zsets.delete(key);
      expires.delete(key);
      return true;
    }
    return false;
  }

  function patternToRegex(pattern) {
    return new RegExp('^' +
      String(pattern || '*').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  }

  const mock = {
    async get(key) {
      if (checkExpiry(key)) return null;
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, String(value));
      return 'OK';
    },
    async setex(key, seconds, value) {
      store.set(key, String(value));
      expires.set(key, Date.now() + Number(seconds) * 1000);
      return 'OK';
    },
    async del(...keys) {
      let count = 0;
      for (const k of keys.flat()) {
        if (store.delete(k) || lists.delete(k) || hashes.delete(k) || sets.delete(k) || zsets.delete(k)) {
          count += 1;
        }
        expires.delete(k);
      }
      return count;
    },
    async incr(key) {
      const val = parseInt(store.get(key) || '0', 10) + 1;
      store.set(key, String(val));
      return val;
    },
    async incrby(key, n) {
      const val = parseInt(store.get(key) || '0', 10) + Number(n);
      store.set(key, String(val));
      return val;
    },
    async decr(key) {
      const val = parseInt(store.get(key) || '0', 10) - 1;
      store.set(key, String(val));
      return val;
    },
    async expire(key, seconds) {
      expires.set(key, Date.now() + Number(seconds) * 1000);
      return 1;
    },
    async ttl(key) {
      const exp = expires.get(key);
      if (!exp) return -1;
      const remaining = Math.ceil((exp - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    },
    async exists(...keys) {
      return keys.flat().filter((k) => store.has(k) || lists.has(k) || hashes.has(k) || sets.has(k) || zsets.has(k)).length;
    },
    async ping() { return 'PONG'; },
    async keys(pattern) {
      const regex = patternToRegex(pattern || '*');
      const all = [...store.keys(), ...lists.keys(), ...hashes.keys(), ...sets.keys(), ...zsets.keys()];
      return all.filter((k) => regex.test(k));
    },
    async lpush(key, ...values) {
      if (!lists.has(key)) lists.set(key, []);
      const list = lists.get(key);
      list.unshift(...values.flat().map(String));
      return list.length;
    },
    async rpush(key, ...values) {
      if (!lists.has(key)) lists.set(key, []);
      const list = lists.get(key);
      list.push(...values.flat().map(String));
      return list.length;
    },
    async ltrim(key, start, stop) {
      const list = lists.get(key) || [];
      const s = Number(start);
      const e = Number(stop);
      const trimmed = e === -1 ? list.slice(s) : list.slice(s, e + 1);
      lists.set(key, trimmed);
      return 'OK';
    },
    async lrange(key, start, stop) {
      const list = lists.get(key) || [];
      const s = Number(start);
      const e = Number(stop);
      return e === -1 ? list.slice(s) : list.slice(s, e + 1);
    },
    async llen(key) {
      return (lists.get(key) || []).length;
    },
    async hset(key, ...args) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      const h = hashes.get(key);
      let pairs;
      if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
        pairs = Object.entries(args[0]);
      } else {
        pairs = [];
        for (let i = 0; i < args.length; i += 2) pairs.push([String(args[i]), String(args[i + 1])]);
      }
      for (const [f, v] of pairs) h.set(f, String(v));
      return pairs.length;
    },
    async hget(key, field) {
      return hashes.get(key)?.get(field) ?? null;
    },
    async hgetall(key) {
      const h = hashes.get(key);
      if (!h || h.size === 0) return null;
      return Object.fromEntries(h);
    },
    async hincrby(key, field, n) {
      if (!hashes.has(key)) hashes.set(key, new Map());
      const h = hashes.get(key);
      const val = parseInt(h.get(field) || '0', 10) + Number(n);
      h.set(field, String(val));
      return val;
    },
    async hdel(key, ...fields) {
      const h = hashes.get(key);
      if (!h) return 0;
      let count = 0;
      for (const f of fields.flat()) if (h.delete(String(f))) count += 1;
      return count;
    },
    async sadd(key, ...members) {
      if (!sets.has(key)) sets.set(key, new Set());
      const s = sets.get(key);
      let added = 0;
      for (const m of members.flat()) {
        const mem = String(m);
        if (!s.has(mem)) {
          s.add(mem);
          added += 1;
        }
      }
      return added;
    },
    async smembers(key) {
      return [...(sets.get(key) || new Set())];
    },
    async scard(key) {
      return (sets.get(key) || new Set()).size;
    },
    async srem(key, ...members) {
      const s = sets.get(key);
      if (!s) return 0;
      let removed = 0;
      for (const m of members.flat()) if (s.delete(String(m))) removed += 1;
      return removed;
    },
    async sismember(key, member) {
      return (sets.get(key) || new Set()).has(String(member)) ? 1 : 0;
    },
    async zadd(key, ...args) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      const z = zsets.get(key);
      let added = 0;
      if (typeof args[0] === 'object' && args[0] !== null) {
        for (const { score, member } of args) {
          const mem = String(member);
          if (!z.has(mem)) added += 1;
          z.set(mem, Number(score));
        }
      } else {
        for (let i = 0; i < args.length; i += 2) {
          const score = Number(args[i]);
          const mem = String(args[i + 1]);
          if (!z.has(mem)) added += 1;
          z.set(mem, score);
        }
      }
      return added;
    },
    async zincrby(key, increment, member) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      const z = zsets.get(key);
      const mem = String(member);
      const next = Number(z.get(mem) || 0) + Number(increment);
      z.set(mem, next);
      return next;
    },
    async zscore(key, member) {
      const z = zsets.get(key);
      if (!z) return null;
      const score = z.get(String(member));
      return score === undefined ? null : score;
    },
    async zrange(key, start, stop, options) {
      const z = zsets.get(key);
      if (!z) return [];
      const rev = options?.rev || options?.REV;
      const withScores = options?.withScores || options?.WITHSCORES;
      const sorted = [...z.entries()].sort((a, b) => rev ? b[1] - a[1] : a[1] - b[1]);
      const sliced = Number(stop) === -1 ? sorted.slice(Number(start)) : sorted.slice(Number(start), Number(stop) + 1);
      if (withScores) {
        return sliced.flatMap(([member, score]) => [member, String(score)]);
      }
      return sliced.map(([member]) => member);
    },
    async zrevrange(key, start, stop) {
      return this.zrange(key, start, stop, { rev: true });
    },
    async zcard(key) {
      return (zsets.get(key) || new Map()).size;
    },
    async zrem(key, ...members) {
      const z = zsets.get(key);
      if (!z) return 0;
      let removed = 0;
      for (const m of members.flat()) if (z.delete(String(m))) removed += 1;
      return removed;
    },
    async zrangebyscore(key, min, max) {
      const z = zsets.get(key);
      if (!z) return [];
      const minN = min === '-inf' ? -Infinity : Number(min);
      const maxN = max === '+inf' ? Infinity : Number(max);
      return [...z.entries()]
        .filter(([, score]) => score >= minN && score <= maxN)
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);
    },
    async zremrangebyscore(key, min, max) {
      const z = zsets.get(key);
      if (!z) return 0;
      const minN = min === '-inf' ? -Infinity : Number(min);
      const maxN = max === '+inf' ? Infinity : Number(max);
      let removed = 0;
      for (const [member, score] of z.entries()) {
        if (score >= minN && score <= maxN) {
          z.delete(member);
          removed += 1;
        }
      }
      return removed;
    },
    async publish() { return 0; },
    async subscribe() { return () => {}; },
    pipeline() {
      const ops = [];
      const pipe = new Proxy({}, {
        get: (_, cmd) => {
          if (cmd === 'exec') return async () => Promise.all(ops.map((o) => o()));
          return (...args) => {
            ops.push(() => mock[cmd]?.(...args));
            return pipe;
          };
        }
      });
      return pipe;
    },
    multi() { return this.pipeline(); },
    async flushall() {
      store.clear();
      lists.clear();
      hashes.clear();
      sets.clear();
      zsets.clear();
      expires.clear();
      return 'OK';
    },
    disconnect() {},
    async quit() { return 'OK'; },
    on() { return this; },
  };

  mock.client = mock;
  mock.connection = mock;
  return mock;
}

function createUpstashAdapter(client) {
  const adapter = {
    async get(key) { return client.get(key); },
    async set(key, value) { return client.set(key, String(value)); },
    async setex(key, seconds, value) { return client.setex(key, Number(seconds), String(value)); },
    async del(...keys) { return client.del(...keys.flat()); },
    async incr(key) { return client.incr(key); },
    async incrby(key, n) { return client.incrby(key, Number(n)); },
    async decr(key) { return client.decr(key); },
    async expire(key, seconds) { return client.expire(key, Number(seconds)); },
    async ttl(key) { return client.ttl(key); },
    async exists(...keys) { return client.exists(...keys.flat()); },
    async ping() { return client.ping(); },
    async keys(pattern) { return client.keys(pattern); },
    async lpush(key, ...values) { return client.lpush(key, ...values.flat().map(String)); },
    async rpush(key, ...values) { return client.rpush(key, ...values.flat().map(String)); },
    async ltrim(key, start, stop) { return client.ltrim(key, Number(start), Number(stop)); },
    async lrange(key, start, stop) { return client.lrange(key, Number(start), Number(stop)); },
    async llen(key) { return client.llen(key); },
    async hset(key, ...args) {
      if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) return client.hset(key, args[0]);
      const obj = {};
      for (let i = 0; i < args.length; i += 2) obj[String(args[i])] = String(args[i + 1]);
      return client.hset(key, obj);
    },
    async hget(key, field) { return client.hget(key, field); },
    async hgetall(key) { return client.hgetall(key); },
    async hincrby(key, field, n) { return client.hincrby(key, field, Number(n)); },
    async hdel(key, ...fields) { return client.hdel(key, ...fields.flat()); },
    async sadd(key, ...members) { return client.sadd(key, ...members.flat().map(String)); },
    async smembers(key) { return client.smembers(key); },
    async scard(key) { return client.scard(key); },
    async srem(key, ...members) { return client.srem(key, ...members.flat().map(String)); },
    async sismember(key, member) { return client.sismember(key, String(member)); },
    async zadd(key, ...args) {
      if (typeof args[0] === 'object' && args[0] !== null) {
        return client.zadd(key, ...args);
      }
      const pairs = [];
      for (let i = 0; i < args.length; i += 2) pairs.push({ score: Number(args[i]), member: String(args[i + 1]) });
      return client.zadd(key, ...pairs);
    },
    async zincrby(key, increment, member) { return client.zincrby(key, Number(increment), String(member)); },
    async zscore(key, member) { return client.zscore(key, String(member)); },
    async zrange(key, start, stop, options) {
      return client.zrange(key, Number(start), Number(stop), options?.rev || options?.REV ? { rev: true } : undefined);
    },
    async zrevrange(key, start, stop) { return client.zrange(key, Number(start), Number(stop), { rev: true }); },
    async zcard(key) { return client.zcard(key); },
    async zrem(key, ...members) { return client.zrem(key, ...members.flat().map(String)); },
    async zrangebyscore(key, min, max) { return client.zrangebyscore(key, min, max); },
    async zremrangebyscore(key, min, max) { return client.zremrangebyscore(key, min, max); },
    async publish() { return 0; },
    async subscribe() { return () => {}; },
    pipeline() {
      const ops = [];
      const self = this;
      const pipe = new Proxy({}, {
        get: (_, cmd) => {
          if (cmd === 'exec') {
            return async () => Promise.all(ops.map((o) => o().catch(() => null)));
          }
          return (...args) => {
            ops.push(() => self[cmd]?.(...args));
            return pipe;
          };
        }
      });
      return pipe;
    },
    multi() { return this.pipeline(); },
    async flushall() { return client.flushdb(); },
    disconnect() {},
    async quit() { return 'OK'; },
    on() { return this; },
  };

  adapter.client = adapter;
  adapter.connection = adapter;
  return adapter;
}

function createSafeClient(inner) {
  const READ_OPS = new Set(['get', 'hget', 'hgetall', 'smembers', 'zrange', 'zscore', 'lrange', 'ttl', 'exists', 'keys']);
  const WRITE_OPS = new Set(['set', 'setex', 'del', 'incr', 'incrby', 'decr', 'expire', 'hset', 'hincrby', 'hdel', 'sadd', 'srem', 'zadd', 'zincrby', 'zrem', 'lpush', 'rpush', 'ltrim', 'flushall']);

  const safe = new Proxy(inner, {
    get(target, prop) {
      const val = target[prop];
      if (typeof val !== 'function') return val;
      return async (...args) => {
        try {
          const method = String(prop);
          if (READ_OPS.has(method)) {
            throttledLog('REDIS_ANALYTICS', `read:${method}`, `Read op ${method} via centralized adapter`);
          } else if (WRITE_OPS.has(method)) {
            throttledLog('REDIS_ANALYTICS', `write:${method}`, `Write op ${method} via centralized adapter`);
          }
          return await val.apply(target, args);
        } catch (err) {
          const msg = err?.message || 'Redis error';
          if (!/NOSCRIPT|WRONGTYPE|no such key|key does not exist/i.test(msg)) {
            console.warn(`[Redis:${String(prop)}] ${msg}`);
          }
          return null;
        }
      };
    }
});

  safe.client = safe;
  safe.connection = safe;
  safe.supportsBullmq = false;
  safe.transport = 'upstash-rest-or-memory';
  safe.on = () => safe;
  return safe;
}

let redisClient;
const restUrl = process.env.UPSTASH_REDIS_REST_URL;
const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (restUrl && restToken) {
  try {
    const raw = new UpstashRedis({ url: restUrl, token: restToken });
    redisClient = createSafeClient(createUpstashAdapter(raw));
    redisClient.mode = 'upstash';
    console.log('[REDIS_CONNECTED] Upstash REST adapter initialized');
  } catch (err) {
    console.warn(`[REDIS_FALLBACK] Upstash init failed, switching to memory fallback: ${err.message}`);
    redisClient = createSafeClient(createMemoryFallback());
    redisClient.mode = 'memory_fallback';
  }
} else {
  console.warn('[REDIS_FALLBACK] UPSTASH_REDIS_REST_URL/TOKEN missing, using memory fallback');
  redisClient = createSafeClient(createMemoryFallback());
  redisClient.mode = 'memory_fallback';
}

module.exports = redisClient;
