# API Key Manager - Demo Video Script (3 minutes)

## Hook (0:00 - 0:15)
*Show: Web2 vs Web3 architecture diagram*

"Every SaaS product has API key management - authentication, rate limiting, audit trails. What if we could rebuild this entire backend system on Solana?"

## The Problem (0:15 - 0:45)
*Show: Traditional architecture diagram from README*

Traditional API key systems have critical weaknesses:
- **Single point of failure** - one database outage breaks everything
- **Trust the operator** - keys can be modified without audit
- **Expensive infrastructure** - Redis, PostgreSQL, caching layers
- **No user ownership** - the service controls all keys

## The Solution (0:45 - 1:30)
*Show: Solana architecture diagram from README*

This project reimagines API key management as a Solana program:

**Key Features:**
- **Decentralized storage** - keys stored in on-chain PDAs
- **Immutable audit trail** - every action is a blockchain transaction
- **Self-custody** - users own their keys via wallet signatures
- **Built-in rate limiting** - daily counters with automatic reset
- **Zero infrastructure cost** - just transaction fees

## Code Demo (1:30 - 2:30)
*Show: Terminal running tests*

"Let me show you the implementation. The program is written in Rust using the Anchor framework."

*Run: `anchor test`*

"All 15 tests pass, covering:
- Service initialization
- API key creation with custom scopes
- Usage tracking with rate limits
- Scope validation with wildcard support
- Key revocation by owner OR authority
- Multi-key support per user"

*Show: README feature comparison table*

## Closing (2:30 - 3:00)
*Show: GitHub repo*

"This demonstrates how familiar Web2 patterns can be translated to Solana's state machine model. The code is open source on GitHub."

"Traditional developers can see how their backend skills apply to blockchain development - same concepts, different execution model."

*Show: Superteam logo*

"Built for the Superteam Poland 'Rebuild Backend Systems' challenge."

---

## Recording Notes

1. Use terminal with dark theme for code visibility
2. Have two tabs ready:
   - README with diagrams
   - Terminal for test execution
3. Keep voice clear and pace steady
4. Total length: exactly 3 minutes
