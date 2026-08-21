const express = require("express");
const vidsrcRouter = require("./vidsrc/vidsrcRoute");
const proxyRouter = require("./proxyRouter");
const cryptoRouter = require("./cryptoRouter");
const fetchRouter = require("./fetchRouter");
const globalRateLimiter = require("./rateLimiter");

const app = express();
const PORT = process.env.PORT || 3000;
const bodyParser = require("body-parser");

app.use(globalRateLimiter);
app.use(express.json());
app.use(bodyParser.text());
app.use(bodyParser.json());

app.use("/api", vidsrcRouter);
app.use("/api", proxyRouter);
app.use("/api", cryptoRouter);
app.use("/api", fetchRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
