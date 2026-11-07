import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import { PROOFLY_CONTRACTS } from "../dist/contracts.js";

const title = "Why is calldata usually cheaper than memory for external function arguments?";
const rpcUrl = (process.env.SEPOLIA_RPC_URL || "")
  .replace("$(ALCHEMY_KEY)", process.env.ALCHEMY_KEY || "")
  .replace("${ALCHEMY_KEY}", process.env.ALCHEMY_KEY || "");
const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl || !privateKey) throw new Error("SEPOLIA_RPC_URL and PRIVATE_KEY are required");

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const forum = new ethers.Contract(PROOFLY_CONTRACTS.forum, [
  "function accountIssuer() view returns(address)",
  "function questionLifetime() view returns(uint256)",
  "function nextQuestionId() view returns(uint256)",
  "function postQuestion(uint96 bounty,bytes32 studentId,uint256 nonce,uint256 deadline,bytes signature) returns(uint256)",
  "function questions(uint256) view returns(address asker,bytes32 askerStudentId,uint96 bounty,bool sponsored,bool finalized,uint64 expiresAt,uint256 answerCount,uint256 selectedAnswerId,address selectedAnswerer)"
], wallet);

const database = new DatabaseSync(fileURLToPath(new URL("../data/proofly-demo.sqlite", import.meta.url)));
const row = database.prepare("SELECT value FROM app_state WHERE student_id='demo-student-001' AND key='questions'").get();
const questions = row ? JSON.parse(row.value) : [];
const existing = questions.find(question => question.title === title && question.onChainQuestionId);
if (existing) {
  const chainQuestion = await forum.questions(existing.onChainQuestionId);
  if (chainQuestion.asker !== ethers.ZeroAddress) {
    console.log(`Demo question already linked to Sepolia Forum #${existing.onChainQuestionId}`);
    console.log(`Question lifetime: ${(await forum.questionLifetime()).toString()} seconds; countdown starts on first answer.`);
    console.log(`Asker: ${chainQuestion.asker}; expiresAt: ${chainQuestion.expiresAt.toString()}; answers: ${chainQuestion.answerCount.toString()}; selectedAnswerId: ${chainQuestion.selectedAnswerId.toString()}; selectedAnswerer: ${chainQuestion.selectedAnswerer}; finalized: ${chainQuestion.finalized}`);
    database.close();
    process.exit(0);
  }
}

const issuer = await forum.accountIssuer();
if (issuer.toLowerCase() !== wallet.address.toLowerCase()) throw new Error(`Configured key ${wallet.address} is not Forum account issuer ${issuer}`);
const network = await provider.getNetwork();
if (network.chainId !== BigInt(PROOFLY_CONTRACTS.chainId)) throw new Error(`Wrong chain ${network.chainId}`);
const questionId = await forum.nextQuestionId();
const studentId = ethers.id("proofly-video-demo-asker");
const bounty = ethers.parseEther("5");
const nonce = BigInt(Date.now()) * 1000n + 17n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
const domain = { name: "ProoflyForum", version: "1", chainId: network.chainId, verifyingContract: PROOFLY_CONTRACTS.forum };
const types = { AccountAction: [
  {name:"wallet",type:"address"},{name:"studentId",type:"bytes32"},{name:"action",type:"uint8"},
  {name:"questionId",type:"uint256"},{name:"bounty",type:"uint96"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}
] };
const signature = await wallet.signTypedData(domain, types, { wallet: wallet.address, studentId, action: 1, questionId: 0, bounty, nonce, deadline });
const tx = await forum.postQuestion(bounty, studentId, nonce, deadline, signature);
const receipt = await tx.wait();
const chainQuestion = await forum.questions(questionId);

const publishedAt = new Date(Number((await provider.getBlock(receipt.blockNumber)).timestamp) * 1000).toISOString();
const demoQuestion = {
  id: Date.now(), onChainQuestionId: Number(questionId), course: "COMP7610 Introduction to Web3 and Blockchain",
  topic: "Solidity", topics: ["Solidity", "Gas Optimization"], title,
  body: "Both calldata and memory can hold function arguments. What causes the gas difference, and when must Solidity copy calldata into memory?",
  author: "Maya Chen", initials: "MC", color: "#ffdfcc", bounty: 5, answers: 0, explanations: [],
  time: "Just now", updatedTime: "No explanations yet", publishedAt,
  expiresAt: new Date(Number(chainQuestion.expiresAt) * 1000).toISOString(), publishedMinutes: 0, updatedMinutes: 999999, status: "open"
};
const withoutOldDemo = questions.filter(question => question.title !== title);
withoutOldDemo.unshift(demoQuestion);
database.prepare("INSERT INTO app_state(student_id,key,value,updated_at) VALUES('demo-student-001','questions',?,?) ON CONFLICT(student_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(JSON.stringify(withoutOldDemo), new Date().toISOString());
database.close();
console.log(`Posted Sepolia Forum question #${questionId} in tx ${tx.hash}`);
console.log(`Saved demo feed question: ${title}`);
