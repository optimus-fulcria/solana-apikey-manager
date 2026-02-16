#!/usr/bin/env node

/**
 * Solana API Key Manager CLI
 *
 * A command-line interface for interacting with the on-chain API key management system.
 */

const anchor = require("@coral-xyz/anchor");
const { Command } = require("commander");
const fs = require("fs");
const path = require("path");

// Load program IDL
const idlPath = path.join(__dirname, "target/idl/solana_apikey_manager.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// Setup connection and provider
function getProvider() {
  const connection = new anchor.web3.Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  // Load wallet from default location or environment
  const walletPath = process.env.SOLANA_WALLET_PATH ||
    path.join(process.env.HOME, ".config", "solana", "id.json");

  const wallet = anchor.Wallet.local(walletPath);

  return new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
}

function getProgram(provider) {
  const programId = new anchor.web3.PublicKey(idl.address);
  return new anchor.Program(idl, provider);
}

async function getServicePda(program, authority) {
  const [pda] = await anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("service"), authority.toBuffer()],
    program.programId
  );
  return pda;
}

async function getApiKeyPda(program, servicePda, owner, keyIndex) {
  const [pda] = await anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("apikey"),
      servicePda.toBuffer(),
      owner.toBuffer(),
      new anchor.BN(keyIndex).toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  return pda;
}

// CLI Setup
const cli = new Command();

cli
  .name("apikey-manager")
  .description("Solana API Key Manager CLI")
  .version("1.0.0");

