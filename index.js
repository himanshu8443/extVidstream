const express = require("express");
const decryptRouter = require("./decryptRouter");
const whvxTokenRouter = require("./whvxTokenRouter");
const cinemaLuxeRouter = require("./cinemaLuxeDecrypt");

const app = express();
const PORT = process.env.PORT || 3000;
const bodyParser = require("body-parser");

app.use(express.json());
app.use(bodyParser.text());
app.use(bodyParser.json());

app.use("/api", decryptRouter);
app.use("/api", whvxTokenRouter);
app.use("/api", cinemaLuxeRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
