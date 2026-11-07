import { ethers } from "ethers";
import { PROOFLY_CONTRACTS } from "../dist/contracts.js";
const rpc=(process.env.SEPOLIA_RPC_URL||"").replace("$(ALCHEMY_KEY)",process.env.ALCHEMY_KEY||"").replace("${ALCHEMY_KEY}",process.env.ALCHEMY_KEY||"");
const provider=new ethers.JsonRpcProvider(rpc),wallet=new ethers.Wallet(process.env.PRIVATE_KEY,provider),forum=new ethers.Contract(PROOFLY_CONTRACTS.forum,["function questions(uint256) view returns(address,bytes32,uint96,bool,bool,uint64,uint256,uint256,address)","function finalizeQuestion(uint256)"],wallet);
const question=await forum.questions(1);if(question[4])console.log("Question already finalized");else{if(question[7]===0n)throw new Error("No best answer selected");if(BigInt((await provider.getBlock("latest")).timestamp)<question[5])throw new Error("Question has not expired");const tx=await forum.finalizeQuestion(1);await tx.wait();console.log(`Finalized question #1: ${tx.hash}`);}
