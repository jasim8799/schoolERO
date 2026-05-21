const crypto = require('crypto');

function requestTracer(req, res, next) {
  const traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);
  next();
}

module.exports = { requestTracer };
