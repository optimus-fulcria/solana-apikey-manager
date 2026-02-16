use anchor_lang::prelude::*;

declare_id!("McqrJRjDBUSAMykLHMSs1Xr7osZdZibn7p7rTTVHrCs");

/// Maximum length of key name/description
const MAX_NAME_LEN: usize = 32;
/// Maximum number of permission scopes per key
const MAX_SCOPES: usize = 8;
/// Scope string max length
const SCOPE_LEN: usize = 16;

#[program]
pub mod solana_apikey_manager {
    use super::*;

    /// Initialize a new API service configuration
    /// Only the service authority can manage this service
    pub fn initialize_service(
        ctx: Context<InitializeService>,
        name: String,
        default_rate_limit: u64,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, ErrorCode::NameTooLong);

        let service = &mut ctx.accounts.service;
        service.authority = ctx.accounts.authority.key();
        service.name = name;
        service.default_rate_limit = default_rate_limit;
        service.total_keys = 0;
        service.active_keys = 0;
        service.bump = ctx.bumps.service;

        msg!("Service '{}' initialized", service.name);
        Ok(())
    }

    /// Create a new API key for a user
    /// The key is a PDA derived from service + user + key_index
    pub fn create_api_key(
        ctx: Context<CreateApiKey>,
        key_name: String,
        scopes: Vec<String>,
        rate_limit: Option<u64>,
        expires_at: Option<i64>,
    ) -> Result<()> {
        require!(key_name.len() <= MAX_NAME_LEN, ErrorCode::NameTooLong);
        require!(scopes.len() <= MAX_SCOPES, ErrorCode::TooManyScopes);

        for scope in &scopes {
            require!(scope.len() <= SCOPE_LEN, ErrorCode::ScopeTooLong);
        }

        let service = &mut ctx.accounts.service;
        let api_key = &mut ctx.accounts.api_key;
        let clock = Clock::get()?;

        // If expires_at is set, it must be in the future
        if let Some(exp) = expires_at {
            require!(exp > clock.unix_timestamp, ErrorCode::ExpirationInPast);
        }

        api_key.service = service.key();
        api_key.owner = ctx.accounts.owner.key();
        api_key.key_index = service.total_keys;
        api_key.name = key_name;
        api_key.scopes = scopes;
        api_key.rate_limit = rate_limit.unwrap_or(service.default_rate_limit);
        api_key.requests_today = 0;
        api_key.total_requests = 0;
        api_key.last_request_day = 0;
        api_key.created_at = clock.unix_timestamp;
        api_key.expires_at = expires_at;
        api_key.is_active = true;
        api_key.bump = ctx.bumps.api_key;

        service.total_keys += 1;
        service.active_keys += 1;

        msg!("API key '{}' created for user {}", api_key.name, api_key.owner);
        Ok(())
    }

    /// Record an API request (usage tracking)
    /// Called by the service to track key usage
    pub fn record_request(ctx: Context<RecordRequest>) -> Result<()> {
        let api_key = &mut ctx.accounts.api_key;
        let clock = Clock::get()?;

        // Check if key is active
        require!(api_key.is_active, ErrorCode::KeyInactive);

        // Check expiration
        if let Some(exp) = api_key.expires_at {
            require!(clock.unix_timestamp < exp, ErrorCode::KeyExpired);
        }

        // Calculate current day (Unix days since epoch)
        let current_day = clock.unix_timestamp / 86400;

        // Reset daily counter if new day
        if current_day > api_key.last_request_day {
            api_key.requests_today = 0;
            api_key.last_request_day = current_day;
        }

        // Check rate limit
        require!(
            api_key.requests_today < api_key.rate_limit,
            ErrorCode::RateLimitExceeded
        );

        // Increment counters
        api_key.requests_today += 1;
        api_key.total_requests += 1;

        msg!("Request recorded. Today: {}/{}", api_key.requests_today, api_key.rate_limit);
        Ok(())
    }

    /// Validate an API key has specific scope permission
    /// Returns success only if key is valid and has the required scope
    pub fn validate_scope(ctx: Context<ValidateScope>, required_scope: String) -> Result<()> {
        let api_key = &ctx.accounts.api_key;
        let clock = Clock::get()?;

        // Check if key is active
        require!(api_key.is_active, ErrorCode::KeyInactive);

        // Check expiration
        if let Some(exp) = api_key.expires_at {
            require!(clock.unix_timestamp < exp, ErrorCode::KeyExpired);
        }

        // Check if key has the required scope
        let has_scope = api_key.scopes.iter().any(|s| s == &required_scope || s == "*");
        require!(has_scope, ErrorCode::InsufficientPermissions);

        msg!("Scope '{}' validated for key '{}'", required_scope, api_key.name);
        Ok(())
    }

    /// Revoke (deactivate) an API key
    /// Only the key owner or service authority can revoke
    pub fn revoke_key(ctx: Context<RevokeKey>) -> Result<()> {
        let service = &mut ctx.accounts.service;
        let api_key = &mut ctx.accounts.api_key;

        require!(api_key.is_active, ErrorCode::KeyAlreadyRevoked);

        api_key.is_active = false;
        service.active_keys = service.active_keys.saturating_sub(1);

        msg!("API key '{}' has been revoked", api_key.name);
        Ok(())
    }

    /// Reactivate a previously revoked key
    /// Only the key owner or service authority can reactivate
    pub fn reactivate_key(ctx: Context<ReactivateKey>) -> Result<()> {
        let service = &mut ctx.accounts.service;
        let api_key = &mut ctx.accounts.api_key;
        let clock = Clock::get()?;

        require!(!api_key.is_active, ErrorCode::KeyAlreadyActive);

        // Cannot reactivate an expired key
        if let Some(exp) = api_key.expires_at {
            require!(clock.unix_timestamp < exp, ErrorCode::KeyExpired);
        }

        api_key.is_active = true;
        service.active_keys += 1;

        msg!("API key '{}' has been reactivated", api_key.name);
        Ok(())
    }

    /// Update rate limit for a key
    /// Only the service authority can update rate limits
    pub fn update_rate_limit(ctx: Context<UpdateRateLimit>, new_limit: u64) -> Result<()> {
        let api_key = &mut ctx.accounts.api_key;

        let old_limit = api_key.rate_limit;
        api_key.rate_limit = new_limit;

        msg!("Rate limit updated from {} to {} for key '{}'", old_limit, new_limit, api_key.name);
        Ok(())
    }

    /// Update scopes for a key
    /// Only the service authority can update scopes
    pub fn update_scopes(ctx: Context<UpdateScopes>, new_scopes: Vec<String>) -> Result<()> {
        require!(new_scopes.len() <= MAX_SCOPES, ErrorCode::TooManyScopes);

        for scope in &new_scopes {
            require!(scope.len() <= SCOPE_LEN, ErrorCode::ScopeTooLong);
        }

        let api_key = &mut ctx.accounts.api_key;
        api_key.scopes = new_scopes.clone();

        msg!("Scopes updated for key '{}': {:?}", api_key.name, new_scopes);
        Ok(())
    }

    /// Extend expiration date for a key
    /// Only the service authority can extend expiration
    pub fn extend_expiration(ctx: Context<ExtendExpiration>, new_expires_at: i64) -> Result<()> {
        let api_key = &mut ctx.accounts.api_key;
        let clock = Clock::get()?;

        require!(new_expires_at > clock.unix_timestamp, ErrorCode::ExpirationInPast);

        let old_exp = api_key.expires_at;
        api_key.expires_at = Some(new_expires_at);

        msg!("Expiration extended for key '{}': {:?} -> {}", api_key.name, old_exp, new_expires_at);
        Ok(())
    }
}

