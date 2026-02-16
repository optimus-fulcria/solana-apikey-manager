# Solana API Key Manager

A decentralized API key management system built on Solana. This project demonstrates how traditional backend patterns can be reimagined using blockchain architecture.

## Overview

API key management is a fundamental backend pattern used by virtually every SaaS product. This project rebuilds that core logic as a Solana program, showcasing how Web2 patterns can be transformed into Web3 primitives.

## Web2 vs Solana Architecture

### Traditional Web2 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Web2 API Key System                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   Client    │────▶│  API Gateway │────▶│   Backend   │       │
│  │  (API Key)  │     │  (Auth MW)   │     │  (Business) │       │
│  └─────────────┘     └─────────────┘     └─────────────┘       │
│                              │                   │              │
│                              ▼                   ▼              │
│                      ┌─────────────┐     ┌─────────────┐       │
│                      │   Cache     │     │  Database   │       │
│                      │  (Redis)    │     │  (Postgres) │       │
│                      └─────────────┘     └─────────────┘       │
│                                                                 │
│  Components:                                                    │
│  • PostgreSQL: api_keys, usage_logs, services tables           │
│  • Redis: Rate limit counters (sliding window)                 │
│  • Auth middleware: JWT validation, key lookup                 │
│  • Admin dashboard: Key CRUD operations                        │
│                                                                 │
│  Challenges:                                                    │
│  • Single point of failure (centralized DB)                    │
│  • Trust the operator (can modify keys without audit)          │
│  • Complex caching for rate limits                             │
│  • Expensive infrastructure (Redis, managed DB)                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Solana On-Chain Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Solana API Key Manager                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐            ┌──────────────────────┐           │
│  │   Client    │───────────▶│    Solana Network    │           │
│  │ (Signs TX)  │            │    (Validators)      │           │
│  └─────────────┘            └──────────────────────┘           │
│                                       │                         │
│         ┌─────────────────────────────┴──────────────────┐     │
│         ▼                             ▼                  ▼     │
│  ┌─────────────┐            ┌─────────────┐     ┌──────────┐  │
│  │  Service    │            │   ApiKey    │     │  ApiKey  │  │
│  │   Account   │            │  Account 1  │     │ Account N│  │
│  │   (PDA)     │            │   (PDA)     │     │  (PDA)   │  │
│  └─────────────┘            └─────────────┘     └──────────┘  │
│                                                                 │
│  Account Model:                                                 │
│  • Service: authority, name, default_rate_limit, stats         │
│  • ApiKey: owner, scopes[], rate_limit, usage counters         │
│  • All data on-chain, immutable history                        │
│                                                                 │
│  Benefits:                                                      │
│  • Decentralized (no single point of failure)                  │
│  • Transparent (all operations auditable on-chain)             │
│  • Self-custody (users own their keys via wallets)             │
│  • Built-in rate limiting (daily counter reset)                │
│  • No infrastructure cost (just transaction fees)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Feature Comparison

| Feature | Web2 (Traditional) | Solana (This Project) |
|---------|-------------------|----------------------|
| **Data Storage** | PostgreSQL tables | On-chain accounts (PDAs) |
| **Authentication** | JWT + API key header | Wallet signatures |
| **Rate Limiting** | Redis sliding window | On-chain daily counter |
| **Audit Trail** | Application logs | Immutable transaction history |
| **Key Ownership** | Service controls all | User self-custody |
| **Revocation** | Admin only | Owner OR admin |
| **Scope Management** | JSON arrays | Vec<String> in account |
| **Expiration** | Timestamp column | Unix timestamp field |
| **Infrastructure** | Servers, DB, Cache | Just RPC endpoints |
| **Trust Model** | Trust the operator | Trust the protocol |

## Program Instructions

### Service Management

- **initialize_service**: Create a new API service configuration
  - Parameters: `name: String`, `default_rate_limit: u64`
  - Creates a PDA derived from `["service", authority]`

### Key Management

- **create_api_key**: Users create their own API keys
  - Parameters: `key_name: String`, `scopes: Vec<String>`, `rate_limit: Option<u64>`, `expires_at: Option<i64>`
  - PDA: `["apikey", service, owner, key_index]`

- **revoke_key**: Deactivate a key (owner or authority)
- **reactivate_key**: Re-enable a revoked key

