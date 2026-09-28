import test from "node:test";
import assert from "node:assert/strict";
import { deploymentPayload, isSolanaAddress } from "../src/j7.js";

test("accepts a public Solana wallet address", () => {
  assert.equal(isSolanaAddress("11111111111111111111111111111111"), true);
});

test("rejects secrets and malformed destinations", () => {
  assert.equal(isSolanaAddress("not-a-wallet"), false);
  assert.equal(isSolanaAddress("0x0000000000000000000000000000000000000000"), false);
});

test("redacts the encrypted wallet credential from dry-run payloads", () => {
  const payload = deploymentPayload({
    name: "Test Coin",
    ticker: "TEST",
    description: "Dry-run test",
    sourceUrl: "https://x.com/example/status/1",
    imageUrl: "",
  }, { redactApiKey: true });

  assert.equal(payload.api_key, "<redacted:J7_ENCRYPTED_SOLANA_KEY>");
});
