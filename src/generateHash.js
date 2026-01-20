const bcrypt = require('bcrypt');

(async () => {
  const password = "Principal@123";
  const hash = await bcrypt.hash(password, 12);
  console.log("PASSWORD:", password);
  console.log("HASH:", hash);
})();
