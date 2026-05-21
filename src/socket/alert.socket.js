function initAlertSocket(io) {
  const nsp = io.of('/alerts');

  nsp.on('connection', (socket) => {
    socket.on('alerts:subscribe', () => {
      socket.join('alerts:global');
    });
  });

  return nsp;
}

function broadcastSecurityAlert(payload) {
  if (!global.io) return;
  global.io.of('/alerts').to('alerts:global').emit('alerts:security', payload);
}

module.exports = { initAlertSocket, broadcastSecurityAlert };
