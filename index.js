const express = require("express");
const decryptRouter = require("./decryptRouter");

const app = express();
const PORT = process.env.PORT || 3000;
const bodyParser = require("body-parser");

app.use(express.json());
app.use(bodyParser.text());

app.use("/api", decryptRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
