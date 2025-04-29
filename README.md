# Solana空投合约项目

## 项目概述

这是一个基于Solana区块链的空投合约项目，使用Anchor框架开发。该项目实现了一个代币空投系统，允许用户通过验证签名来领取代币，同时防止重复领取。项目从Solidity合约迁移到Solana平台，保持了相同的业务逻辑。

## 合约功能

1. **初始化合约**：设置空投代币和签名者地址
2. **创建代币金库**：创建用于存储空投代币的金库
3. **用户领取空投**：用户通过验证签名来领取空投代币
4. **提取代币**：合约所有者可以提取金库中的代币

## 项目结构

```markdown
airdrop/
├── Anchor.toml           # Anchor配置文件
├── Cargo.toml            # Rust依赖配置
├── programs/             # 合约程序代码
│   └── airdrop/
│       ├── Cargo.toml    # 程序依赖配置
│       └── src/
│           └── lib.rs    # 主程序代码
├── tests/                # 测试代码
│   └── airdrop.ts        # 测试脚本
└── app/                  # 前端应用（如果需要）
```

## 技术细节

### 状态账户

合约使用以下账户来存储状态：

1. **StateAccount**：存储合约的全局状态
   - `owner`: 合约拥有者
   - `token_mint`: 空投代币的铸币地址
   - `token_vault`: 存放空投代币的金库
   - `signer`: 离线签名者地址
   - `total_claimed`: 全局累计已领数量
   - `bump`: PDA的bump值

2. **ClaimRecord**：记录用户的领取状态
   - `is_claimed`: 是否已领取

### 指令详解

#### 1. 初始化合约 (initialize)

初始化合约状态，设置空投代币和签名者地址。

```rust
pub fn initialize(
    ctx: Context<Initialize>,
    signer: Pubkey,
) -> Result<()>
```

#### 2. 创建代币金库 (create_vault)

创建用于存储空投代币的金库。

```rust
pub fn create_vault(ctx: Context<CreateVault>) -> Result<()>
```

#### 3. 用户领取空投 (claim)

用户通过验证签名来领取空投代币。

```rust
pub fn claim(
    ctx: Context<Claim>,
    amount: u64,
    signature: [u8; 64],
) -> Result<()>
```

#### 4. 提取代币 (withdraw)

合约所有者可以提取金库中的代币。

```rust
pub fn withdraw(
    ctx: Context<Withdraw>,
    amount: u64,
) -> Result<()>
```

## 开发环境设置

### 前置条件

1. 安装Rust和Cargo

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

1. 安装Solana CLI

```bash
sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"
```

1. 安装Anchor CLI

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install latest
avm use latest
```

1. 安装Node.js和Yarn

```bash
# 使用uv安装Node.js依赖
uv pip install node yarn
```

### 编译项目

由于项目使用了不稳定的Rust特性`offset_of`，需要使用nightly版本的Rust编译器：

```bash
# 切换到nightly版本
rustup default nightly

# 构建项目
anchor build
```

### 测试项目

```bash
# 安装测试依赖
yarn add @solana/spl_token tweetnacl bs58 --dev

# 运行测试
anchor test
```

## 部署指南

### 本地测试网部署

1. 启动本地测试网

```bash
solana-test-validator
```

1. 部署合约

```bash
anchor deploy
```

### Devnet部署

1. 配置Solana CLI使用devnet

```bash
solana config set --url https://api.devnet.solana.com
```

1. 获取测试SOL

```bash
solana airdrop 2
```

1. 修改`Anchor.toml`文件，将`cluster`设置为`devnet`

```toml
[provider]
cluster = "devnet"
wallet = "/path/to/your/wallet.json"
```

1. 部署合约

```bash
anchor deploy
```

### Mainnet部署

1. 配置Solana CLI使用mainnet

```bash
solana config set --url https://api.mainnet-beta.solana.com
```

1. 修改`Anchor.toml`文件，将`cluster`设置为`mainnet`

```toml
[provider]
cluster = "mainnet"
wallet = "/path/to/your/wallet.json"
```

1. 部署合约

```bash
anchor deploy
```

## 使用指南

### 初始化合约

```typescript
// 创建代币
const tokenMint = await createMint(
  connection,
  owner,
  owner.publicKey,
  null,
  6 // 6位小数
);

// 初始化合约
const tx = await program.methods
  .initialize(signerPublicKey)
  .accounts({
    owner: ownerPublicKey,
    tokenMint: tokenMint,
    state: statePda,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([owner])
  .rpc();
```

### 创建代币金库

```typescript
const tx = await program.methods
  .createVault()
  .accounts({
    owner: ownerPublicKey,
    state: statePda,
    tokenVault: vaultPda,
    tokenMint: tokenMint,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .signers([owner])
  .rpc();
```

### 用户领取空投

```typescript
// 创建签名消息
const messageData = {
  wallet: userPublicKey,
  amount: airdropAmount,
};

// 序列化消息
const messageBuffer = Buffer.from(
  JSON.stringify(messageData),
  "utf-8"
);

// 使用签名者私钥签名
const signature = nacl.sign.detached(
  messageBuffer,
  signerSecretKey
);

// 执行领取交易
const tx = await program.methods
  .claim(
    new anchor.BN(airdropAmount),
    Array.from(signature)
  )
  .accounts({
    claimer: userPublicKey,
    state: statePda,
    claimRecord: claimRecordPda,
    tokenVault: tokenVault,
    recipient: userTokenAccount,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([user])
  .rpc();
```

### 提取代币

```typescript
const tx = await program.methods
  .withdraw(new anchor.BN(amount))
  .accounts({
    state: statePda,
    owner: ownerPublicKey,
    tokenVault: tokenVault,
    recipient: ownerTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([owner])
  .rpc();
```

## 注意事项

1. **签名验证**：在测试环境中，我们简化了签名验证逻辑。在实际生产环境中，应该使用更安全的验证方式。

2. **PDA限制**：在Solana中，PDA不是有效的ed25519公钥，因此不能直接作为代币账户的所有者。我们通过创建一个由程序控制的代币账户来解决这个问题。

3. **Rust编译器版本**：由于使用了不稳定的Rust特性`offset_of`，需要使用nightly版本的Rust编译器。

4. **代币金库安全**：确保代币金库的所有权正确设置为程序PDA，以防止未授权访问。

5. **错误处理**：在生产环境中，应该添加更多的错误检查和处理逻辑，以提高合约的健壮性。

6. **测试覆盖率**：在部署到主网之前，确保测试覆盖了所有可能的场景，包括边界条件和错误情况。

7. **Gas优化**：在Solana上，计算单元（CU）是有限的，应该优化代码以减少计算单元的使用。

## 常见问题解答

### Q: 如何更新签名者地址？

A: 当前合约没有提供更新签名者地址的功能。如果需要更新签名者地址，可以添加一个新的指令，并确保只有合约所有者才能调用该指令。

### Q: 如何处理不同的代币小数位数？

A: 合约不关心代币的小数位数，它只处理原始的代币数量。在前端应用中，应该根据代币的小数位数来显示正确的代币数量。

### Q: 如何防止重放攻击？

A: 合约使用ClaimRecord账户来记录用户的领取状态，确保每个用户只能领取一次。在生产环境中，可以考虑添加时间戳或nonce来进一步防止重放攻击。

## 贡献指南

欢迎贡献代码和提出问题！请遵循以下步骤：

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建Pull Request

## 许可证

[MIT](LICENSE)
