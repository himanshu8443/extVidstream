const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const HASH_ALGORITHMS = new Set([
  "md5",
  "sha1",
  "sha224",
  "sha256",
  "sha384",
  "sha512",
  "sha3-224",
  "sha3-256",
  "sha3-384",
  "sha3-512",
]);
const AES_ALGORITHMS = new Map([
  ["aes-128-cbc", { keyLength: 16, ivLength: 16 }],
  ["aes-192-cbc", { keyLength: 24, ivLength: 16 }],
  ["aes-256-cbc", { keyLength: 32, ivLength: 16 }],
  ["aes-128-ctr", { keyLength: 16, ivLength: 16 }],
  ["aes-192-ctr", { keyLength: 24, ivLength: 16 }],
  ["aes-256-ctr", { keyLength: 32, ivLength: 16 }],
  ["aes-128-gcm", { keyLength: 16, ivLength: 12, authenticated: true }],
  ["aes-192-gcm", { keyLength: 24, ivLength: 12, authenticated: true }],
  ["aes-256-gcm", { keyLength: 32, ivLength: 12, authenticated: true }],
]);
const ENCODINGS = new Set(["utf8", "hex", "base64", "base64url", "latin1"]);

function requireString(value, field) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function getEncoding(value, fallback, field) {
  const encoding = value || fallback;
  if (!ENCODINGS.has(encoding)) {
    throw new Error(`${field} must be one of: ${[...ENCODINGS].join(", ")}`);
  }
  return encoding;
}

function getBuffer(value, encoding, field) {
  return Buffer.from(requireString(value, field), encoding);
}

function getHashAlgorithm(value) {
  const algorithm = String(value || "sha256").toLowerCase();
  if (!HASH_ALGORITHMS.has(algorithm)) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }
  return algorithm;
}

function getAesConfig(value) {
  const algorithm = String(value || "aes-256-gcm").toLowerCase();
  const config = AES_ALGORITHMS.get(algorithm);
  if (!config) {
    throw new Error(`Unsupported AES algorithm: ${algorithm}`);
  }
  return { algorithm, ...config };
}

function getSizedBuffer(value, encoding, field, expectedLength) {
  const buffer = getBuffer(value, encoding, field);
  if (buffer.length !== expectedLength) {
    throw new Error(`${field} must be ${expectedLength} bytes`);
  }
  return buffer;
}

function hash(body) {
  const algorithm = getHashAlgorithm(body.algorithm);
  const inputEncoding = getEncoding(
    body.inputEncoding,
    "utf8",
    "inputEncoding",
  );
  const outputEncoding = getEncoding(
    body.outputEncoding,
    "hex",
    "outputEncoding",
  );
  const result = crypto
    .createHash(algorithm)
    .update(getBuffer(body.data, inputEncoding, "data"))
    .digest(outputEncoding);
  return { algorithm, result };
}

function hmac(body) {
  const algorithm = getHashAlgorithm(body.algorithm);
  const inputEncoding = getEncoding(
    body.inputEncoding,
    "utf8",
    "inputEncoding",
  );
  const keyEncoding = getEncoding(body.keyEncoding, "utf8", "keyEncoding");
  const outputEncoding = getEncoding(
    body.outputEncoding,
    "hex",
    "outputEncoding",
  );
  const result = crypto
    .createHmac(algorithm, getBuffer(body.key, keyEncoding, "key"))
    .update(getBuffer(body.data, inputEncoding, "data"))
    .digest(outputEncoding);
  return { algorithm, result };
}

function encrypt(body) {
  const config = getAesConfig(body.algorithm);
  const inputEncoding = getEncoding(
    body.inputEncoding,
    "utf8",
    "inputEncoding",
  );
  const keyEncoding = getEncoding(body.keyEncoding, "base64", "keyEncoding");
  const ivEncoding = getEncoding(body.ivEncoding, "base64", "ivEncoding");
  const outputEncoding = getEncoding(
    body.outputEncoding,
    "base64",
    "outputEncoding",
  );
  const key = getSizedBuffer(body.key, keyEncoding, "key", config.keyLength);
  const iv = getSizedBuffer(body.iv, ivEncoding, "iv", config.ivLength);
  const cipher = crypto.createCipheriv(config.algorithm, key, iv);

  if (body.aad !== undefined) {
    const aadEncoding = getEncoding(body.aadEncoding, "utf8", "aadEncoding");
    cipher.setAAD(getBuffer(body.aad, aadEncoding, "aad"));
  }

  const encrypted = Buffer.concat([
    cipher.update(getBuffer(body.data, inputEncoding, "data")),
    cipher.final(),
  ]);
  const result = {
    algorithm: config.algorithm,
    ciphertext: encrypted.toString(outputEncoding),
    outputEncoding,
  };
  if (config.authenticated) {
    result.authTag = cipher.getAuthTag().toString(outputEncoding);
  }
  return result;
}