### Usage Tracking

- **record_request**: Service records API usage (authority only)
  - Increments daily counter
  - Enforces rate limits
  - Resets counter on new day (UTC)

### Authorization

- **validate_scope**: Check if key has required permission
  - Supports wildcards (`*` grants all scopes)
  - Verifies active status and expiration

### Administration

- **update_rate_limit**: Modify key's rate limit (authority only)
- **update_scopes**: Change key permissions (authority only)
- **extend_expiration**: Extend key validity (authority only)

## Account Structures

### Service Account (~93 bytes)

```rust
pub struct Service {
    pub authority: Pubkey,      // Service owner
    pub name: String,           // Max 32 chars
    pub default_rate_limit: u64,
    pub total_keys: u64,        // Ever created
    pub active_keys: u64,       // Currently active
    pub bump: u8,
}
```

### ApiKey Account (~330 bytes)

```rust
pub struct ApiKey {
    pub service: Pubkey,
    pub owner: Pubkey,
    pub key_index: u64,
    pub name: String,           // Max 32 chars
    pub scopes: Vec<String>,    // Up to 8 scopes, 16 chars each
    pub rate_limit: u64,
    pub requests_today: u64,
    pub total_requests: u64,
    pub last_request_day: i64,  // Unix day for reset
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub is_active: bool,
    pub bump: u8,
}
```

## Getting Started

### Prerequisites

- Rust 1.70+
- Solana CLI 1.18+
- Anchor 0.32+
- Node.js 18+

### Installation

```bash
# Clone the repository
git clone https://github.com/optimus-fulcria/solana-apikey-manager
cd solana-apikey-manager

# Install dependencies
yarn install

# Build the program
anchor build

# Run tests
anchor test
```

### Deploy to Devnet

```bash
# Configure Solana CLI for devnet
solana config set --url devnet

# Airdrop SOL for deployment
solana airdrop 2

# Deploy
anchor deploy

# Note the program ID and update Anchor.toml if needed
```

## Example Usage

### Initialize a Service

```javascript
const [servicePda] = await PublicKey.findProgramAddressSync(
  [Buffer.from("service"), authority.publicKey.toBuffer()],
  program.programId
);

await program.methods
  .initializeService("MyAPI", new BN(1000))
  .accounts({
    service: servicePda,
    authority: authority.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Create an API Key

```javascript
const [apiKeyPda] = await PublicKey.findProgramAddressSync(
  [
    Buffer.from("apikey"),
    servicePda.toBuffer(),
    user.publicKey.toBuffer(),
    new BN(0).toArrayLike(Buffer, "le", 8), // key_index
  ],
  program.programId
);

await program.methods
  .createApiKey("Production Key", ["read", "write"], new BN(500), null)
  .accounts({
    service: servicePda,
    apiKey: apiKeyPda,
    owner: user.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([user])
  .rpc();
```

### Validate and Record Usage

```javascript
// Validate scope before processing request
await program.methods
  .validateScope("read")
  .accounts({
    service: servicePda,
    apiKey: apiKeyPda,
  })
  .rpc();

// Record the request (for rate limiting)
await program.methods
  .recordRequest()
  .accounts({
    service: servicePda,
    apiKey: apiKeyPda,
    authority: authority.publicKey,
  })
  .rpc();
```

## Design Decisions

### Why PDAs?

Program Derived Addresses ensure:
- Deterministic key addresses (predictable lookups)
- Unique keys per user per service
- No need for external key databases

### Why Daily Rate Limits?

- Simple on-chain implementation (no complex sliding windows)
- Automatic reset based on Unix timestamp
- Gas-efficient compared to per-minute counters

### Why Owner + Authority Revocation?

- Users can immediately revoke compromised keys
- Service can revoke abusive users
- Dual-control model balances security and usability

## Security Considerations

1. **Scope Validation**: Always validate scopes before sensitive operations
2. **Expiration Check**: Enforce expiration on every validation
3. **Authority Control**: Only service authority can track usage and modify settings
4. **Rate Limit Enforcement**: Check before incrementing to prevent race conditions

## License

MIT

## Author

Built by [Optimus Agent](https://github.com/optimus-fulcria) for the Superteam Poland "Rebuild Backend Systems" challenge.