// Initialize Service
cli
  .command("init-service")
  .description("Initialize a new API service")
  .requiredOption("-n, --name <name>", "Service name")
  .option("-r, --rate-limit <limit>", "Default rate limit (requests/day)", "1000")
  .action(async (options) => {
    try {
      const provider = getProvider();
      const program = getProgram(provider);
      const authority = provider.wallet.publicKey;

      const servicePda = await getServicePda(program, authority);

      console.log("Initializing service...");
      console.log("  Service PDA:", servicePda.toString());
      console.log("  Authority:", authority.toString());

      const tx = await program.methods
        .initializeService(options.name, new anchor.BN(options.rateLimit))
        .accounts({
          service: servicePda,
          authority: authority,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("Service initialized!");
      console.log("  Transaction:", tx);
      console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// Get Service Info
cli
  .command("service-info")
  .description("Get service information")
  .option("-a, --authority <pubkey>", "Service authority public key")
  .action(async (options) => {
    try {
      const provider = getProvider();
      const program = getProgram(provider);
      const authority = options.authority
        ? new anchor.web3.PublicKey(options.authority)
        : provider.wallet.publicKey;

      const servicePda = await getServicePda(program, authority);

      try {
        const service = await program.account.service.fetch(servicePda);

        console.log("Service Information");
        console.log("==================");
        console.log("  PDA:", servicePda.toString());
        console.log("  Name:", service.name);
        console.log("  Authority:", service.authority.toString());
        console.log("  Default Rate Limit:", service.defaultRateLimit.toString(), "req/day");
        console.log("  Total Keys:", service.totalKeys.toString());
        console.log("  Active Keys:", service.activeKeys.toString());
      } catch (e) {
        console.log("No service found for authority:", authority.toString());
      }
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// Create API Key
cli
  .command("create-key")
  .description("Create a new API key")
  .requiredOption("-s, --service <pubkey>", "Service authority public key")
  .requiredOption("-n, --name <name>", "Key name")
  .option("--scopes <scopes>", "Comma-separated scopes", "read")
  .option("-r, --rate-limit <limit>", "Rate limit (requests/day)")
  .option("-e, --expires <days>", "Expires in N days")
  .action(async (options) => {
    try {
      const provider = getProvider();
      const program = getProgram(provider);
      const serviceAuthority = new anchor.web3.PublicKey(options.service);
      const owner = provider.wallet.publicKey;

      const servicePda = await getServicePda(program, serviceAuthority);
      const service = await program.account.service.fetch(servicePda);

      const apiKeyPda = await getApiKeyPda(
        program,
        servicePda,
        owner,
        service.totalKeys.toNumber()
      );

      const scopes = options.scopes.split(",").map(s => s.trim());
      const rateLimit = options.rateLimit
        ? new anchor.BN(options.rateLimit)
        : null;
      const expiresAt = options.expires
        ? new anchor.BN(Math.floor(Date.now() / 1000) + parseInt(options.expires) * 86400)
        : null;

      console.log("Creating API key...");
      console.log("  Key PDA:", apiKeyPda.toString());
      console.log("  Owner:", owner.toString());
      console.log("  Scopes:", scopes.join(", "));

      const tx = await program.methods
        .createApiKey(options.name, scopes, rateLimit, expiresAt)
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
          owner: owner,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("API key created!");
      console.log("  Transaction:", tx);
      console.log("  Key Index:", service.totalKeys.toString());
      console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// Get Key Info
cli
  .command("key-info")
  .description("Get API key information")
  .requiredOption("-k, --key <pubkey>", "API key PDA")
  .action(async (options) => {
    try {
      const provider = getProvider();
      const program = getProgram(provider);
      const keyPda = new anchor.web3.PublicKey(options.key);

      const apiKey = await program.account.apiKey.fetch(keyPda);

      console.log("API Key Information");
      console.log("===================");
      console.log("  PDA:", keyPda.toString());
      console.log("  Name:", apiKey.name);
      console.log("  Owner:", apiKey.owner.toString());
      console.log("  Service:", apiKey.service.toString());
      console.log("  Key Index:", apiKey.keyIndex.toString());
      console.log("  Scopes:", apiKey.scopes.join(", "));
      console.log("  Rate Limit:", apiKey.rateLimit.toString(), "req/day");
      console.log("  Requests Today:", apiKey.requestsToday.toString());
      console.log("  Total Requests:", apiKey.totalRequests.toString());
      console.log("  Active:", apiKey.isActive);
      console.log("  Created:", new Date(apiKey.createdAt.toNumber() * 1000).toISOString());
      if (apiKey.expiresAt) {
        console.log("  Expires:", new Date(apiKey.expiresAt.toNumber() * 1000).toISOString());
      } else {
        console.log("  Expires: Never");
      }
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// Validate Scope
cli
  .command("validate")
  .description("Validate an API key has a specific scope")
  .requiredOption("-k, --key <pubkey>", "API key PDA")
  .requiredOption("-s, --scope <scope>", "Scope to validate")
  .action(async (options) => {
    try {
      const provider = getProvider();
      const program = getProgram(provider);
      const keyPda = new anchor.web3.PublicKey(options.key);

      const apiKey = await program.account.apiKey.fetch(keyPda);
      const servicePda = apiKey.service;

      console.log("Validating scope '" + options.scope + "'...");

      await program.methods
        .validateScope(options.scope)
        .accounts({
          service: servicePda,
          apiKey: keyPda,
        })
        .rpc();

      console.log("Validation PASSED - Key has scope '" + options.scope + "'");
    } catch (err) {
      if (err.message.includes("InsufficientPermissions")) {
        console.log("Validation FAILED - Key does NOT have scope '" + options.scope + "'");
      } else if (err.message.includes("KeyInactive")) {
        console.log("Validation FAILED - Key is inactive");
      } else if (err.message.includes("KeyExpired")) {
        console.log("Validation FAILED - Key has expired");
      } else {
        console.error("Error:", err.message);
      }
      process.exit(1);
    }
  });

// Revoke Key
cli
  .command("revoke")
  .description("Revoke an API key")
  .requiredOption("-k, --key <pubkey>", "API key PDA")
  .action(async (options) => {
    try {
      const provider = getProvider();
      const program = getProgram(provider);
      const keyPda = new anchor.web3.PublicKey(options.key);

      const apiKey = await program.account.apiKey.fetch(keyPda);
      const servicePda = apiKey.service;
      const service = await program.account.service.fetch(servicePda);

      console.log("Revoking API key...");

      const tx = await program.methods
        .revokeKey()
        .accounts({
          service: servicePda,
          apiKey: keyPda,
          signer: provider.wallet.publicKey,
        })
        .rpc();

      console.log("API key revoked!");
      console.log("  Transaction:", tx);
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

// List Keys (for a service)
cli
  .command("list-keys")
  .description("List all API keys for a service")
  .requiredOption("-s, --service <pubkey>", "Service authority public key")
  .action(async (options) => {
    try {
      const provider = getProvider();
      const program = getProgram(provider);
      const serviceAuthority = new anchor.web3.PublicKey(options.service);
      const servicePda = await getServicePda(program, serviceAuthority);

      const service = await program.account.service.fetch(servicePda);

      console.log("API Keys for Service:", service.name);
      console.log("Total Keys:", service.totalKeys.toString());
      console.log("Active Keys:", service.activeKeys.toString());
      console.log("");

      // Fetch all API key accounts
      const keys = await program.account.apiKey.all([
        {
          memcmp: {
            offset: 8, // After discriminator
            bytes: servicePda.toBase58(),
          },
        },
      ]);

      for (const keyAccount of keys) {
        const key = keyAccount.account;
        console.log("---");
        console.log("  PDA:", keyAccount.publicKey.toString());
        console.log("  Name:", key.name);
        console.log("  Owner:", key.owner.toString());
        console.log("  Scopes:", key.scopes.join(", "));
        console.log("  Active:", key.isActive);
        console.log("  Usage:", key.requestsToday.toString() + "/" + key.rateLimit.toString() + " today");
      }
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  });

cli.parse();
