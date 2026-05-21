function initSchoolSocket(io) {
  const nsp = io.of('/school');

  nsp.on('connection', (socket) => {
    socket.on('school:subscribe', (schoolId) => {
      if (!schoolId) return;
      socket.join(`school:${schoolId}`);
    });

    socket.on('school:unsubscribe', (schoolId) => {
      if (!schoolId) return;
      socket.leave(`school:${schoolId}`);
    });
  });

  return nsp;
}

function emitSchoolUpdate(io, schoolId, payload) {
  io.of('/school').to(`school:${schoolId}`).emit('school:update', payload);
}

module.exports = { initSchoolSocket, emitSchoolUpdate };