// =============================================================================
// Account Structures
// =============================================================================

#[account]
pub struct Service {
    /// The authority who manages this service
    pub authority: Pubkey,
    /// Human-readable service name
    pub name: String,
    /// Default rate limit for new keys (requests per day)
    pub default_rate_limit: u64,
    /// Total number of keys ever created
    pub total_keys: u64,
    /// Currently active keys
    pub active_keys: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl Service {
    pub const SIZE: usize = 8 + // discriminator
        32 + // authority
        4 + MAX_NAME_LEN + // name (string prefix + chars)
        8 + // default_rate_limit
        8 + // total_keys
        8 + // active_keys
        1;  // bump
}

#[account]
pub struct ApiKey {
    /// The service this key belongs to
    pub service: Pubkey,
    /// The owner of this key
    pub owner: Pubkey,
    /// Key index (for PDA derivation)
    pub key_index: u64,
    /// Human-readable key name
    pub name: String,
    /// Permission scopes (e.g., "read", "write", "admin", "*")
    pub scopes: Vec<String>,
    /// Rate limit (requests per day)
    pub rate_limit: u64,
    /// Requests made today
    pub requests_today: u64,
    /// Total requests ever made
    pub total_requests: u64,
    /// Last request day (Unix days since epoch)
    pub last_request_day: i64,
    /// When the key was created
    pub created_at: i64,
    /// When the key expires (None = never)
    pub expires_at: Option<i64>,
    /// Whether the key is currently active
    pub is_active: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl ApiKey {
    pub const SIZE: usize = 8 + // discriminator
        32 + // service
        32 + // owner
        8 + // key_index
        4 + MAX_NAME_LEN + // name
        4 + (MAX_SCOPES * (4 + SCOPE_LEN)) + // scopes vec
        8 + // rate_limit
        8 + // requests_today
        8 + // total_requests
        8 + // last_request_day
        8 + // created_at
        1 + 8 + // expires_at (Option<i64>)
        1 + // is_active
        1;  // bump
}

// =============================================================================
// Context Structs
// =============================================================================

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeService<'info> {
    #[account(
        init,
        payer = authority,
        space = Service::SIZE,
        seeds = [b"service", authority.key().as_ref()],
        bump
    )]
    pub service: Account<'info, Service>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key_name: String, scopes: Vec<String>)]