function decrypt(body) {
  const config = getAesConfig(body.algorithm);
  const inputEncoding = getEncoding(
    body.inputEncoding,
    "base64",
    "inputEncoding",
  );
  const keyEncoding = getEncoding(body.keyEncoding, "base64", "keyEncoding");
  const ivEncoding = getEncoding(body.ivEncoding, "base64", "ivEncoding");
  const outputEncoding = getEncoding(
    body.outputEncoding,
    "utf8",
    "outputEncoding",
  );
  const key = getSizedBuffer(body.key, keyEncoding, "key", config.keyLength);
  const iv = getSizedBuffer(body.iv, ivEncoding, "iv", config.ivLength);
  const decipher = crypto.createDecipheriv(config.algorithm, key, iv);

  if (config.authenticated) {
    const authTagEncoding = getEncoding(
      body.authTagEncoding,
      inputEncoding,
      "authTagEncoding",
    );
    decipher.setAuthTag(getBuffer(body.authTag, authTagEncoding, "authTag"));
  }
  if (body.aad !== undefined) {
    const aadEncoding = getEncoding(body.aadEncoding, "utf8", "aadEncoding");
    decipher.setAAD(getBuffer(body.aad, aadEncoding, "aad"));
  }

  const decrypted = Buffer.concat([
    decipher.update(getBuffer(body.data, inputEncoding, "data")),
    decipher.final(),
  ]);
  return {
    algorithm: config.algorithm,
    result: decrypted.toString(outputEncoding),
  };
}

function deriveKey(body) {
  const method = String(body.method || "pbkdf2").toLowerCase();
  const passwordEncoding = getEncoding(
    body.passwordEncoding,
    "utf8",
    "passwordEncoding",
  );
  const saltEncoding = getEncoding(body.saltEncoding, "base64", "saltEncoding");
  const outputEncoding = getEncoding(
    body.outputEncoding,
    "base64",
    "outputEncoding",
  );
  const password = getBuffer(body.password, passwordEncoding, "password");
  const salt = getBuffer(body.salt, saltEncoding, "salt");
  const keyLength = Number(body.keyLength || 32);
  if (!Number.isInteger(keyLength) || keyLength < 1 || keyLength > 1024) {
    throw new Error("keyLength must be an integer between 1 and 1024");
  }

  if (method === "pbkdf2") {
    const iterations = Number(body.iterations || 100000);
    const digest = getHashAlgorithm(body.digest || "sha256");
    if (
      !Number.isInteger(iterations) ||
      iterations < 1 ||
      iterations > 10000000
    ) {
      throw new Error("iterations must be an integer between 1 and 10000000");
    }
    return {
      method,
      result: crypto
        .pbkdf2Sync(password, salt, iterations, keyLength, digest)
        .toString(outputEncoding),
    };
  }
  if (method === "scrypt") {
    return {
      method,
      result: crypto
        .scryptSync(password, salt, keyLength)
        .toString(outputEncoding),
    };
  }
  throw new Error("method must be pbkdf2 or scrypt");
}

function random(body) {
  const size = Number(body.size || 32);
  const outputEncoding = getEncoding(
    body.outputEncoding,
    "base64",
    "outputEncoding",
  );
  if (!Number.isInteger(size) || size < 1 || size > 65536) {
    throw new Error("size must be an integer between 1 and 65536");
  }
  return { size, result: crypto.randomBytes(size).toString(outputEncoding) };
}

const OPERATIONS = {
  hash,
  hmac,
  encrypt,
  decrypt,
  deriveKey,
  random,
  uuid: () => ({ result: crypto.randomUUID() }),
};

router.get("/crypto", (req, res) => {
  res.json({
    operations: Object.keys(OPERATIONS),
    hashAlgorithms: [...HASH_ALGORITHMS],
    aesAlgorithms: [...AES_ALGORITHMS.keys()],
    encodings: [...ENCODINGS],
  });
});

router.post("/crypto", (req, res) => {
  const operation = req.body?.operation;
  const handler = OPERATIONS[operation];
  if (!handler) {
    return res.status(400).json({
      error: `operation must be one of: ${Object.keys(OPERATIONS).join(", ")}`,
    });
  }

  try {
    return res.json({ operation, ...handler(req.body) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
