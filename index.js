const express = require("express");
const decryptRouter = require("./decryptRouter");

const app = express();
const PORT = process.env.PORT || 3000;

app.use("/api", decryptRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