pub struct CreateApiKey<'info> {
    #[account(
        mut,
        seeds = [b"service", service.authority.as_ref()],
        bump = service.bump
    )]
    pub service: Account<'info, Service>,

    #[account(
        init,
        payer = owner,
        space = ApiKey::SIZE,
        seeds = [
            b"apikey",
            service.key().as_ref(),
            owner.key().as_ref(),
            service.total_keys.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub api_key: Account<'info, ApiKey>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordRequest<'info> {
    #[account(
        seeds = [b"service", service.authority.as_ref()],
        bump = service.bump
    )]
    pub service: Account<'info, Service>,

    #[account(
        mut,
        constraint = api_key.service == service.key() @ ErrorCode::ServiceMismatch
    )]
    pub api_key: Account<'info, ApiKey>,

    /// The service authority must sign to record requests
    /// This ensures only the actual service can track usage
    #[account(constraint = authority.key() == service.authority @ ErrorCode::Unauthorized)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ValidateScope<'info> {
    #[account(
        seeds = [b"service", service.authority.as_ref()],
        bump = service.bump
    )]
    pub service: Account<'info, Service>,

    #[account(
        constraint = api_key.service == service.key() @ ErrorCode::ServiceMismatch
    )]
    pub api_key: Account<'info, ApiKey>,
}

#[derive(Accounts)]
pub struct RevokeKey<'info> {
    #[account(
        mut,
        seeds = [b"service", service.authority.as_ref()],
        bump = service.bump
    )]
    pub service: Account<'info, Service>,

    #[account(
        mut,
        constraint = api_key.service == service.key() @ ErrorCode::ServiceMismatch
    )]
    pub api_key: Account<'info, ApiKey>,

    /// Either the key owner or service authority can revoke
    #[account(
        constraint =
            signer.key() == api_key.owner ||
            signer.key() == service.authority
            @ ErrorCode::Unauthorized
    )]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReactivateKey<'info> {
    #[account(
        mut,
        seeds = [b"service", service.authority.as_ref()],
        bump = service.bump
    )]
    pub service: Account<'info, Service>,

    #[account(
        mut,
        constraint = api_key.service == service.key() @ ErrorCode::ServiceMismatch
    )]
    pub api_key: Account<'info, ApiKey>,

    /// Either the key owner or service authority can reactivate
    #[account(
        constraint =
            signer.key() == api_key.owner ||
            signer.key() == service.authority
            @ ErrorCode::Unauthorized
    )]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateRateLimit<'info> {
    #[account(
        seeds = [b"service", service.authority.as_ref()],
        bump = service.bump
    )]
    pub service: Account<'info, Service>,

    #[account(
        mut,
        constraint = api_key.service == service.key() @ ErrorCode::ServiceMismatch
    )]
    pub api_key: Account<'info, ApiKey>,

    /// Only service authority can update rate limits
    #[account(constraint = authority.key() == service.authority @ ErrorCode::Unauthorized)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateScopes<'info> {
    #[account(
        seeds = [b"service", service.authority.as_ref()],
        bump = service.bump
    )]
    pub service: Account<'info, Service>,

    #[account(
        mut,
        constraint = api_key.service == service.key() @ ErrorCode::ServiceMismatch
    )]
    pub api_key: Account<'info, ApiKey>,

    /// Only service authority can update scopes
    #[account(constraint = authority.key() == service.authority @ ErrorCode::Unauthorized)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExtendExpiration<'info> {
    #[account(
        seeds = [b"service", service.authority.as_ref()],
        bump = service.bump
    )]
    pub service: Account<'info, Service>,

    #[account(
        mut,
        constraint = api_key.service == service.key() @ ErrorCode::ServiceMismatch
    )]
    pub api_key: Account<'info, ApiKey>,

    /// Only service authority can extend expiration
    #[account(constraint = authority.key() == service.authority @ ErrorCode::Unauthorized)]
    pub authority: Signer<'info>,
}

// =============================================================================
// Error Codes
// =============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Name exceeds maximum length")]
    NameTooLong,
    #[msg("Too many scopes specified")]
    TooManyScopes,
    #[msg("Scope name exceeds maximum length")]
    ScopeTooLong,
    #[msg("Expiration date must be in the future")]
    ExpirationInPast,
    #[msg("API key is not active")]
    KeyInactive,
    #[msg("API key has expired")]
    KeyExpired,
    #[msg("Rate limit exceeded")]
    RateLimitExceeded,
    #[msg("Insufficient permissions for this scope")]
    InsufficientPermissions,
    #[msg("API key is already revoked")]
    KeyAlreadyRevoked,
    #[msg("API key is already active")]
    KeyAlreadyActive,
    #[msg("Service mismatch")]
    ServiceMismatch,
    #[msg("Unauthorized")]
    Unauthorized,
}
