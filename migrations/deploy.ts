// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require("@coral-xyz/anchor");
const { PublicKey, Keypair } = require("@solana/web3.js");
const { readFileSync } = require("fs");
const path = require("path");

// 读取 IDL 文件
const idlPath = path.join(__dirname, "../target/idl/airdrop.json");
const idl = JSON.parse(readFileSync(idlPath, "utf8"));

// 读取程序 ID
const programId = new PublicKey("HMsLRRqoo8SpnR9acz49Mq7ht19x93Kp62DdGFKoRTYe");

module.exports = async function (provider) {
  // 配置客户端使用提供的 provider
  anchor.setProvider(provider);

  // 创建程序客户端
  const program = new anchor.Program(idl, programId, provider);
  
  console.log("开始部署空投合约...");
  
  try {
    // 创建一个签名者公钥（在实际环境中，这应该是一个安全的密钥）
    const signer = Keypair.generate().publicKey;
    
    // 查找状态账户的 PDA
    const [stateAccount, _] = PublicKey.findProgramAddressSync(
      [Buffer.from("state")],
      program.programId
    );
    
    // 检查状态账户是否已经存在
    const stateAccountInfo = await provider.connection.getAccountInfo(stateAccount);
    
    if (!stateAccountInfo) {
      console.log("状态账户不存在，初始化合约...");
      
      // 创建一个代币铸币账户（在实际环境中，这应该是你的代币地址）
      const tokenMint = Keypair.generate().publicKey;
      
      // 初始化合约
      const tx = await program.methods
        .initialize(signer)
        .accounts({
          state: stateAccount,
          owner: provider.wallet.publicKey,
          tokenMint: tokenMint,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      
      console.log("合约初始化成功！交易签名:", tx);
      console.log("状态账户:", stateAccount.toString());
      console.log("代币铸币账户:", tokenMint.toString());
      console.log("签名者公钥:", signer.toString());
      
      // 创建金库
      const [vaultAccount, _vaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        program.programId
      );
      
      const vaultTx = await program.methods
        .createVault()
        .accounts({
          state: stateAccount,
          vault: vaultAccount,
          tokenMint: tokenMint,
          owner: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      
      console.log("金库创建成功！交易签名:", vaultTx);
      console.log("金库账户:", vaultAccount.toString());
    } else {
      console.log("状态账户已存在，跳过初始化步骤。");
      console.log("状态账户:", stateAccount.toString());
      
      // 读取状态账户数据
      const stateData = await program.account.stateAccount.fetch(stateAccount);
      console.log("合约所有者:", stateData.owner.toString());
      console.log("代币铸币账户:", stateData.tokenMint.toString());
      console.log("签名者公钥:", stateData.signer.toString());
      console.log("已领取总量:", stateData.totalClaimed.toString());
    }
    
    console.log("部署完成！");
    
  } catch (error) {
    console.error("部署过程中出错:", error);
    throw error;
  }
};
