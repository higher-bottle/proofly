import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ethers } from "ethers";
import { createDemoServer } from "../server/demo-server.mjs";
import { PROOFLY_CONTRACTS } from "../dist/contracts.js";

const RPC = process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
const ANVIL_ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const tempDirectory = mkdtempSync(join(tmpdir(), "proofly-integration-"));
const server = createDemoServer({ databasePath: join(tempDirectory, "test.sqlite"), issuerPrivateKey: ANVIL_ADMIN_KEY });

function assert(condition, message) { if (!condition) throw new Error(message); }

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address(), base = `http://127.0.0.1:${port}`;
  const api = async (path, options = {}) => {
    const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...options });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error), { status: response.status });
    return payload;
  };

  const provider = new ethers.JsonRpcProvider(RPC), admin = new ethers.NonceManager(new ethers.Wallet(ANVIL_ADMIN_KEY, provider)), studentBase = ethers.Wallet.createRandom().connect(provider), answererBase = ethers.Wallet.createRandom().connect(provider), student = new ethers.NonceManager(studentBase), answerer = new ethers.NonceManager(answererBase);
  student.address=studentBase.address;answerer.address=answererBase.address;
  assert((await provider.getNetwork()).chainId === 31337n, "Anvil chain ID must be 31337");
  await (await admin.sendTransaction({ to: student.address, value: ethers.parseEther("1") })).wait();
  await (await admin.sendTransaction({ to: answerer.address, value: ethers.parseEther("1") })).wait();

  const challenge = await api("/api/wallet/nonce", { method: "POST", body: JSON.stringify({ address: student.address }) });
  const signature = await student.signMessage(challenge.message);
  await api("/api/wallet/verify", { method: "POST", body: JSON.stringify({ address: student.address, nonce: challenge.nonce, signature }) });
  let replayRejected = false;
  try { await api("/api/wallet/verify", { method: "POST", body: JSON.stringify({ address: student.address, nonce: challenge.nonce, signature }) }); }
  catch (error) { replayRejected = error.status === 400; }
  assert(replayRejected, "wallet verification nonce was reusable");
  const addresses = await api("/api/wallet/addresses");
  assert(addresses.addresses.some(item => item.address.toLowerCase() === student.address.toLowerCase()), "verified address was not stored");

  const demoQuestions = [{ id: 1, title: "Integration question", course: "Blockchain 101" }];
  await api("/api/questions", { method: "PUT", body: JSON.stringify({ questions: demoQuestions }) });
  assert((await api("/api/questions")).questions[0].title === demoQuestions[0].title, "question persistence failed");

  const metadataURI = "http://127.0.0.1:5173/metadata/learning-pioneer.json";
  const claim = await api("/api/badges/claim", { method: "POST", body: JSON.stringify({ address: student.address, badgeId: "learning-pioneer", metadataURI }) });
  const badge = new ethers.Contract(PROOFLY_CONTRACTS.badge, [
    "function mintBadge(string,string,uint256,uint256,bytes) returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function nextTokenId() view returns (uint256)"
  ], student);
  const tokenId = await badge.nextTokenId();
  await (await badge.mintBadge("learning-pioneer", metadataURI, claim.nonce, claim.deadline, claim.signature)).wait();
  assert((await badge.ownerOf(tokenId)).toLowerCase() === student.address.toLowerCase(), "authorized badge mint failed");

  let ineligibleRejected = false;
  try { await api("/api/badges/claim", { method: "POST", body: JSON.stringify({ address: student.address, badgeId: "course-finisher", metadataURI: "uri" }) }); }
  catch (error) { ineligibleRejected = error.status === 403; }
  assert(ineligibleRejected, "backend issued an ineligible badge claim");

  const forumAbi = [
    "function nextQuestionId() view returns (uint256)",
    "function postQuestion(uint96,bytes32,uint256,uint256,bytes) returns (uint256)",
    "function submitAnswer(uint256,bytes32,uint256,uint256,bytes) returns (uint256)",
    "function selectBestAnswer(uint256,uint256)",
    "function finalizeQuestion(uint256)",
    "function questions(uint256) view returns (address asker,bytes32 askerStudentId,uint96 bounty,bool sponsored,bool finalized,uint64 expiresAt,uint256 answerCount,uint256 selectedAnswerId,address selectedAnswerer)"
  ];
  const helpAbi = ["function balanceOf(address) view returns (uint256)"];
  const forumAsAsker = new ethers.Contract(PROOFLY_CONTRACTS.forum, forumAbi, student), forumAsAnswerer = forumAsAsker.connect(answerer), help = new ethers.Contract(PROOFLY_CONTRACTS.helpToken, helpAbi, provider);
  let forumNonce=1000n;const forumDomain={name:"ProoflyForum",version:"1",chainId:31337,verifyingContract:PROOFLY_CONTRACTS.forum},forumTypes={AccountAction:[{name:"wallet",type:"address"},{name:"studentId",type:"bytes32"},{name:"action",type:"uint8"},{name:"questionId",type:"uint256"},{name:"bounty",type:"uint96"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}]};
  const forumClaim=async(wallet,studentId,action,questionId,bounty)=>{const nonce=++forumNonce,deadline=BigInt((await provider.getBlock("latest")).timestamp+600),signature=await admin.signTypedData(forumDomain,forumTypes,{wallet,studentId,action,questionId,bounty,nonce,deadline});return{nonce,deadline,signature};};
  const questionId = await forumAsAsker.nextQuestionId();
  const askerStudent=ethers.id("integration-asker"),answererStudent=ethers.id("integration-answerer"),postClaim=await forumClaim(student.address,askerStudent,1,0n,ethers.parseEther("3"));
  await (await forumAsAsker.postQuestion(ethers.parseEther("3"),askerStudent,postClaim.nonce,postClaim.deadline,postClaim.signature)).wait();
  const answerClaim=await forumClaim(answerer.address,answererStudent,2,questionId,0n);
  await (await forumAsAnswerer.submitAnswer(questionId,answererStudent,answerClaim.nonce,answerClaim.deadline,answerClaim.signature)).wait();
  await (await forumAsAsker.selectBestAnswer(questionId, 1)).wait();
  assert(await help.balanceOf(answerer.address) === ethers.parseEther("1"), "answer reward was not issued");
  await provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
  await provider.send("evm_mine", []);
  await (await forumAsAsker.finalizeQuestion(questionId)).wait();
  const finalized = await forumAsAsker.questions(questionId);
  assert(finalized.finalized && finalized.selectedAnswerer.toLowerCase() === answerer.address.toLowerCase(), "question did not finalize with selected answerer");
  assert(await help.balanceOf(answerer.address) === ethers.parseEther("4"), "final bounty payout was not issued");

  console.log("Integration passed: SQLite persistence, wallet verification, signed badge mint, eligibility rejection, and Anvil question reward lifecycle.");
} finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(tempDirectory, { recursive: true, force: true });
}
