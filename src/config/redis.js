const redisModule = require('../../config/redis');

const client = redisModule.connection;

module.exports = {
	...redisModule,
	client,
	get: (...args) => client.get(...args),
	set: (...args) => client.set(...args),
	setex: (...args) => client.setex(...args),
	del: (...args) => client.del(...args),
	incr: (...args) => client.incr(...args),
	expire: (...args) => client.expire(...args),
	keys: (...args) => client.keys(...args),
	ping: (...args) => client.ping(...args)
};
