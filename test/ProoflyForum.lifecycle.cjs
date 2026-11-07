const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ProoflyForum question lifecycle", function () {
  async function deploy() {
    const [owner, asker, first, second] = await ethers.getSigners();
    const Help = await ethers.getContractFactory("HelpToken");
    const help = await Help.deploy();
    const Forum = await ethers.getContractFactory("ProoflyForum");
    const forum = await Forum.deploy(await help.getAddress(), owner.address, 30 * 24 * 60 * 60);
    await help.transferOwnership(await forum.getAddress());
    let nonce = 0n;
    const claim = async (wallet, studentId, action, questionId = 0n, bounty = 0n) => {
      const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600), network = await ethers.provider.getNetwork(), nextNonce = ++nonce;
      const domain = {name:"ProoflyForum",version:"1",chainId:network.chainId,verifyingContract:await forum.getAddress()};
      const types = {AccountAction:[{name:"wallet",type:"address"},{name:"studentId",type:"bytes32"},{name:"action",type:"uint8"},{name:"questionId",type:"uint256"},{name:"bounty",type:"uint96"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}]};
      return {studentId,nonce:nextNonce,deadline,signature:await owner.signTypedData(domain,types,{wallet:wallet.address,studentId,action,questionId,bounty,nonce:nextNonce,deadline})};
    };
    const post = async (wallet, studentId, bounty) => { const c=await claim(wallet,studentId,1,0n,bounty); return forum.connect(wallet).postQuestion(bounty,c.studentId,c.nonce,c.deadline,c.signature); };
    const answer = async (wallet, studentId, questionId) => { const c=await claim(wallet,studentId,2,questionId,0n); return forum.connect(wallet).submitAnswer(questionId,c.studentId,c.nonce,c.deadline,c.signature); };
    return { asker, first, second, help, forum, post, answer };
  }

  it("allows the asker to change the selection and pays only after expiry", async function () {
    const { asker, first, second, help, forum, post, answer } = await deploy();
    await post(asker,ethers.id("asker"),ethers.parseEther("7"));
    await answer(first,ethers.id("first"),1n);
    await answer(second,ethers.id("second"),1n);
    await forum.connect(asker).selectBestAnswer(1, 1);
    await forum.connect(asker).selectBestAnswer(1, 2);

    expect((await forum.questions(1)).selectedAnswerer).to.equal(second.address);
    expect(await help.balanceOf(second.address)).to.equal(ethers.parseEther("1"));
    await expect(forum.finalizeQuestion(1)).to.be.revertedWith("Question has not expired");

    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await forum.finalizeQuestion(1);
    expect(await help.balanceOf(second.address)).to.equal(ethers.parseEther("8"));
    expect((await forum.questions(1)).finalized).to.equal(true);
  });

  it("finalizes an expired question without a selection as closed", async function () {
    const { asker, forum, post } = await deploy();
    await post(asker,ethers.id("asker"),ethers.parseEther("3"));
    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await forum.finalizeQuestion(1);
    const question = await forum.questions(1);
    expect(question.finalized).to.equal(true);
    expect(question.selectedAnswerer).to.equal(ethers.ZeroAddress);
  });
});
