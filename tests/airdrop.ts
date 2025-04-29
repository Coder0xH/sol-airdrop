import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Airdrop } from "../target/types/airdrop";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import * as nacl from "tweetnacl";

describe("空投合约测试", () => {
  // 配置客户端使用本地集群
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Airdrop as Program<Airdrop>;
  
  // 创建测试账户
  const owner = Keypair.generate();
  const signer = Keypair.generate();
  const user = Keypair.generate();
  
  // 创建代币相关变量
  let tokenMint: PublicKey;
  let tokenVault: PublicKey;
  let userTokenAccount: PublicKey;
  let ownerTokenAccount: PublicKey;
  
  // 创建PDA
  const [statePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );
  
  // 创建金库PDA
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  tokenVault = vaultPda;
  
  // 空投金额
  const airdropAmount = 100_000_000; // 100 tokens with 6 decimals
  
  before(async () => {
    // 为测试账户提供SOL
    const ownerAirdropTx = await provider.connection.requestAirdrop(owner.publicKey, 10 * LAMPORTS_PER_SOL);
    const userAirdropTx = await provider.connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
    
    // 等待确认
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature: ownerAirdropTx,
    });
    await provider.connection.confirmTransaction({
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature: userAirdropTx,
    });
    
    // 创建代币
    tokenMint = await createMint(
      provider.connection,
      owner,
      owner.publicKey,
      null,
      6 // 6位小数
    );
    
    // 创建用户代币账户
    const userTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      tokenMint,
      user.publicKey
    );
    userTokenAccount = userTokenAccountInfo.address;
    
    const ownerTokenAccountInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      owner,
      tokenMint,
      owner.publicKey
    );
    ownerTokenAccount = ownerTokenAccountInfo.address;
    
    // 初始化程序状态
    const initTx = await program.methods
      .initialize(signer.publicKey)
      .accounts({
        owner: owner.publicKey,
        tokenMint: tokenMint,
        state: statePda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([owner])
      .rpc();
    
    console.log("初始化交易签名:", initTx);
    
    // 创建代币金库
    const createVaultTx = await program.methods
      .createVault()
      .accounts({
        owner: owner.publicKey,
        state: statePda,
        tokenVault: tokenVault,
        tokenMint: tokenMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    
    console.log("创建金库交易签名:", createVaultTx);
    
    // 铸造代币到金库
    await mintTo(
      provider.connection,
      owner,
      tokenMint,
      tokenVault,
      owner,
      1_000_000_000 // 1000 tokens with 6 decimals
    );
  });
  
  it("初始化空投合约", async () => {
    // 验证状态账户
    const stateAccount = await program.account.stateAccount.fetch(statePda);
    assert.equal(stateAccount.owner.toString(), owner.publicKey.toString());
    assert.equal(stateAccount.tokenMint.toString(), tokenMint.toString());
    assert.equal(stateAccount.tokenVault.toString(), tokenVault.toString());
    assert.equal(stateAccount.signer.toString(), signer.publicKey.toString());
    assert.equal(stateAccount.totalClaimed.toNumber(), 0);
    assert.equal(stateAccount.bump, stateBump);
  });
  
  it("用户领取空投", async () => {
    // 为用户创建领取记录PDA
    const [claimRecordPda, _] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), user.publicKey.toBuffer()],
      program.programId
    );
    
    // 创建签名消息
    const messageData = {
      wallet: user.publicKey,
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
      signer.secretKey
    );
    
    // 执行领取交易
    const tx = await program.methods
      .claim(
        new anchor.BN(airdropAmount),
        Array.from(signature)
      )
      .accounts({
        claimer: user.publicKey,
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
    
    console.log("领取交易签名:", tx);
    
    // 验证用户代币余额
    const userAccount = await getAccount(
      provider.connection,
      userTokenAccount
    );
    assert.equal(userAccount.amount.toString(), airdropAmount.toString());
    
    // 验证总领取量
    const stateAccount = await program.account.stateAccount.fetch(statePda);
    assert.equal(stateAccount.totalClaimed.toString(), airdropAmount.toString());
    
    // 验证领取记录
    const claimRecord = await program.account.claimRecord.fetch(claimRecordPda);
    assert.isTrue(claimRecord.isClaimed);
  });
  
  it("重复领取应该失败", async () => {
    // 为用户创建领取记录PDA
    const [claimRecordPda, _] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), user.publicKey.toBuffer()],
      program.programId
    );
    
    // 创建签名消息
    const messageData = {
      wallet: user.publicKey,
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
      signer.secretKey
    );
    
    try {
      // 尝试再次领取
      await program.methods
        .claim(
          new anchor.BN(airdropAmount),
          Array.from(signature)
        )
        .accounts({
          claimer: user.publicKey,
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
      
      assert.fail("应该抛出错误");
    } catch (error) {
      assert.include(error.message, "已经领取过");
    }
  });
  
  it("所有者可以提取代币", async () => {
    const withdrawAmount = 50_000_000; // 50 tokens
    
    // 获取提取前的余额
    const vaultAccountBefore = await getAccount(
      provider.connection,
      tokenVault
    );
    const ownerAccountBefore = await getAccount(
      provider.connection,
      ownerTokenAccount
    );
    
    // 执行提取交易
    const tx = await program.methods
      .withdraw(new anchor.BN(withdrawAmount))
      .accounts({
        state: statePda,
        owner: owner.publicKey,
        tokenVault: tokenVault,
        recipient: ownerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    
    console.log("提取交易签名:", tx);
    
    // 验证余额变化
    const vaultAccountAfter = await getAccount(
      provider.connection,
      tokenVault
    );
    const ownerAccountAfter = await getAccount(
      provider.connection,
      ownerTokenAccount
    );
    
    const vaultBalanceBefore = BigInt(vaultAccountBefore.amount.toString());
    const vaultBalanceAfter = BigInt(vaultAccountAfter.amount.toString());
    const ownerBalanceBefore = BigInt(ownerAccountBefore.amount.toString());
    const ownerBalanceAfter = BigInt(ownerAccountAfter.amount.toString());
    
    assert.equal(
      vaultBalanceAfter.toString(),
      (vaultBalanceBefore - BigInt(withdrawAmount)).toString()
    );
    
    assert.equal(
      ownerBalanceAfter.toString(),
      (ownerBalanceBefore + BigInt(withdrawAmount)).toString()
    );
  });
  
  it("非所有者不能提取代币", async () => {
    try {
      await program.methods
        .withdraw(new anchor.BN(10_000_000))
        .accounts({
          state: statePda,
          owner: user.publicKey, // 使用非所有者账户
          tokenVault: tokenVault,
          recipient: userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      
      assert.fail("应该抛出错误");
    } catch (error) {
      assert.include(error.message, "未授权操作");
    }
  });
});
