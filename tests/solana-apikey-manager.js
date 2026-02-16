const anchor = require("@coral-xyz/anchor");
const { assert } = require("chai");

describe("solana-apikey-manager", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaApikeyManager;

  // Test accounts
  const authority = provider.wallet;
  const user = anchor.web3.Keypair.generate();

  // PDAs
  let servicePda;
  let apiKeyPda;

  before(async () => {
    // Airdrop SOL to user for transaction fees
    const airdropSig = await provider.connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Derive service PDA
    [servicePda] = await anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("service"), authority.publicKey.toBuffer()],
      program.programId
    );
  });

  describe("Service Management", () => {
    it("Initializes a service", async () => {
      const serviceName = "MyAPIService";
      const defaultRateLimit = new anchor.BN(1000);

      await program.methods
        .initializeService(serviceName, defaultRateLimit)
        .accounts({
          service: servicePda,
          authority: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const service = await program.account.service.fetch(servicePda);

      assert.equal(service.name, serviceName);
      assert.equal(service.authority.toString(), authority.publicKey.toString());
      assert.equal(service.defaultRateLimit.toNumber(), 1000);
      assert.equal(service.totalKeys.toNumber(), 0);
      assert.equal(service.activeKeys.toNumber(), 0);
    });
  });

  describe("API Key Management", () => {
    it("Creates an API key", async () => {
      const keyName = "Production Key";
      const scopes = ["read", "write"];
      const rateLimit = new anchor.BN(500);
      const expiresAt = null;

      // Derive API key PDA
      const service = await program.account.service.fetch(servicePda);
      [apiKeyPda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("apikey"),
          servicePda.toBuffer(),
          user.publicKey.toBuffer(),
          service.totalKeys.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .createApiKey(keyName, scopes, rateLimit, expiresAt)
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
          owner: user.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const apiKey = await program.account.apiKey.fetch(apiKeyPda);

      assert.equal(apiKey.name, keyName);
      assert.equal(apiKey.owner.toString(), user.publicKey.toString());
      assert.deepEqual(apiKey.scopes, scopes);
      assert.equal(apiKey.rateLimit.toNumber(), 500);
      assert.equal(apiKey.isActive, true);
      assert.equal(apiKey.requestsToday.toNumber(), 0);
      assert.equal(apiKey.totalRequests.toNumber(), 0);

      // Check service counters updated
      const updatedService = await program.account.service.fetch(servicePda);
      assert.equal(updatedService.totalKeys.toNumber(), 1);
      assert.equal(updatedService.activeKeys.toNumber(), 1);
    });

    it("Records a request", async () => {
      await program.methods
        .recordRequest()
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
          authority: authority.publicKey,
        })
        .rpc();

      const apiKey = await program.account.apiKey.fetch(apiKeyPda);
      assert.equal(apiKey.requestsToday.toNumber(), 1);
      assert.equal(apiKey.totalRequests.toNumber(), 1);
    });

    it("Validates a valid scope", async () => {
      await program.methods
        .validateScope("read")
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
        })
        .rpc();

      // If we get here without error, scope was valid
    });

    it("Fails to validate an invalid scope", async () => {
      try {
        await program.methods
          .validateScope("admin")
          .accounts({
            service: servicePda,
            apiKey: apiKeyPda,
          })
          .rpc();
        assert.fail("Should have thrown InsufficientPermissions error");
      } catch (error) {
        assert.include(error.message, "InsufficientPermissions");
      }
    });

    it("Updates rate limit (authority only)", async () => {
      const newLimit = new anchor.BN(2000);

      await program.methods
        .updateRateLimit(newLimit)
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
          authority: authority.publicKey,
        })
        .rpc();

      const apiKey = await program.account.apiKey.fetch(apiKeyPda);
      assert.equal(apiKey.rateLimit.toNumber(), 2000);
    });

    it("Updates scopes (authority only)", async () => {
      const newScopes = ["read", "write", "admin"];

      await program.methods
        .updateScopes(newScopes)
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
          authority: authority.publicKey,
        })
        .rpc();

      const apiKey = await program.account.apiKey.fetch(apiKeyPda);
      assert.deepEqual(apiKey.scopes, newScopes);
    });

    it("Revokes an API key", async () => {
      await program.methods
        .revokeKey()
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
          signer: authority.publicKey,
        })
        .rpc();

      const apiKey = await program.account.apiKey.fetch(apiKeyPda);
      assert.equal(apiKey.isActive, false);

      const service = await program.account.service.fetch(servicePda);
      assert.equal(service.activeKeys.toNumber(), 0);
    });

    it("Fails to record request for revoked key", async () => {
      try {
        await program.methods
          .recordRequest()
          .accounts({
            service: servicePda,
            apiKey: apiKeyPda,
            authority: authority.publicKey,
          })
          .rpc();
        assert.fail("Should have thrown KeyInactive error");
      } catch (error) {
        assert.include(error.message, "KeyInactive");
      }
    });

    it("Reactivates an API key", async () => {
      await program.methods
        .reactivateKey()
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
          signer: authority.publicKey,
        })
        .rpc();

      const apiKey = await program.account.apiKey.fetch(apiKeyPda);
      assert.equal(apiKey.isActive, true);

      const service = await program.account.service.fetch(servicePda);
      assert.equal(service.activeKeys.toNumber(), 1);
    });

    it("Extends expiration date", async () => {
      // Set expiration to 1 year from now
      const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

      await program.methods
        .extendExpiration(new anchor.BN(oneYearFromNow))
        .accounts({
          service: servicePda,
          apiKey: apiKeyPda,
          authority: authority.publicKey,
        })
        .rpc();

      const apiKey = await program.account.apiKey.fetch(apiKeyPda);
      assert.equal(apiKey.expiresAt.toNumber(), oneYearFromNow);
    });
  });

  describe("Edge Cases & Security", () => {
    let userKey2Pda;

    it("User can create multiple keys", async () => {
      const service = await program.account.service.fetch(servicePda);

      [userKey2Pda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("apikey"),
          servicePda.toBuffer(),
          user.publicKey.toBuffer(),
          service.totalKeys.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .createApiKey("Dev Key", ["read"], null, null)
        .accounts({
          service: servicePda,
          apiKey: userKey2Pda,
          owner: user.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const apiKey = await program.account.apiKey.fetch(userKey2Pda);
      assert.equal(apiKey.name, "Dev Key");
      assert.equal(apiKey.keyIndex.toNumber(), 1);

      const updatedService = await program.account.service.fetch(servicePda);
      assert.equal(updatedService.totalKeys.toNumber(), 2);
    });

    it("User cannot revoke another user's key", async () => {
      const otherUser = anchor.web3.Keypair.generate();

      // Airdrop to other user
      const airdropSig = await provider.connection.requestAirdrop(
        otherUser.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      try {
        await program.methods
          .revokeKey()
          .accounts({
            service: servicePda,
            apiKey: apiKeyPda,
            signer: otherUser.publicKey,
          })
          .signers([otherUser])
          .rpc();
        assert.fail("Should have thrown Unauthorized error");
      } catch (error) {
        assert.include(error.message, "Unauthorized");
      }
    });

    it("Owner can revoke their own key", async () => {
      await program.methods
        .revokeKey()
        .accounts({
          service: servicePda,
          apiKey: userKey2Pda,
          signer: user.publicKey,
        })
        .signers([user])
        .rpc();

      const apiKey = await program.account.apiKey.fetch(userKey2Pda);
      assert.equal(apiKey.isActive, false);
    });

    it("Wildcard scope grants all permissions", async () => {
      const service = await program.account.service.fetch(servicePda);

      const [wildcardKeyPda] = await anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("apikey"),
          servicePda.toBuffer(),
          user.publicKey.toBuffer(),
          service.totalKeys.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      await program.methods
        .createApiKey("Admin Key", ["*"], null, null)
        .accounts({
          service: servicePda,
          apiKey: wildcardKeyPda,
          owner: user.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Wildcard should validate any scope
      await program.methods
        .validateScope("any_scope_at_all")
        .accounts({
          service: servicePda,
          apiKey: wildcardKeyPda,
        })
        .rpc();

      await program.methods
        .validateScope("admin")
        .accounts({
          service: servicePda,
          apiKey: wildcardKeyPda,
        })
        .rpc();

      await program.methods
        .validateScope("delete:users")
        .accounts({
          service: servicePda,
          apiKey: wildcardKeyPda,
        })
        .rpc();
    });
  });
});
