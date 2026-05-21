// In-memory Redis mock fallback.
// Uses external Redis only when REDIS_URL is configured and reachable.

let client = null;

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 3000,
      commandTimeout: 2000,
      retryStrategy: () => null,
    });

    client.on('error', (err) => {
      console.warn('[Redis] Connection error (using in-memory fallback):', err.code || err.message);
    });
  } catch (_) {
    client = null;
  }
}

const _store = new Map();
const _expiry = new Map();

function _isExpired(key) {
  const exp = _expiry.get(key);
  if (!exp) return false;
  if (Date.now() > exp) {
    _store.delete(key);
    _expiry.delete(key);
    return true;
  }
  return false;
}

function _patternToRegex(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

const mock = {
  get: async (key) => {
    if (_isExpired(key)) return null;
    return _store.get(key) ?? null;
  },
  set: async (key, value) => {
    _store.set(key, String(value));
    return 'OK';
  },
  setex: async (key, seconds, value) => {
    _store.set(key, String(value));
    _expiry.set(key, Date.now() + Number(seconds) * 1000);
    return 'OK';
  },
  del: async (...keys) => {
    let count = 0;
    for (const key of keys.flat()) {
      if (_store.has(key)) {
        _store.delete(key);
        _expiry.delete(key);
        count += 1;
      }
    }
    return count;
  },
  incr: async (key) => {
    if (_isExpired(key)) _store.delete(key);
    const current = parseInt(_store.get(key) || '0', 10);
    const next = current + 1;
    _store.set(key, String(next));
    return next;
  },
  expire: async (key, seconds) => {
    if (_store.has(key)) {
      _expiry.set(key, Date.now() + Number(seconds) * 1000);
      return 1;
    }
    return 0;
  },
  keys: async (pattern) => {
    const regex = _patternToRegex(pattern);
    return [..._store.keys()].filter((k) => !_isExpired(k) && regex.test(k));
  },
  ping: async () => 'PONG',
  exists: async (key) => {
    if (_isExpired(key)) return 0;
    return _store.has(key) ? 1 : 0;
  },
  ttl: async (key) => {
    if (_isExpired(key)) return -2;
    const exp = _expiry.get(key);
    if (!exp) return -1;
    return Math.max(0, Math.ceil((exp - Date.now()) / 1000));
  },
  flushall: async () => {
    _store.clear();
    _expiry.clear();
    return 'OK';
  },
  disconnect: () => {},
  quit: async () => 'OK',
};

mock.on = () => mock;
mock.connection = mock;
mock.client = mock;

if (client) {
  const _wrap = (method, mockFn) => async (...args) => {
    try {
      return await Promise.race([
        client[method](...args),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 2000)),
      ]);
    } catch (_) {
      return mockFn(...args);
    }
  };

  module.exports = {
    get: _wrap('get', mock.get),
    set: _wrap('set', mock.set),
    setex: _wrap('setex', mock.setex),
    del: _wrap('del', mock.del),
    incr: _wrap('incr', mock.incr),
    expire: _wrap('expire', mock.expire),
    keys: _wrap('keys', mock.keys),
    ping: _wrap('ping', mock.ping),
    exists: _wrap('exists', mock.exists),
    ttl: _wrap('ttl', mock.ttl),
    flushall: _wrap('flushall', mock.flushall),
    connection: client,
    client,
    on: (event, cb) => {
      client.on(event, cb);
      return module.exports;
    },
  };
} else {
  console.log('[Redis] No REDIS_URL set - using in-memory cache (non-persistent)');
  module.exports = {
    ...mock,
    client: mock,
    connection: mock,
  };
}
