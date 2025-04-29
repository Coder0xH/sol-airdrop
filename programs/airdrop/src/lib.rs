use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use anchor_spl::associated_token::AssociatedToken;
use anchor_lang::solana_program;

declare_id!("HMsLRRqoo8SpnR9acz49Mq7ht19x93Kp62DdGFKoRTYe");

#[program]
pub mod airdrop {
    use super::*;

    /// 初始化空投程序：设置空投代币和签名者
    pub fn initialize(
        ctx: Context<Initialize>,
        signer: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.owner = ctx.accounts.owner.key();
        state.token_mint = ctx.accounts.token_mint.key();
        state.signer = signer;
        state.total_claimed = 0;
        state.bump = ctx.bumps.state;
        
        Ok(())
    }

    /// 创建代币金库
    pub fn create_vault(ctx: Context<CreateVault>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.token_vault = ctx.accounts.token_vault.key();
        Ok(())
    }

    /// 只有 owner 能提取多余代币
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
    ) -> Result<()> {
        let state = &ctx.accounts.state;
        let seeds = &[
            b"state".as_ref(),
            &[state.bump],
        ];
        let signer = &[&seeds[..]];

        // 转移代币
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
                authority: ctx.accounts.state.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, amount)?;

        Ok(())
    }

    /// 用户领取空投，签名只能兑付一次
    pub fn claim(
        ctx: Context<Claim>,
        amount: u64,
        signature: [u8; 64],
    ) -> Result<()> {
        let claimer = ctx.accounts.claimer.key();
        
        // 创建要验证的消息
        let message = ClaimMessage {
            wallet: claimer,
            amount,
        };
        let message_bytes = message.try_to_vec()?;
        
        // 使用state.signer公钥验证签名
        let signer_pubkey = ctx.accounts.state.signer;
        
        // 创建验证签名的指令
        let signer_pubkey_bytes = signer_pubkey.to_bytes();
        
        // 构建 ed25519 程序指令数据
        let mut data = vec![0]; // 指令类型 0
        data.extend_from_slice(&[signer_pubkey_bytes.len() as u8]); // 公钥长度
        data.extend_from_slice(&signer_pubkey_bytes); // 公钥
        data.extend_from_slice(&[(message_bytes.len() as u16).to_le_bytes()[0]]); // 消息长度低字节
        data.extend_from_slice(&[(message_bytes.len() as u16).to_le_bytes()[1]]); // 消息长度高字节
        data.extend_from_slice(&message_bytes); // 消息
        data.extend_from_slice(&signature); // 签名
        
        // 构建验证指令
        let instruction = solana_program::instruction::Instruction {
            program_id: solana_program::ed25519_program::id(),
            accounts: vec![],
            data,
        };
        
        // 验证签名
        let ix_result = solana_program::program::invoke(
            &instruction,
            &[ctx.accounts.claimer.to_account_info()]
        );
        
        // 检查签名验证结果
        if ix_result.is_err() {
            return err!(AirdropError::InvalidSignature);
        }
        
        // 检查是否已经使用过该签名
        let claim_record = &mut ctx.accounts.claim_record;
        require!(!claim_record.is_claimed, AirdropError::AlreadyClaimed);
        
        // 标记为已领取
        claim_record.is_claimed = true;
        
        // 转移代币
        let seeds = &[
            b"state".as_ref(),
            &[ctx.accounts.state.bump],
        ];
        let signer = &[&seeds[..]];
        
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.token_vault.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
                authority: ctx.accounts.state.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, amount)?;
        
        // 更新总领取量
        ctx.accounts.state.total_claimed = ctx.accounts.state.total_claimed.checked_add(amount).unwrap();
        
        // 发出事件
        emit!(ClaimEvent {
            user: claimer,
            amount,
        });
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = owner,
        space = 8 + StateAccount::LEN,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, StateAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(mut)]
    pub state: Account<'info, StateAccount>,
    
    #[account(
        init,
        payer = owner,
        seeds = [b"vault"],
        bump,
        token::mint = token_mint,
        token::authority = state,
    )]
    pub token_vault: Account<'info, TokenAccount>,
    
    pub token_mint: Account<'info, Mint>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"state"],
        bump = state.bump,
        constraint = state.owner == owner.key() @ AirdropError::Unauthorized,
    )]
    pub state: Account<'info, StateAccount>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        constraint = token_vault.mint == state.token_mint,
        constraint = token_vault.owner == state.key(),
    )]
    pub token_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = recipient.mint == state.token_mint,
    )]
    pub recipient: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump,
    )]
    pub state: Account<'info, StateAccount>,
    
    #[account(
        init_if_needed,
        payer = claimer,
        space = 8 + ClaimRecord::LEN,
        seeds = [b"claim", claimer.key().as_ref()],
        bump,
    )]
    pub claim_record: Account<'info, ClaimRecord>,
    
    #[account(
        mut,
        constraint = token_vault.mint == state.token_mint,
        constraint = token_vault.owner == state.key(),
    )]
    pub token_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = recipient.mint == state.token_mint,
        constraint = recipient.owner == claimer.key(),
    )]
    pub recipient: Account<'info, TokenAccount>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct StateAccount {
    pub owner: Pubkey,         // 合约拥有者
    pub token_mint: Pubkey,    // 空投代币的铸币地址
    pub token_vault: Pubkey,   // 存放空投代币的金库
    pub signer: Pubkey,        // 离线签名者地址
    pub total_claimed: u64,    // 全局累计已领数量
    pub bump: u8,              // PDA的bump
}

impl StateAccount {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 8 + 1;
}

#[account]
pub struct ClaimRecord {
    pub is_claimed: bool,      // 是否已领取
}

impl ClaimRecord {
    pub const LEN: usize = 1;
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ClaimMessage {
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ClaimEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum AirdropError {
    #[msg("未授权操作")]
    Unauthorized,
    #[msg("无效签名")]
    InvalidSignature,
    #[msg("已经领取过")]
    AlreadyClaimed,
}
