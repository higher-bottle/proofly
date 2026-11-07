import { ethers } from "ethers";
import { PROOFLY_CONTRACTS } from "../dist/contracts.js";

const rpc=(process.env.SEPOLIA_RPC_URL||"").replace("$(ALCHEMY_KEY)",process.env.ALCHEMY_KEY||"").replace("${ALCHEMY_KEY}",process.env.ALCHEMY_KEY||"");
if(!rpc)throw new Error("SEPOLIA_RPC_URL is missing");
const provider=new ethers.JsonRpcProvider(rpc);
const help=new ethers.Contract(PROOFLY_CONTRACTS.helpToken,["function owner() view returns(address)","function HELP_PER_ETH() view returns(uint256)","function ANSWER_REWARD_LIFETIME() view returns(uint256)"],provider);
const forum=new ethers.Contract(PROOFLY_CONTRACTS.forum,["function help() view returns(address)","function accountIssuer() view returns(address)"],provider);
const badge=new ethers.Contract(PROOFLY_CONTRACTS.badge,["function issuer() view returns(address)"],provider);
const [network,codes,helpOwner,forumHelp,accountIssuer,badgeIssuer,rate,lifetime]=await Promise.all([provider.getNetwork(),Promise.all([PROOFLY_CONTRACTS.helpToken,PROOFLY_CONTRACTS.badge,PROOFLY_CONTRACTS.forum].map(address=>provider.getCode(address))),help.owner(),forum.help(),forum.accountIssuer(),badge.issuer(),help.HELP_PER_ETH(),help.ANSWER_REWARD_LIFETIME()]);
if(network.chainId!==11155111n||codes.some(code=>code==="0x")||helpOwner.toLowerCase()!==PROOFLY_CONTRACTS.forum.toLowerCase()||forumHelp.toLowerCase()!==PROOFLY_CONTRACTS.helpToken.toLowerCase()||accountIssuer.toLowerCase()!==badgeIssuer.toLowerCase()||rate!==100n||lifetime!==7776000n)throw new Error("Sepolia wiring verification failed");
console.log(JSON.stringify({chainId:network.chainId.toString(),contracts:PROOFLY_CONTRACTS,helpOwner,accountIssuer,helpPerEth:rate.toString(),answerRewardLifetime:lifetime.toString(),bytecodePresent:true},null,2));
