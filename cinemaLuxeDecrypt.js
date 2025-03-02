const express = require("express");

const router = express.Router();

router.post("/cinemaluxe", async (req, res) => {
  try {
    const { url } = req?.body;

    if (!url) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // fetch url
    const response = await fetch(url);
    const data = await response.text();

    const regex = /var item = (\{.*?\});/s; // Extracts the full object inside `{}` including newlines
    const optionRegex = /var options = (\{.*?\});/s; // Extracts the full object inside `{}` including newlines
    const optionsMatch = data.match(optionRegex);
    const match = data.match(regex);

    if (match) {
      const optionsObject = optionsMatch[1]; // Extract the full object as a string
      const itemObject = match[1]; // Extract the full object as a string
      console.log("Extracted item object:", itemObject);
      // Convert the extracted string into a JavaScript object
      try {
        let parsedItem = JSON.parse(itemObject);
        const parsedOptions = JSON.parse(optionsObject);
        // console.log("Parsed JSON Object:", parsedItem);
        const redirectUrl = await submitForm(parsedItem, parsedOptions);
        res.json({ redirectUrl });
      } catch (error) {
        console.error("Error parsing JSON object:", error);
        res.status(500).json({ error: "Error parsing JSON object" });
      }
    } else {
      throw new Error("No match found");
    }
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: error?.message });
  }
});

async function submitForm(details, parsedOptions, tryCount = 0) {
  // Make tryCount a parameter with default value
  var data = new URLSearchParams();
  for (const property in details) {
    data.append(property, details[property]);
  }
  data.append("action", parsedOptions.soralink_z);

  console.log("Form data:", data.toString());
  console.log("Current try count:⭐⭐⭐⭐", tryCount);

  const maxTries = 5;

  try {
    // Make the POST request - setting redirect to 'manual' to not follow redirects
    const response = await fetch(details.redirect, {
      method: "POST",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "en-US,en;q=0.9,en-IN;q=0.8",
        "cache-control": "no-cache",
        "content-type": "application/x-www-form-urlencoded",
        pragma: "no-cache",
        priority: "u=0, i",
        "sec-ch-ua":
          '"Not(A:Brand";v="99", "Microsoft Edge";v="133", "Chromium";v="133"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        cookie: "ext_name=ojplmecpdpgccookcobabopnaifgidhf",
        Referer: "https://hdmovie.website/future-of-blockchain-2025/",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
      body: data,
      redirect: "manual", // Don't follow redirects automatically
    });

    // Check the response status
    console.log("Response status:", response.status);

    // If we got a redirect (3xx status code)
    if (response.status >= 300 && response.status < 400) {
      // Get and log the redirect URL from the Location header
      const redirectUrl = response.headers.get("Location");
      console.log("Redirect URL:", redirectUrl);
      return redirectUrl;
    } else if (response.status === 200) {
      if (tryCount < maxTries) {
        console.log("Retrying form submission, try count:🔥", tryCount + 1);
        return submitForm(details, tryCount + 1); // Pass the incremented tryCount
      } else {
        console.log("Maximum retries reached");
      }
    } else {
      console.error("Form submission failed with status:", response.status);
    }
  } catch (error) {
    console.error("Error submitting form:", error);
  }
}

module.exports = router;
