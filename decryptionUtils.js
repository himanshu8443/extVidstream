const crypto = require("crypto");

function safeDecryptAndLog(encryptedJsonStr, passphrase) {
  try {
    // Parse the encrypted JSON string
    const encryptedData = JSON.parse(encryptedJsonStr);

    // Convert hex and base64 strings to buffers
    const salt = Buffer.from(encryptedData.s, "hex");
    const iv = Buffer.from(encryptedData.iv, "hex");
    const ct = Buffer.from(encryptedData.ct, "base64");

    // Key derivation (matching PHP implementation)
    let key = "";
    let previousBlock;
    const numberOfBlocks = Math.ceil(32 / 16); // 32 bytes = 256 bits for AES-256

    for (let i = 0; i < numberOfBlocks; i++) {
      const currentBlock = crypto
        .createHash("md5")
        .update(previousBlock || "")
        .update(passphrase)
        .update(salt)
        .digest();

      previousBlock = currentBlock;
      key += currentBlock.toString("binary");
    }

    // Create 32 byte key
    key = Buffer.from(key, "binary").slice(0, 32);

    // Decrypt the content
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(ct);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // Parse the decrypted content
    const decryptedData = JSON.parse(decrypted.toString("utf8"));

    return {
      success: true,
      decrypted: decryptedData,
    };
  } catch (error) {
    console.error("Decryption failed:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  safeDecryptAndLog,
};
